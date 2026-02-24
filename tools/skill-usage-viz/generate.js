#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const os = require("os");
const { execSync } = require("child_process");

const DEFAULT_REPORTS_DIR = path.join(os.homedir(), ".openclaw/workspace/reports/usage");

function findReportFiles(dir) {
    if (!fs.existsSync(dir)) process.exit(1);
    const files = fs.readdirSync(dir).filter(f => f.match(/^USAGE_REPORT_\d{4}-\d{2}-\d{2}\.md$/)).sort();
    return files.map(f => ({ path: path.join(dir, f), date: f.match(/(\d{4}-\d{2}-\d{2})/)[1] }));
}

function parseSkillUsage(content) {
    const skills = {};
    const sectionMatch = content.match(/## 🛠️ Internal Skill Usage[\s\S]*?(?=\n##|$)/);

    if (!sectionMatch) return skills;
    const rows = sectionMatch[1].split("\n").filter(line => line.trim().startsWith("|") && !line.includes(":---") && !line.includes("Skill Name"));
    for (const row of rows) {
        const match = row.match(/\|\s*\*\*([^*]+)\*\*\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|/);
        if (match) {
            const [, name, total, openclaw, gemini] = match;
            skills[name] = { total: parseInt(total, 10), openclaw: parseInt(openclaw, 10), gemini: parseInt(gemini, 10) };
        }
    }
    return skills;
}

function aggregateData(reportFiles) {
    const totals = {};
    for (const { path: filePath } of reportFiles) {
        const skills = parseSkillUsage(fs.readFileSync(filePath, "utf-8"));
        for (const [name, data] of Object.entries(skills)) {
            if (!totals[name]) totals[name] = { total: 0, openclaw: 0, gemini: 0 };
            totals[name].total += data.total;
            totals[name].openclaw += data.openclaw;
            totals[name].gemini += data.gemini;
        }
    }
    return { totals };
}

async function main() {
    try {
        const reports = findReportFiles(DEFAULT_REPORTS_DIR);
        const data = aggregateData(reports);
        const title = "OpenClaw Usage Report [" + new Date().toISOString().split("T")[0] + "]";
        const sheetInfo = JSON.parse(execSync("gog sheets create \"" + title + "\" --json").toString());
        const id = sheetInfo.spreadsheetId;
        const url = sheetInfo.spreadsheetUrl;
        
        const rows = [["Type", "Name", "Count"]];
        for (const [name, c] of Object.entries(data.totals).sort((a, b) => b[1].total - a[1].total)) {
            rows.push(["Total", name, c.total]);
            rows.push(["OpenClaw", name, c.openclaw]);
            rows.push(["Gemini CLI", name, c.gemini]);
        }
        
        const valuesJson = JSON.stringify(rows);
        const escapedJson = valuesJson.split("'").join("'''");
        execSync("gog sheets update \"" + id + "\" A1 --values-json '" + escapedJson + "'");
        
        process.stdout.write(url + "\n");
");
    } catch (e) { process.exit(1); }
}
main();
