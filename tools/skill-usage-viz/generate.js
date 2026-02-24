#!/usr/bin/env node
/**
 * Skill Usage Visualization - Google Sheets
 *
 * Structure (single sheet):
 * - Section 1: Total (aggregated)
 * - Section 2+: Individual date ranges (older first, newer last)
 *
 * Time range: Taiwan time 00:00 ~ 23:59
 *
 * Usage: node generate.js [--reports <dir>]
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const DEFAULT_REPORTS_DIR = path.join(os.homedir(), '.openclaw/workspace/reports/usage');
const GDRIVE_FOLDER = '1PAsTZMFRoc2c58pCyuf4i_dBlF6GAsBl';
const GOG_ACCOUNT = 'jerryyrliu@gmail.com';
const SPREADSHEET_NAME = 'Skill Usage Dashboard';

function parseArgs() {
    const args = process.argv.slice(2);
    return {
        reportsDir: args.includes('--reports') ? args[args.indexOf('--reports') + 1] : DEFAULT_REPORTS_DIR
    };
}

function findReportFiles(dir) {
    if (!fs.existsSync(dir)) return [];
    const files = fs.readdirSync(dir);
    return files
        .filter(f => f.match(/^USAGE_REPORT_\d{4}-\d{2}-\d{2}\.md$/))
        .map(f => ({
            filename: f,
            date: f.match(/USAGE_REPORT_(\d{4}-\d{2}-\d{2})\.md/)[1],
            path: path.join(dir, f)
        }))
        .sort((a, b) => a.date.localeCompare(b.date));
}

function parseSkillUsageTable(content) {
    const skills = {};
    const skillSectionMatch = content.match(/## 🛠️ Internal Skill Usage[^\n]*[\s\S]*?(?=\n##|$)/);
    if (!skillSectionMatch) return skills;

    const lines = skillSectionMatch[0].split('\n');
    for (const line of lines) {
        const match = line.match(/\|\s*\*\*(.+?)\*\*\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|/);
        if (match) {
            const [, skillName, total, openclaw, gemini] = match;
            skills[skillName] = {
                total: parseInt(total, 10),
                openclaw: parseInt(openclaw, 10),
                gemini: parseInt(gemini, 10)
            };
        }
    }
    return skills;
}

function parseReportMetadata(content) {
    const daysMatch = content.match(/Last (\d+) Days/);
    const genMatch = content.match(/Generated: (\d{4}-\d{2}-\d{2})/);

    if (daysMatch && genMatch) {
        const days = parseInt(daysMatch[1], 10);
        const endDate = genMatch[1];
        const start = new Date(endDate + 'T00:00:00+08:00');
        start.setDate(start.getDate() - days + 1);

        return {
            startDate: start.toISOString().split('T')[0],
            endDate: endDate,
            days: days
        };
    }
    return null;
}

function processReports(reports) {
    const allTotals = {};
    const byReport = [];

    for (const report of reports) {
        const content = fs.readFileSync(report.path, 'utf-8');
        const skills = parseSkillUsageTable(content);
        const meta = parseReportMetadata(content);

        if (Object.keys(skills).length === 0) continue;

        const dateRange = meta
            ? `${meta.startDate} ~ ${meta.endDate}`
            : report.date;

        byReport.push({ date: report.date, dateRange, skills, meta });

        for (const [skill, data] of Object.entries(skills)) {
            if (!allTotals[skill]) {
                allTotals[skill] = { total: 0, openclaw: 0, gemini: 0 };
            }
            allTotals[skill].total += data.total;
            allTotals[skill].openclaw += data.openclaw;
            allTotals[skill].gemini += data.gemini;
        }
    }

    const sortedTotals = Object.entries(allTotals).sort((a, b) => b[1].total - a[1].total);
    return { sortedTotals, byReport };
}

function getGogPassword() {
    try {
        return execSync('gcloud secrets versions access latest --secret=GOG_KEYRING_PASSWORD', {
            encoding: 'utf8'
        }).trim();
    } catch (e) {
        console.error('Failed to get GOG_KEYRING_PASSWORD');
        process.exit(1);
    }
}

function findExistingSpreadsheet(password) {
    try {
        const searchCmd = `GOG_KEYRING_PASSWORD="${password}" gog drive ls --parent "${GDRIVE_FOLDER}" --account "${GOG_ACCOUNT}" --json`;
        const result = execSync(searchCmd, { encoding: 'utf8' });
        const data = JSON.parse(result);
        const files = data.files || [];

        for (const file of files) {
            if (file.name === SPREADSHEET_NAME && file.mimeType === 'application/vnd.google-apps.spreadsheet') {
                return file.id;
            }
        }
    } catch (e) {}
    return null;
}

function createSpreadsheet(password) {
    const createCmd = `GOG_KEYRING_PASSWORD="${password}" gog sheets create "${SPREADSHEET_NAME}" --account "${GOG_ACCOUNT}" --json`;
    const sheetInfo = JSON.parse(execSync(createCmd, { encoding: 'utf8' }));

    try {
        const moveCmd = `GOG_KEYRING_PASSWORD="${password}" gog drive move "${sheetInfo.spreadsheetId}" --parent "${GDRIVE_FOLDER}" --account "${GOG_ACCOUNT}"`;
        execSync(moveCmd, { encoding: 'utf8', timeout: 30000 });
    } catch (e) {}

    return sheetInfo.spreadsheetId;
}

function buildAllRows(sortedTotals, byReport) {
    const rows = [];
    const now = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });

    // ===== TOTAL SECTION =====
    rows.push(['📊 TOTAL (彙總)', '', '', '']);
    rows.push(['時區: 台灣 (UTC+8)', '', '', '']);
    rows.push(['更新時間', now, '', '']);
    rows.push([]);
    rows.push(['Skill Name', 'Total', 'OpenClaw', 'Gemini CLI']);

    for (const [name, d] of sortedTotals) {
        rows.push([name, d.total, d.openclaw, d.gemini]);
    }

    const totalAll = sortedTotals.reduce((sum, [, d]) => sum + d.total, 0);
    const totalOC = sortedTotals.reduce((sum, [, d]) => sum + d.openclaw, 0);
    const totalGC = sortedTotals.reduce((sum, [, d]) => sum + d.gemini, 0);
    rows.push([]);
    rows.push(['TOTAL', totalAll, totalOC, totalGC]);

    // ===== INDIVIDUAL DATE SECTIONS =====
    // Sort by date (older first, newer last = left to right when reading)
    for (const report of byReport) {
        rows.push([]);
        rows.push([]);  // Double blank for visual separation
        rows.push([`📅 ${report.dateRange}`, '', '', '']);
        rows.push(['Skill Name', 'Total', 'OpenClaw', 'Gemini CLI']);

        const sortedSkills = Object.entries(report.skills).sort((a, b) => b[1].total - a[1].total);
        for (const [name, d] of sortedSkills) {
            rows.push([name, d.total, d.openclaw, d.gemini]);
        }

        const periodTotal = sortedSkills.reduce((sum, [, d]) => sum + d.total, 0);
        const periodOC = sortedSkills.reduce((sum, [, d]) => sum + d.openclaw, 0);
        const periodGC = sortedSkills.reduce((sum, [, d]) => sum + d.gemini, 0);
        rows.push([]);
        rows.push(['TOTAL', periodTotal, periodOC, periodGC]);
    }

    return rows;
}

function main() {
    const options = parseArgs();

    console.log('🔍 Scanning for usage reports...');
    const reports = findReportFiles(options.reportsDir);

    if (reports.length === 0) {
        console.error('❌ No USAGE_REPORT_*.md files found');
        process.exit(1);
    }

    console.log(`📊 Found ${reports.length} report(s): ${reports.map(r => r.date).join(', ')}`);

    const { sortedTotals, byReport } = processReports(reports);

    if (sortedTotals.length === 0) {
        console.error('❌ No skill usage data found');
        process.exit(1);
    }

    console.log(`📈 ${sortedTotals.length} skills across ${byReport.length} reports`);

    const password = getGogPassword();

    // Find or create spreadsheet
    let spreadsheetId = findExistingSpreadsheet(password);

    if (spreadsheetId) {
        console.log(`📄 Found existing: ${SPREADSHEET_NAME}`);
    } else {
        console.log('📝 Creating new spreadsheet...');
        spreadsheetId = createSpreadsheet(password);
        console.log(`✅ Created: ${SPREADSHEET_NAME}`);
    }

    const url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;

    // Build all rows
    const rows = buildAllRows(sortedTotals, byReport);

    // Write data
    console.log('📤 Writing data...');
    const valuesJson = JSON.stringify(rows).replace(/'/g, "'\\''");
    const updateCmd = `GOG_KEYRING_PASSWORD="${password}" gog sheets update "${spreadsheetId}" A1 --account "${GOG_ACCOUNT}" --values-json '${valuesJson}'`;

    try {
        execSync(updateCmd, { encoding: 'utf8' });
        console.log('✅ Data written');
    } catch (e) {
        console.error('❌ Write failed:', e.message);
    }

    console.log(`\n🔗 ${url}`);
}

main();
