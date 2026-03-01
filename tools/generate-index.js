#!/usr/bin/env node
/**
 * Generate INDEX.md for OpenClaw Workspace
 *
 * Scans skills, tools, and system scripts to create a unified index.
 * Uploads to Google Drive.
 *
 * Usage: node generate-index.js [--upload]
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Config
const WORKSPACE = path.join(process.env.HOME, '.openclaw/workspace');
const OUTPUT_FILE = path.join(WORKSPACE, 'WORKSPACE-CATALOG.md');
const GDRIVE_DIR = path.join(process.env.HOME, 'gdrive', '01_Obsidian');
const UPLOAD = process.argv.includes('--upload');

function getDate() {
    return new Date().toISOString().split('T')[0];
}

function getTimestamp() {
    return new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });
}

// Extract description from SKILL.md
function parseSkillMd(filePath) {
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        const lines = content.split('\n');

        // Get title (first # line)
        const titleLine = lines.find(l => l.startsWith('# '));
        const title = titleLine ? titleLine.replace('# ', '').trim() : '';

        // Get first paragraph after title as description
        let desc = '';
        let foundTitle = false;
        for (const line of lines) {
            if (line.startsWith('# ')) {
                foundTitle = true;
                continue;
            }
            if (foundTitle && line.trim() && !line.startsWith('#')) {
                desc = line.trim();
                break;
            }
        }

        return { title, desc: desc.slice(0, 100) + (desc.length > 100 ? '...' : '') };
    } catch (e) {
        return { title: '', desc: '' };
    }
}

// Extract description from JS file header comment
function parseJsHeader(filePath) {
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        const lines = content.split('\n');

        // Look for /** ... */ or // comments at top
        let desc = '';
        let inComment = false;

        for (const line of lines) {
            if (line.includes('/**')) {
                inComment = true;
                continue;
            }
            if (line.includes('*/')) {
                break;
            }
            if (inComment) {
                const cleaned = line.replace(/^\s*\*\s?/, '').trim();
                if (cleaned && !cleaned.startsWith('@') && !cleaned.startsWith('Usage')) {
                    desc = cleaned;
                    break;
                }
            }
            // Single line comment
            if (line.startsWith('//') && !desc) {
                desc = line.replace('//', '').trim();
                if (desc) break;
            }
        }

        return desc.slice(0, 100) + (desc.length > 100 ? '...' : '');
    } catch (e) {
        return '';
    }
}

// Extract description from shell script header
function parseShHeader(filePath) {
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        const lines = content.split('\n');

        let desc = '';
        for (const line of lines) {
            if (line.startsWith('#!')) continue;
            if (line.startsWith('# ') && !desc) {
                desc = line.replace('# ', '').trim();
                if (desc && !desc.includes('Cron:') && !desc.includes('Usage:')) {
                    break;
                }
                desc = '';
            }
        }

        return desc.slice(0, 100) + (desc.length > 100 ? '...' : '');
    } catch (e) {
        return '';
    }
}

// Scan skills directory
function scanSkills() {
    const skillsDir = path.join(WORKSPACE, 'skills');
    const skills = [];

    if (!fs.existsSync(skillsDir)) return skills;

    const dirs = fs.readdirSync(skillsDir).filter(d => {
        const stat = fs.statSync(path.join(skillsDir, d));
        return stat.isDirectory();
    });

    for (const dir of dirs.sort()) {
        const skillMd = path.join(skillsDir, dir, 'SKILL.md');
        if (fs.existsSync(skillMd)) {
            const { title, desc } = parseSkillMd(skillMd);
            skills.push({ name: dir, title: title || dir, desc });
        } else {
            // No SKILL.md, try README.md
            const readmeMd = path.join(skillsDir, dir, 'README.md');
            if (fs.existsSync(readmeMd)) {
                const { title, desc } = parseSkillMd(readmeMd);
                skills.push({ name: dir, title: title || dir, desc });
            } else {
                skills.push({ name: dir, title: dir, desc: '(no description)' });
            }
        }
    }

    return skills;
}

