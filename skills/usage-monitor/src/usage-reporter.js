const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const OPENCLAW_AGENTS_DIR = path.join(os.homedir(), '.openclaw/agents');
const GEMINI_SESSIONS_DIR = path.join(os.homedir(), '.gemini/tmp');
const OPENCLAW_SKILLS_DIR = path.join(os.homedir(), '.openclaw/workspace/skills');
const REPORTS_DIR = path.join(os.homedir(), '.openclaw/workspace/reports/usage');

const NATIVE_TOOLS = new Set([
    'read', 'write', 'edit', 'exec', 'list_directory', 'glob', 'grep_search',
    'cli_help', 'web_fetch', 'codebase_investigator', 'save_memory',
    'google_web_search', 'message', 'delete_session', 'list_extensions',
    'poll', 'process', 'run_shell_command', 'replace', 'read_file', 'write_file'
]);

let modelUsage = { openclaw: {}, gemini_cli: {} };
let skillUsage = { openclaw: {}, gemini_cli: {} };

// Token usage tracking
let tokenUsage = {
    openclaw: {},  // { model: { input, output, cacheRead, cacheWrite, total, cost, calls } }
    gemini_cli: {}
};

function initTokenEntry() {
    return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: 0, calls: 0 };
}

// --- Data Parsers ---

