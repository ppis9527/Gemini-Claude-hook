const fs = require('fs');
const path = require('path');

/**
 * Security Expert Scanner v2.0
 * Multi-vector audit: Secrets, and Code Patterns.
 */

const TARGET_DIR = process.argv[2] || process.cwd();
const REPORTS_DIR = path.join(process.env.HOME, '.openclaw/workspace/reports/security');
const IGNORE_DIRS = ['node_modules', '.git', 'dist', 'build', '.cache'];

// Security Patterns
const PATTERNS = {
    secrets: [
        { name: 'Generic API Key', regex: /"?[a-z0-9_-]*(?:key|api|token|secret|auth|password)"?\s*[:=]\s*"[a-z0-9\/+]{20,}"/gi },
        { name: 'OpenAI API Key', regex: /sk-[a-zA-Z0-9]{32,}/g },
        { name: 'Anthropic API Key', regex: /sk-ant-[a-zA-Z0-9-]{60,}/g },
        { name: 'AWS Access Key', regex: /AKIA[0-9A-Z]{16}/g },
        { name: 'Private Key', regex: /-----BEGIN (?:RSA|OPENSSH|EC|PEM) PRIVATE KEY-----/g }
    ],
    dangerous_code: [
        { name: 'Dynamic Execution', regex: /\beval\(|\bnew Function\(|\bexec\(|\bspawn\(|\bshell\s*:/g },
        { name: 'Insecure Crypto', regex: /\bmd5\(|\bsha1\(|\bcreateHash\(['"]md5/gi },
        { name: 'Hardcoded Domain/IP', regex: /https?:\/\/(?:\d{1,3}\.){3}\d{1,3}/g }
    ]
};

function walkDir(dir, callback) {
    if (!fs.existsSync(dir)) return;
    fs.readdirSync(dir).forEach(f => {
        let dirPath = path.join(dir, f);
        if (IGNORE_DIRS.some(d => dirPath.includes(d))) return;
        let stats = fs.statSync(dirPath);
        if (stats.isDirectory()) {
            walkDir(dirPath, callback);
        } else {
            callback(dirPath);
        }
    });
}

function scanFile(filePath) {
    const results = { secrets: [], code: [] };
    let content;
    try {
        content = fs.readFileSync(filePath, 'utf8');
    } catch (e) {
        return results;
    }
    const lines = content.split('\n');

    // Scan for Secrets
    PATTERNS.secrets.forEach(p => {
        lines.forEach((line, index) => {
            if (p.regex.test(line)) {
                results.secrets.push({ type: p.name, line: index + 1, snippet: line.trim().substring(0, 100) });
            }
        });
    });

    // Scan for Dangerous Code
    PATTERNS.dangerous_code.forEach(p => {
        lines.forEach((line, index) => {
            if (p.regex.test(line)) {
                results.code.push({ type: p.name, line: index + 1, snippet: line.trim().substring(0, 100) });
            }
        });
    });

    return results;
}

function main() {
    console.log(`🛡️  Starting Security Scan on: ${TARGET_DIR}`);
    if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });

    let allIssues = [];
    walkDir(TARGET_DIR, (filePath) => {
        const ext = path.extname(filePath);
        if (['.js', '.py', '.json', '.env', '.md', '.sh'].includes(ext)) {
            const issues = scanFile(filePath);
            if (issues.secrets.length > 0 || issues.code.length > 0) {
                allIssues.push({ file: path.relative(TARGET_DIR, filePath), ...issues });
            }
        }
    });

    // Generate Report
    const dateStr = new Date().toISOString().split('T')[0];
    const reportPath = path.join(REPORTS_DIR, `EXPERT_SCAN_${dateStr}.md`);
    let report = `# Expert Security Scan Report - ${dateStr}\n\n`;
    report += `**Scan Target:** \`${TARGET_DIR}\`\n`;
    report += `**Status:** ${allIssues.length > 0 ? '⚠️ ISSUES FOUND' : '✅ CLEAN'}\n\n`;

    if (allIssues.length > 0) {
        allIssues.forEach(issue => {
            report += `### 📄 ${issue.file}\n`;
            if (issue.secrets.length > 0) {
                report += `#### 🔑 Secrets Found\n`;
                issue.secrets.forEach(s => report += `- [L${s.line}] **${s.type}**: \`${s.snippet}\`\n`);
            }
            if (issue.code.length > 0) {
                report += `#### 🚨 Dangerous Patterns\n`;
                issue.code.forEach(c => report += `- [L${c.line}] **${c.type}**: \`${c.snippet}\`\n`);
            }
            report += `\n`;
        });
    } else {
        report += `No immediate security threats detected using built-in patterns.\n`;
    }

    fs.writeFileSync(reportPath, report);
    console.log(`\n✅ Scan Complete! Files with Issues: ${allIssues.length}`);
    console.log(`📄 Detailed Report: ${reportPath}`);
}

main();