// Extract description from Python file header
function parsePyHeader(filePath) {
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        const lines = content.split('\n');

        // Look for docstring """ or '''
        let desc = '';
        let inDocstring = false;
        let docstringChar = '';

        for (const line of lines) {
            if (!inDocstring && (line.includes('"""') || line.includes("'''"))) {
                docstringChar = line.includes('"""') ? '"""' : "'''";
                inDocstring = true;
                // Check if single line docstring
                const match = line.match(new RegExp(`${docstringChar}(.+?)${docstringChar}`));
                if (match) {
                    desc = match[1].trim();
                    break;
                }
                continue;
            }
            if (inDocstring) {
                if (line.includes(docstringChar)) break;
                if (line.trim() && !desc) {
                    desc = line.trim();
                    break;
                }
            }
            // Fallback: # comment at top
            if (line.startsWith('#') && !line.startsWith('#!') && !desc) {
                desc = line.replace('#', '').trim();
                if (desc) break;
            }
        }

        return desc.slice(0, 100) + (desc.length > 100 ? '...' : '');
    } catch (e) {
        return '';
    }
}

// Scan tools directory
function scanTools() {
    const toolsDir = path.join(WORKSPACE, 'tools');
    const tools = [];

    if (!fs.existsSync(toolsDir)) return tools;

    const items = fs.readdirSync(toolsDir);

    for (const item of items.sort()) {
        const itemPath = path.join(toolsDir, item);
        const stat = fs.statSync(itemPath);

        if (stat.isDirectory()) {
            // Check for README.md in subdirectory
            const readmePath = path.join(itemPath, 'README.md');
            if (fs.existsSync(readmePath)) {
                const { desc } = parseSkillMd(readmePath);
                tools.push({ name: `${item}/`, desc: desc || '(tool directory)' });
            } else {
                tools.push({ name: `${item}/`, desc: '(tool directory)' });
            }
        } else if (item.endsWith('.js')) {
            tools.push({ name: item, desc: parseJsHeader(itemPath) || '(no description)' });
        } else if (item.endsWith('.sh')) {
            tools.push({ name: item, desc: parseShHeader(itemPath) || '(no description)' });
        } else if (item.endsWith('.py')) {
            tools.push({ name: item, desc: parsePyHeader(itemPath) || '(no description)' });
        }
    }

    return tools;
}

// Scan system directory
function scanSystem() {
    const systemDir = path.join(WORKSPACE, 'system');
    const items = [];

    if (!fs.existsSync(systemDir)) return items;

    const files = fs.readdirSync(systemDir);

    for (const file of files.sort()) {
        const filePath = path.join(systemDir, file);
        const stat = fs.statSync(filePath);

        if (stat.isFile()) {
            let desc = '';
            if (file.endsWith('.sh')) {
                desc = parseShHeader(filePath);
            } else if (file.endsWith('.txt') || file.endsWith('.md')) {
                desc = `Configuration file`;
            }
            items.push({ name: file, desc: desc || '(no description)' });
        }
    }

    return items;
}

// Scan reports directory
function scanReports() {
    const reportsDir = path.join(WORKSPACE, 'reports');
    const items = [];

    if (!fs.existsSync(reportsDir)) return items;

    const dirs = fs.readdirSync(reportsDir).filter(d => {
        const stat = fs.statSync(path.join(reportsDir, d));
        return stat.isDirectory();
    });

    // Predefined descriptions for known report types
    const descriptions = {
        'daily-digest': '每日摘要 / Daily digest',
        'usage': 'Skill 使用統計報告 / Skill usage statistics',
        'system-health': '系統健康報告 / System health reports',
        'decisions': '決策紀錄 / Decision records',
        'github_weekly': 'GitHub 每週趨勢 / GitHub weekly trends',
        'openclaw-spec': 'OpenClaw 規格文件 / OpenClaw specifications'
    };

    for (const dir of dirs.sort()) {
        const desc = descriptions[dir] || '(reports)';
        // Count files in directory
        const dirPath = path.join(reportsDir, dir);
        const fileCount = fs.readdirSync(dirPath).filter(f => !f.startsWith('.')).length;
        items.push({ name: `${dir}/`, desc: `${desc} (${fileCount} files)` });
    }

    return items;
}