function extractSkillFromCommand(cmd) {
    if (!cmd || typeof cmd !== 'string') return null;
    const match = cmd.match(/\/skills\/([^\/\s]+)\//);
    if (match) return match[1];
    return null;
}

function parseOpenClawSession(filePath) {
    const lines = fs.readFileSync(filePath, 'utf8').split('\n').filter(Boolean);
    for (const line of lines) {
        try {
            const record = JSON.parse(line);
            if (record.type === 'message' && record.message) {
                const model = record.message.model?.split('/').pop();

                if (model) {
                    modelUsage.openclaw[model] = (modelUsage.openclaw[model] || 0) + 1;

                    // Extract token usage
                    const usage = record.message.usage;
                    if (usage) {
                        if (!tokenUsage.openclaw[model]) {
                            tokenUsage.openclaw[model] = initTokenEntry();
                        }
                        const t = tokenUsage.openclaw[model];
                        t.input += usage.input || 0;
                        t.output += usage.output || 0;
                        t.cacheRead += usage.cacheRead || 0;
                        t.cacheWrite += usage.cacheWrite || 0;
                        t.total += usage.totalTokens || (usage.input + usage.output) || 0;
                        t.cost += usage.cost?.total || 0;
                        t.calls += 1;
                    }
                }

                if (Array.isArray(record.message.content)) {
                    for (const item of record.message.content) {
                        if (item.type === 'toolCall' && item.name) {
                            if (item.name === 'exec' && item.arguments?.command) {
                                const skill = extractSkillFromCommand(item.arguments.command);
                                if (skill) skillUsage.openclaw[skill] = (skillUsage.openclaw[skill] || 0) + 1;
                            }
                            skillUsage.openclaw[item.name] = (skillUsage.openclaw[item.name] || 0) + 1;
                        }
                    }
                }
            }
        } catch {}
    }
}

function parseGeminiSession(filePath) {
    try {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        if (!data.messages) return;

        for (const msg of data.messages) {
            if (msg.model) {
                const model = msg.model.split('/').pop();
                modelUsage.gemini_cli[model] = (modelUsage.gemini_cli[model] || 0) + 1;
            }
            if (msg.toolCalls) {
                for (const call of msg.toolCalls) {
                    if (call.name === 'run_shell_command' && call.args?.command) {
                        const skill = extractSkillFromCommand(call.args.command);
                        if (skill) skillUsage.gemini_cli[skill] = (skillUsage.gemini_cli[skill] || 0) + 1;
                    }
                    skillUsage.gemini_cli[call.name] = (skillUsage.gemini_cli[call.name] || 0) + 1;
                }
            }
        }
    } catch {}
}

// --- File Scanners ---

function scanOpenClawSessions(sinceTime) {
    if (!fs.existsSync(OPENCLAW_AGENTS_DIR)) return;
    const agentDirs = fs.readdirSync(OPENCLAW_AGENTS_DIR);
    for (const agentDir of agentDirs) {
        const sessionsPath = path.join(OPENCLAW_AGENTS_DIR, agentDir, 'sessions');
        if (fs.existsSync(sessionsPath)) {
            const files = fs.readdirSync(sessionsPath);
            for (const file of files) {
                const filePath = path.join(sessionsPath, file);
                const stats = fs.statSync(filePath);
                if (stats.mtimeMs >= sinceTime) {
                    parseOpenClawSession(filePath);
                }
            }
        }
    }
}

function scanGeminiSessions(sinceTime) {
    if (!fs.existsSync(GEMINI_SESSIONS_DIR)) return;
    const projects = fs.readdirSync(GEMINI_SESSIONS_DIR);
    for (const p of projects) {
        const chatDir = path.join(GEMINI_SESSIONS_DIR, p, 'chats');
        if (fs.existsSync(chatDir)) {
            const files = fs.readdirSync(chatDir);
            for (const file of files) {
                const filePath = path.join(chatDir, file);
                const stats = fs.statSync(filePath);
                if (stats.mtimeMs >= sinceTime) {
                    parseGeminiSession(filePath);
                }
            }
        }
    }
}

function isInternalSkill(toolName) {
    if (NATIVE_TOOLS.has(toolName)) return false;
    if (toolName.includes('.')) {
        const prefix = toolName.split('.')[0];
        if (fs.existsSync(path.join(OPENCLAW_SKILLS_DIR, prefix))) return true;
    }
    if (fs.existsSync(path.join(OPENCLAW_SKILLS_DIR, toolName))) return true;
    if (['memory_search', 'memory_summary', 'memory_store'].includes(toolName)) return true;
    return false;
}

// --- Report Generation ---

function formatNumber(n) {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M';
    if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
    return n.toString();
}

function formatCost(n) {
    return '$' + n.toFixed(4);
}

function generateReport(opts) {
    let report = `# Usage Report (Last ${opts.sinceDays} Days)\n\n`;
    report += `Generated: ${new Date().toISOString()}\n\n`;

    // 💰 Token & Cost Summary (OpenClaw only)
    report += '## 💰 Token Usage & Cost (OpenClaw Agents)\n\n';
    const tokenModels = Object.entries(tokenUsage.openclaw).sort((a, b) => b[1].cost - a[1].cost);

    if (tokenModels.length > 0) {
        let totalInput = 0, totalOutput = 0, totalCache = 0, totalCost = 0, totalCalls = 0;

        report += '| Model | Calls | Input | Output | Cache Read | Cost |\n';
        report += '| :--- | ---: | ---: | ---: | ---: | ---: |\n';

        for (const [model, t] of tokenModels) {
            report += `| **${model}** | ${t.calls} | ${formatNumber(t.input)} | ${formatNumber(t.output)} | ${formatNumber(t.cacheRead)} | ${formatCost(t.cost)} |\n`;
            totalInput += t.input;
            totalOutput += t.output;
            totalCache += t.cacheRead;
            totalCost += t.cost;
            totalCalls += t.calls;
        }

        report += `| **TOTAL** | ${totalCalls} | ${formatNumber(totalInput)} | ${formatNumber(totalOutput)} | ${formatNumber(totalCache)} | ${formatCost(totalCost)} |\n`;
    } else {
        report += 'No token usage data found.\n';
    }

    // 🤖 Models
    report += '\n## 🤖 Model Call Counts\n\n';
    report += '### OpenClaw\n';
    const openclawModels = Object.entries(modelUsage.openclaw).sort((a, b) => b[1] - a[1]);
    if (openclawModels.length > 0) {
        report += openclawModels.map(([model, count]) => `- **${model}**: ${count} calls`).join('\n');
    } else {
        report += 'No OpenClaw model usage data found.';
    }

    report += '\n\n### Gemini CLI\n';
    const geminiModels = Object.entries(modelUsage.gemini_cli).sort((a, b) => b[1] - a[1]);
    if (geminiModels.length > 0) {
        report += geminiModels.map(([model, count]) => `- **${model}**: ${count} calls`).join('\n');
    } else {
        report += 'No Gemini CLI model usage data found.';
    }

    // 🛠️ Skills
    report += '\n\n## 🛠️ Internal Skill Usage (~/.openclaw/workspace/skills)\n\n';

    let combined = {};

    // Process all tools from both sources
    const allTools = new Set([...Object.keys(skillUsage.openclaw), ...Object.keys(skillUsage.gemini_cli)]);

    for (const tool of allTools) {
        if (isInternalSkill(tool)) {
            const ocCount = skillUsage.openclaw[tool] || 0;
            const gcCount = skillUsage.gemini_cli[tool] || 0;
            combined[tool] = { total: ocCount + gcCount, openclaw: ocCount, gemini_cli: gcCount };
        }
    }

    const sortedSkills = Object.entries(combined).sort((a, b) => b[1].total - a[1].total);

    if (sortedSkills.length > 0) {
        report += '| Skill Name | Total | OpenClaw | Gemini CLI |\n';
        report += '| :--- | ---: | ---: | ---: |\n';
        report += sortedSkills.map(([skill, data]) =>
            `| **${skill}** | ${data.total} | ${data.openclaw} | ${data.gemini_cli} |`
        ).join('\n');
    } else {
        report += 'No internal skill usage data found.';
    }

    return report;
}

// --- GDrive Upload ---

const GDRIVE_FOLDER_MD = '1YD9gcsjespruhqli5Sk-DdRYne9TDrNu';
const GOG_ACCOUNT = 'jerryyrliu@gmail.com';

function uploadToGDrive(filePath, fileName) {
    try {
        const password = execSync('gcloud secrets versions access latest --secret=GOG_KEYRING_PASSWORD', {
            encoding: 'utf8', timeout: 15000
        }).trim();
        if (!password) {
            console.log('[usage-reporter] No GOG password, skipping upload');
            return false;
        }
        execSync(
            `GOG_KEYRING_PASSWORD="${password}" gog drive upload "${filePath}" --parent "${GDRIVE_FOLDER_MD}" --account "${GOG_ACCOUNT}" --name "${fileName}"`,
            { encoding: 'utf8', timeout: 60000 }
        );
        console.log(`[usage-reporter] ✓ Uploaded ${fileName} to GDrive`);
        return true;
    } catch (e) {
        console.error(`[usage-reporter] GDrive upload error: ${e.message}`);
        return false;
    }
}

// --- Main ---

function main() {
    const opts = { sinceDays: 7 };
    for (let i = 2; i < process.argv.length; i++) {
        if (process.argv[i] === '--since' && process.argv[i + 1]) {
            opts.sinceDays = parseInt(process.argv[++i], 10);
        }
    }

    const sinceTime = Date.now() - (opts.sinceDays * 24 * 60 * 60 * 1000);
    console.log(`Scanning usage data for the last ${opts.sinceDays} days...`);
    
    scanOpenClawSessions(sinceTime);
    scanGeminiSessions(sinceTime);

    const report = generateReport(opts);

    if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });
    const dateStr = new Date().toISOString().split('T')[0];
    const reportPath = path.join(REPORTS_DIR, `USAGE_REPORT_${dateStr}.md`);
    fs.writeFileSync(reportPath, report);
    
    console.log('\n--- Usage Report ---');
    console.log(report);
    console.log(`\n📄 Full report saved to: ${reportPath}`);

    // Upload MD to GDrive
    uploadToGDrive(reportPath, `USAGE_REPORT_${dateStr}.md`);
}

main();
