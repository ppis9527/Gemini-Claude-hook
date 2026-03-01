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
let failureStats = { openclaw: {}, gemini_cli: {} };

// Token usage tracking
let tokenUsage = {
    openclaw: {},  // { model: { input, output, cacheRead, cacheWrite, total, cost, calls } }
    gemini_cli: {}
};

const ERROR_KEYWORDS = [
    'Permission denied',
    'command not found',
    'timed out',
    'Sibling tool call errored',
    'Error:',
    'Failed'
];

function initTokenEntry() {
    return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: 0, calls: 0 };
}

function initFailureEntry() {
    return { total: 0, failures: 0, reasons: {} };
}

function detectFailure(content) {
    if (!content || typeof content !== 'string') return null;
    for (const kw of ERROR_KEYWORDS) {
        if (content.includes(kw)) {
            // Extract a concise reason
            const index = content.indexOf(kw);
            let reason = content.substring(index, index + 50).split('\n')[0].trim();
            // Simplify reasons (e.g., specific file paths in permission denied)
            if (reason.includes('Permission denied')) reason = 'Permission denied';
            if (reason.includes('command not found')) reason = 'Command not found';
            if (reason.includes('timed out')) reason = 'Timed out';
            return reason;
        }
    }
    return null;
}

// --- Data Parsers ---

function extractSkillFromCommand(cmd) {
    if (!cmd || typeof cmd !== 'string') return null;
    const match = cmd.match(/\/skills\/([^\/\s]+)\//);
    if (match) return match[1];
    return null;
}

function parseOpenClawSession(filePath, agentName) {
    const lines = fs.readFileSync(filePath, 'utf8').split('\n').filter(Boolean);
    if (!failureStats.openclaw[agentName]) failureStats.openclaw[agentName] = initFailureEntry();
    const f = failureStats.openclaw[agentName];

    for (const line of lines) {
        try {
            const record = JSON.parse(line);
            if (record.type === 'message' && record.message) {
                const model = record.message.model?.split('/').pop();

                if (model) {
                    modelUsage.openclaw[model] = (modelUsage.openclaw[model] || 0) + 1;
                    f.total++;

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

                    // Detect failures in AI response content
                    if (record.message.role === 'assistant') {
                        let content = '';
                        if (Array.isArray(record.message.content)) {
                            content = record.message.content.map(c => c.text || '').join(' ');
                        } else {
                            content = record.message.content || '';
                        }
                        const reason = detectFailure(content);
                        if (reason) {
                            f.failures++;
                            f.reasons[reason] = (f.reasons[reason] || 0) + 1;
                        }
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

function parseGeminiSession(filePath, agentName) {
    try {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        if (!data.messages) return;

        if (!failureStats.gemini_cli[agentName]) failureStats.gemini_cli[agentName] = initFailureEntry();
        const f = failureStats.gemini_cli[agentName];

        for (const msg of data.messages) {
            if (msg.type === 'gemini' || msg.type === 'assistant' || msg.role === 'assistant') {
                f.total++;
                if (msg.model) {
                    const model = msg.model.split('/').pop();
                    modelUsage.gemini_cli[model] = (modelUsage.gemini_cli[model] || 0) + 1;
                } else if (data.model) {
                    const model = data.model.split('/').pop();
                    modelUsage.gemini_cli[model] = (modelUsage.gemini_cli[model] || 0) + 1;
                }

                // Detect failures
                const reason = detectFailure(msg.content) || (msg.type === 'error' ? msg.message : null);
                if (reason) {
                    f.failures++;
                    f.reasons[reason] = (f.reasons[reason] || 0) + 1;
                }
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
                    parseOpenClawSession(filePath, agentDir);
                }
            }
        }
    }
}

function scanGeminiSessions(sinceTime) {
    if (!fs.existsSync(GEMINI_SESSIONS_DIR)) return;
    const projects = fs.readdirSync(GEMINI_SESSIONS_DIR);
    for (const p of projects) {
        // Group all tmp-xxxx directories as "gemini-ephemeral"
        const agentName = p.startsWith('tmp-') ? 'gemini-ephemeral' : p;
        
        const chatDir = path.join(GEMINI_SESSIONS_DIR, p, 'chats');
        if (fs.existsSync(chatDir)) {
            const files = fs.readdirSync(chatDir);
            for (const file of files) {
                const filePath = path.join(chatDir, file);
                const stats = fs.statSync(filePath);
                if (stats.mtimeMs >= sinceTime) {
                    parseGeminiSession(filePath, agentName);
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

    // 🚨 Failure Analysis
    report += '\n\n## 🚨 Failure Analysis\n\n';
    report += '| Agent | Total Calls | Failures | Rate | Primary Reasons |\n';
    report += '| :--- | ---: | ---: | ---: | :--- |\n';

    const allAgents = new Set([...Object.keys(failureStats.openclaw), ...Object.keys(failureStats.gemini_cli)]);
    for (const agent of allAgents) {
        if (agent === 'bin' || agent === 'tmp') continue;
        const oc = failureStats.openclaw[agent] || initFailureEntry();
        const gc = failureStats.gemini_cli[agent] || initFailureEntry();
        const total = oc.total + gc.total;
        const fails = oc.failures + gc.failures;
        if (total === 0) continue;
        const rate = total > 0 ? ((fails / total) * 100).toFixed(1) + '%' : '0%';

        // Combine reasons
        const reasons = {};
        [oc.reasons, gc.reasons].forEach(rMap => {
            for (const [r, c] of Object.entries(rMap)) {
                reasons[r] = (reasons[r] || 0) + c;
            }
        });
        const topReasons = Object.entries(reasons)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .map(([r, c]) => `${r}(${c})`)
            .join(', ');

        report += `| **${agent}** | ${total} | ${fails} | ${rate} | ${topReasons || 'None'} |\n`;
    }

    return report;
}

// --- GDrive Upload (via rclone mount) ---

const GDRIVE_DIR = path.join(process.env.HOME || '~', 'gdrive', '02_analysis report', 'usage-monitor');

function uploadToGDrive(filePath, fileName) {
    try {
        const dest = path.join(GDRIVE_DIR, fileName);
        fs.copyFileSync(filePath, dest);
        console.log(`[usage-reporter] ✓ Copied ${fileName} to ~/gdrive/`);
        return true;
    } catch (e) {
        console.error(`[usage-reporter] GDrive copy error: ${e.message}`);
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