// Generate markdown (bilingual: 繁體中文 + English)
function generateMarkdown(skills, tools, system, reports) {
    const date = getDate();
    const timestamp = getTimestamp();

    let md = `# 工作區目錄 / Workspace Catalog

**最後更新 / Last Updated**: ${timestamp}

---

## 技能 Skills (${skills.length})

AI 代理可使用的技能模組。
Skill modules available to AI agents.

| 名稱 Name | 說明 Description |
|-----------|------------------|
`;

    for (const s of skills) {
        md += `| \`${s.name}\` | ${s.desc.replace(/\|/g, '\\|')} |\n`;
    }

    md += `
## 工具 Tools (${tools.length})

獨立腳本與工具程式。
Standalone scripts and utilities.

| 名稱 Name | 說明 Description |
|-----------|------------------|
`;

    for (const t of tools) {
        md += `| \`${t.name}\` | ${t.desc.replace(/\|/g, '\\|')} |\n`;
    }

    md += `
## 系統 System (${system.length})

系統配置與管理腳本。
System configuration and management scripts.

| 名稱 Name | 說明 Description |
|-----------|------------------|
`;

    for (const s of system) {
        md += `| \`${s.name}\` | ${s.desc.replace(/\|/g, '\\|')} |\n`;
    }

    md += `
## 報告 Reports (${reports.length})

自動產生的報告資料夾。
Auto-generated report directories.

| 名稱 Name | 說明 Description |
|-----------|------------------|
`;

    for (const r of reports) {
        md += `| \`${r.name}\` | ${r.desc.replace(/\|/g, '\\|')} |\n`;
    }

    md += `
---

## 排程任務 Cron Jobs

定時執行的自動化任務。
Scheduled automation tasks.

\`\`\`
`;

    // Include cron jobs
    try {
        const crons = execSync('crontab -l 2>/dev/null || true', { encoding: 'utf8' });
        md += crons || '(no cron jobs)';
    } catch (e) {
        md += '(unable to read cron)';
    }

    md += `
\`\`\`

---

## 雲端資料夾 Google Drive Folders

報告自動上傳的目標位置。
Destinations for automated report uploads.

| 報告類型 Report Type | Folder ID |
|---------------------|-----------|
| 每日摘要 Daily Digest | \`1TFO2BI7HcZorHxze3PtaX5pJIfYWkIOW\` |
| 決策紀錄 Decisions | \`1kGbGb-OX_7Spms6dbRoSfYxL5AdImahK\` |
| 系統健康 System Health | \`103KLvYwFVcVCYYEeDyRsuT39nDj5ct8E\` |
| 每週主題 Weekly Topics | \`15AQdXxH1MxJHsGOWaowk-Flz8LiES22h\` |
| 工作區目錄 Catalog | \`1jw4yYI0P83FWZiF4_xBS1iGymNivO9EG\` |

---
*由 generate-index.js 自動產生 / Auto-generated by generate-index.js*
#openclaw #workspace-catalog #\${getDate()} #VM
`;

    return md;
}

// Copy to Google Drive (via rclone mount)
function uploadToGDrive(filePath) {
    try {
        const date = getDate();
        const dest = path.join(GDRIVE_DIR, `WORKSPACE-CATALOG-${date}.md`);
        fs.copyFileSync(filePath, dest);
        return true;
    } catch (e) {
        console.error('[generate-index] GDrive copy failed:', e.message);
        return false;
    }
}

// Main
function main() {
    console.log('[generate-index] Scanning workspace...');

    const skills = scanSkills();
    console.log(`  Found ${skills.length} skills`);

    const tools = scanTools();
    console.log(`  Found ${tools.length} tools`);

    const system = scanSystem();
    console.log(`  Found ${system.length} system items`);

    const reports = scanReports();
    console.log(`  Found ${reports.length} report types`);

    const md = generateMarkdown(skills, tools, system, reports);

    // Save locally
    fs.writeFileSync(OUTPUT_FILE, md);
    console.log(`[generate-index] Saved: ${OUTPUT_FILE}`);

    // Upload if requested
    if (UPLOAD) {
        console.log('[generate-index] Uploading to Google Drive...');
        const ok = uploadToGDrive(OUTPUT_FILE);
        console.log(`[generate-index] Upload: ${ok ? 'success' : 'failed'}`);
    }

    console.log('[generate-index] Done');
}

main();
