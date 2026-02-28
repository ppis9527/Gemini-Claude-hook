#!/usr/bin/env node
/**
 * Skill Usage Visualization - HTML + Chart.js
 *
 * 產生互動式 HTML 報告並上傳到 Google Drive
 * 包含：圓餅圖、長條圖、折線圖
 *
 * Usage:
 *   node generate.js                    # 所有報告
 *   node generate.js --date 0224        # 指定日期 (MMDD)
 *   node generate.js --days 7           # 最近 N 天
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const DEFAULT_REPORTS_DIR = path.join(os.homedir(), '.openclaw/workspace/reports/usage');
const GDRIVE_FOLDER = '1PAsTZMFRoc2c58pCyuf4i_dBlF6GAsBl';
const GOG_ACCOUNT = 'jerryyrliu@gmail.com';

function parseArgs() {
    const args = process.argv.slice(2);
    const options = {
        reportsDir: DEFAULT_REPORTS_DIR,
        filterDate: null,
        days: null
    };

    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--reports' && args[i + 1]) options.reportsDir = args[++i];
        if (args[i] === '--date' && args[i + 1]) options.filterDate = args[++i];
        if (args[i] === '--days' && args[i + 1]) options.days = parseInt(args[++i], 10);
    }

    return options;
}

function findReportFiles(dir) {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
        .filter(f => f.match(/^USAGE_REPORT_\d{4}-\d{2}-\d{2}\.md$/))
        .map(f => ({
            filename: f,
            date: f.match(/USAGE_REPORT_(\d{4}-\d{2}-\d{2})\.md/)[1],
            mmdd: f.match(/USAGE_REPORT_\d{4}-(\d{2})-(\d{2})\.md/).slice(1).join(''),
            path: path.join(dir, f)
        }))
        .sort((a, b) => b.date.localeCompare(a.date));
}

function parseSkillUsageTable(content) {
    const skills = {};
    const match = content.match(/## 🛠️ Internal Skill Usage[^\n]*[\s\S]*?(?=\n##|$)/);
    if (!match) return skills;

    for (const line of match[0].split('\n')) {
        const m = line.match(/\|\s*\*\*(.+?)\*\*\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|/);
        if (m) {
            skills[m[1]] = {
                total: parseInt(m[2], 10),
                openclaw: parseInt(m[3], 10),
                gemini: parseInt(m[4], 10)
            };
        }
    }
    return skills;
}

function parseModelTable(content) {
    const models = {};
    const sectionMatch = content.match(/## 🤖 Model Call Counts([\s\S]+?)(?=\n## [^#]|$)/);
    if (!sectionMatch) return models;

    for (const line of sectionMatch[1].split('\n')) {
        const m = line.match(/-\s*\*\*(.+?)\*\*:\s*([\d,]+)\s*calls/);
        if (m) {
            const name = m[1];
            const count = parseInt(m[2].replace(/,/g, ''), 10);
            models[name] = (models[name] || 0) + count;
        }
    }
    return models;
}

function parseReportMetadata(content) {
    const daysMatch = content.match(/Last (\d+) Days/);
    const genMatch = content.match(/Generated: (\d{4}-\d{2}-\d{2})/);
    if (daysMatch && genMatch) {
        const days = parseInt(daysMatch[1], 10);
        const endDate = genMatch[1];
        const start = new Date(endDate + 'T00:00:00+08:00');
        start.setDate(start.getDate() - days + 1);
        return { startDate: start.toISOString().split('T')[0], endDate };
    }
    return null;
}

function generateHTML(data) {
    const { totals, byDate, dates, sortedSkills, modelTotals } = data;

    const totalSkills = sortedSkills.length;
    const totalCalls = Object.values(modelTotals).reduce((a, b) => a + b, 0) || sortedSkills.reduce((s, [, d]) => s + d.total, 0);
    const totalOC = sortedSkills.reduce((s, [, d]) => s + d.openclaw, 0);
    const totalGC = sortedSkills.reduce((s, [, d]) => s + d.gemini, 0);
    const modelData = Object.entries(modelTotals).sort((a, b) => b[1] - a[1]);

    const top10 = sortedSkills.slice(0, 10);
    const colors = [
        '#4e79a7', '#f28e2c', '#e15759', '#76b7b2', '#59a14f',
        '#edc949', '#af7aa1', '#ff9da7', '#9c755f', '#bab0ab'
    ];

    const modelListHtml = modelData.map(([name, count], i) => {
        const pct = totalCalls > 0 ? ((count / totalCalls) * 100).toFixed(1) : '0';
        return `<div class="rank-item">
            <span class="rank" style="background:${colors[i % colors.length]}">${i + 1}</span>
            <span class="name">${name}</span>
            <span class="count">${count.toLocaleString()} calls (${pct}%)</span>
        </div>`;
    }).join('');

    const skillListHtml = top10.map(([name, d], i) => {
        const pct = totalCalls > 0 ? ((d.total / totalCalls) * 100).toFixed(1) : '0';
        return `<div class="rank-item">
            <span class="rank" style="background:${colors[i % colors.length]}">${i + 1}</span>
            <span class="name">${name}</span>
            <span class="count">${d.total} calls (${pct}%) OC:${d.openclaw} GC:${d.gemini}</span>
        </div>`;
    }).join('');

    const rankingHtml = sortedSkills.map(([name, d], i) => {
        const rankClass = i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : '';
        return `<div class="rank-item">
            <span class="rank ${rankClass}">${i + 1}</span>
            <span class="name">${name}</span>
            <span class="count">${d.total} (OC:${d.openclaw} GC:${d.gemini})</span>
        </div>`;
    }).join('');

    return `<!DOCTYPE html>
<html lang="zh-TW">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Skill Usage Report</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
            color: #e0e0e0;
            min-height: 100vh;
            padding: 20px;
        }
        .container { max-width: 1400px; margin: 0 auto; }
        h1 {
            text-align: center;
            font-size: 2em;
            margin-bottom: 10px;
            background: linear-gradient(90deg, #00d4ff, #7c3aed);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }
        .subtitle { text-align: center; color: #888; margin-bottom: 20px; }
        .stats {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
            gap: 15px;
            margin-bottom: 20px;
        }
        .stat {
            background: rgba(255,255,255,0.05);
            padding: 15px;
            border-radius: 10px;
            text-align: center;
        }
        .stat-value {
            font-size: 1.8em;
            font-weight: bold;
            background: linear-gradient(90deg, #00d4ff, #7c3aed);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }
        .stat-label { color: #888; font-size: 0.9em; }
        .grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(400px, 1fr));
            gap: 20px;
            margin-bottom: 20px;
        }
        .card {
            background: rgba(255,255,255,0.05);
            border-radius: 12px;
            padding: 20px;
        }
        .card h2 { font-size: 1.1em; margin-bottom: 15px; color: #fff; }
        .chart-container { position: relative; height: 300px; }
        .ranking {
            max-height: 400px;
            overflow-y: auto;
        }
        .rank-item {
            display: flex;
            align-items: center;
            padding: 8px 10px;
            border-radius: 6px;
            margin-bottom: 5px;
            background: rgba(255,255,255,0.03);
        }
        .rank-item:hover { background: rgba(255,255,255,0.08); }
        .rank {
            width: 28px;
            height: 28px;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 6px;
            font-weight: bold;
            font-size: 0.9em;
            background: linear-gradient(135deg, #7c3aed, #4f46e5);
            margin-right: 10px;
        }
        .rank.gold { background: linear-gradient(135deg, #f59e0b, #d97706); }
        .rank.silver { background: linear-gradient(135deg, #9ca3af, #6b7280); }
        .rank.bronze { background: linear-gradient(135deg, #b45309, #92400e); }
        .name { flex: 1; }
        .count { color: #888; font-size: 0.85em; }
        .footer { text-align: center; color: #666; margin-top: 20px; font-size: 0.85em; }
    </style>
</head>
<body>
    <div class="container">
        <h1>🛠️ Skill Usage Analytics</h1>
        <p class="subtitle">
            ${dates.length > 0 ? `${dates[dates.length - 1]} ~ ${dates[0]}` : 'N/A'} |
            Generated: ${new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })}
        </p>

        <div class="stats">
            <div class="stat">
                <div class="stat-value">${totalSkills}</div>
                <div class="stat-label">Skills</div>
            </div>
            <div class="stat">
                <div class="stat-value">${totalCalls.toLocaleString()}</div>
                <div class="stat-label">Total Calls</div>
            </div>
            <div class="stat">
                <div class="stat-value">${totalOC.toLocaleString()}</div>
                <div class="stat-label">OpenClaw</div>
            </div>
            <div class="stat">
                <div class="stat-value">${totalGC.toLocaleString()}</div>
                <div class="stat-label">Gemini CLI</div>
            </div>
        </div>

        <div class="grid">
            <div class="card">
                <h2>🤖 Model Distribution</h2>
                <div class="chart-container">
                    <canvas id="modelChart"></canvas>
                </div>
            </div>
            <div class="card">
                <h2>🤖 Model Breakdown</h2>
                <div class="ranking">${modelListHtml}</div>
            </div>
        </div>

        <div class="grid">
            <div class="card">
                <h2>📊 Top 10 Skills</h2>
                <div class="chart-container">
                    <canvas id="pieChart"></canvas>
                </div>
            </div>
            <div class="card">
                <h2>📊 Skill Breakdown (Top 10)</h2>
                <div class="ranking">${skillListHtml}</div>
            </div>
        </div>

        <div class="grid">
            <div class="card">
                <h2>📈 OpenClaw vs Gemini CLI</h2>
                <div class="chart-container">
                    <canvas id="barChart"></canvas>
                </div>
            </div>
        </div>

        <div class="card">
            <h2>🏆 Skill Rankings</h2>
            <div class="ranking">${rankingHtml}</div>
        </div>

        <p class="footer">Auto-generated by skill-usage-viz</p>
    </div>

    <script>
        const colors = ${JSON.stringify(colors)};
        const top10 = ${JSON.stringify(top10)};
        const modelData = ${JSON.stringify(modelData)};

        // Model Distribution Chart
        new Chart(document.getElementById('modelChart'), {
            type: 'doughnut',
            data: {
                labels: modelData.map(([n]) => n),
                datasets: [{
                    data: modelData.map(([, c]) => c),
                    backgroundColor: colors,
                    borderWidth: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'right', labels: { color: '#e0e0e0', font: { size: 11 } } }
                }
            }
        });

        // Skill Pie Chart
        new Chart(document.getElementById('pieChart'), {
            type: 'doughnut',
            data: {
                labels: top10.map(([n]) => n),
                datasets: [{
                    data: top10.map(([, d]) => d.total),
                    backgroundColor: colors,
                    borderWidth: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'right', labels: { color: '#e0e0e0', font: { size: 11 } } }
                }
            }
        });

        // Bar Chart
        new Chart(document.getElementById('barChart'), {
            type: 'bar',
            data: {
                labels: top10.map(([n]) => n),
                datasets: [
                    { label: 'OpenClaw', data: top10.map(([, d]) => d.openclaw), backgroundColor: '#4e79a7' },
                    { label: 'Gemini CLI', data: top10.map(([, d]) => d.gemini), backgroundColor: '#f28e2c' }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { labels: { color: '#e0e0e0' } } },
                scales: {
                    x: { stacked: true, ticks: { color: '#888' }, grid: { color: 'rgba(255,255,255,0.05)' } },
                    y: { stacked: true, ticks: { color: '#888' }, grid: { color: 'rgba(255,255,255,0.1)' } }
                }
            }
        });
    </script>
</body>
</html>`;
}

function uploadToGDrive(filePath, fileName) {
    try {
        const password = execSync('gcloud secrets versions access latest --secret=GOG_KEYRING_PASSWORD', { encoding: 'utf8' }).trim();
        execSync(`GOG_KEYRING_PASSWORD="${password}" gog drive upload "${filePath}" --parent "${GDRIVE_FOLDER}" --account "${GOG_ACCOUNT}" --name "${fileName}"`, { encoding: 'utf8', timeout: 60000 });
        return true;
    } catch (e) {
        return false;
    }
}

function main() {
    const options = parseArgs();

    console.log('🔍 Scanning reports...');
    let reports = findReportFiles(options.reportsDir);

    if (reports.length === 0) {
        console.error('❌ No reports found');
        process.exit(1);
    }

    // Filter by date if specified
    if (options.filterDate) {
        reports = reports.filter(r => r.mmdd === options.filterDate);
    }

    // Filter by days if specified
    if (options.days) {
        reports = reports.slice(0, options.days);
    }

    console.log(`📊 Processing ${reports.length} report(s)`);

    // Aggregate data
    const totals = {};
    const modelTotals = {};
    const byDate = {};
    const dates = [];

    for (const report of reports) {
        const content = fs.readFileSync(report.path, 'utf-8');
        const skills = parseSkillUsageTable(content);
        const models = parseModelTable(content);

        if (Object.keys(skills).length === 0) continue;

        dates.push(report.date);
        byDate[report.date] = skills;

        for (const [skill, data] of Object.entries(skills)) {
            if (!totals[skill]) totals[skill] = { total: 0, openclaw: 0, gemini: 0 };
            totals[skill].total += data.total;
            totals[skill].openclaw += data.openclaw;
            totals[skill].gemini += data.gemini;
        }

        for (const [model, count] of Object.entries(models)) {
            modelTotals[model] = (modelTotals[model] || 0) + count;
        }
    }

    const sortedSkills = Object.entries(totals).sort((a, b) => b[1].total - a[1].total);

    if (sortedSkills.length === 0) {
        console.error('❌ No skill data found');
        process.exit(1);
    }

    // Generate HTML
    const html = generateHTML({ totals, byDate, dates, sortedSkills, modelTotals });

    // Save locally
    const dateStr = new Date().toISOString().split('T')[0].replace(/-/g, '');
    const fileName = `skill-usage-${dateStr}.html`;
    const localPath = path.join(options.reportsDir, fileName);

    fs.writeFileSync(localPath, html);
    console.log(`✅ Saved: ${localPath}`);

    // Upload to GDrive
    console.log('☁️ Uploading to Google Drive...');
    if (uploadToGDrive(localPath, fileName)) {
        console.log('✅ Uploaded to GDrive');
    } else {
        console.log('⚠️ Upload failed');
    }

    console.log(`\n📂 Local: ${localPath}`);
}

main();
