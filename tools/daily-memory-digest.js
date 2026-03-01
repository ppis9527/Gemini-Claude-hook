#!/usr/bin/env node
/**
 * Daily Memory Digest Generator
 *
 * Extracts recent facts from memory.db, generates a structured daily report
 * using Gemini, and uploads to Google Drive for Obsidian sync.
 *
 * Usage: node daily-memory-digest.js [--date YYYY-MM-DD]
 */

const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Headless HOME for gemini -p: OAuth auth, no hooks, no MCP
const HEADLESS_HOME = '/tmp/gemini-headless';
const HEADLESS_GEMINI = path.join(HEADLESS_HOME, '.gemini');
const REAL_GEMINI = path.join(os.homedir(), '.gemini');
if (!fs.existsSync(HEADLESS_GEMINI)) {
    fs.mkdirSync(HEADLESS_GEMINI, { recursive: true });
}
fs.writeFileSync(path.join(HEADLESS_GEMINI, 'settings.json'),
    '{"security":{"auth":{"selectedType":"oauth-personal"}},"hooks":{},"mcpServers":{}}');
for (const f of ['google_accounts.json', 'oauth_creds.json']) {
    const src = path.join(REAL_GEMINI, f);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(HEADLESS_GEMINI, f));
}

const MEMORY_CLI = '/home/jerryyrliu/.openclaw/workspace/skills/memory-consolidation/cli/memory-cli.js';
const OUTPUT_DIR = '/home/jerryyrliu/.openclaw/workspace/reports/daily-digest';
const GDRIVE_DIR = path.join(process.env.HOME || '~', 'gdrive', '01_Obsidian', '02_daily-digest');

// Get date (Taiwan timezone)
function getTaiwanDate(offset = 0) {
    const now = new Date();
    now.setHours(now.getHours() + 8); // UTC+8
    now.setDate(now.getDate() + offset);
    return now.toISOString().split('T')[0];
}

// Parse command line args
const args = process.argv.slice(2);
const dateIdx = args.indexOf('--date');
const targetDate = dateIdx !== -1 ? args[dateIdx + 1] : getTaiwanDate();

console.log(`[daily-digest] Generating digest for: ${targetDate}`);

// Query recent facts from memory.db
function queryRecentFacts() {
    try {
        // Get all facts (we'll filter by source/timestamp later)
        const result = execSync(`node "${MEMORY_CLI}" search --limit 200`, {
            encoding: 'utf8',
            timeout: 30000
        });
        return result.trim();
    } catch (e) {
        console.error('[daily-digest] Failed to query memory:', e.message);
        return '';
    }
}

// Generate digest using Gemini
function generateDigest(facts) {
    const prompt = `你是一個 AI 助理系統的記憶管理員。根據以下從 memory.db 提取的 facts，生成一份結構化的每日摘要報告。

今天日期：${targetDate}

Facts:
${facts}

請生成 Markdown 格式的報告，包含：

1. **今日重點** - 3-5 個最重要的發現或決策
2. **技術筆記** - 值得記錄的技術細節、配置、或解決方案
3. **進行中的任務** - 尚未完成的工作
4. **學到的經驗** - 可以在未來複用的知識

報告要求：
- 使用繁體中文
- 簡潔有重點
- 適合放入 Obsidian 知識庫
- 不要包含敏感資訊（API keys, tokens 等）

只輸出 Markdown 內容，不要有其他說明。`;

    const result = spawnSync('gemini', ['-p', prompt, '-m', 'gemini-2.5-flash', '-y'], {
        encoding: 'utf8',
        cwd: HEADLESS_HOME,
        timeout: 120000,
        maxBuffer: 10 * 1024 * 1024,
        killSignal: 'SIGKILL',
        env: { ...process.env, HOME: HEADLESS_HOME }
    });

    if (result.status !== 0) {
        console.error('[daily-digest] Gemini failed:', result.stderr?.slice(0, 200));
        return null;
    }

    return result.stdout?.trim();
}

// Extract hashtags from content
function extractHashtags(content) {
    const keywords = new Set();

    // Common topics to detect
    const topicMap = {
        'notion': '#notion',
        'telegram': '#telegram',
        'memory': '#memory',
        'claude': '#claude',
        'gemini': '#gemini',
        'skill': '#skill',
        'bot': '#bot',
        'api': '#api',
        'gcp': '#gcp',
        'proxy': '#proxy',
        'cron': '#cron',
        'dispatch': '#dispatch',
        'hook': '#hooks',
        'obsidian': '#obsidian',
        'database': '#database',
        'debug': '#debug',
        'git': '#git'
    };

    const lowerContent = content.toLowerCase();
    for (const [keyword, tag] of Object.entries(topicMap)) {
        if (lowerContent.includes(keyword)) {
            keywords.add(tag);
        }
    }

    return Array.from(keywords).join(' ');
}

// Build final markdown
function buildMarkdown(content) {
    const hashtags = extractHashtags(content);

    return `---
date: ${targetDate}
type: daily-digest
source: memory.db
generated_by: gemini-2.5-flash
tags:
  - daily-digest
  - openclaw
---

# Daily Memory Digest - ${targetDate}

${content}

---
#openclaw #daily-digest #${targetDate} #VM ${hashtags}
`;
}

// Copy to Google Drive (via rclone mount)
function uploadToGDrive(filePath) {
    try {
        const dest = path.join(GDRIVE_DIR, path.basename(filePath));
        fs.copyFileSync(filePath, dest);
        return 'copied';
    } catch (e) {
        console.error('[daily-digest] GDrive copy failed:', e.message);
        return null;
    }
}

// Main
async function main() {
    // Ensure output directory exists
    if (!fs.existsSync(OUTPUT_DIR)) {
        fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }

    // Query facts
    console.log('[daily-digest] Querying memory.db...');
    const facts = queryRecentFacts();

    if (!facts || facts.length < 100) {
        console.log('[daily-digest] Not enough facts to generate digest');
        return;
    }

    // Generate digest
    console.log('[daily-digest] Generating digest with Gemini...');
    const digest = generateDigest(facts);

    if (!digest) {
        console.error('[daily-digest] Failed to generate digest');
        process.exit(1);
    }

    // Build markdown
    const markdown = buildMarkdown(digest);

    // Save locally
    const filename = `${targetDate}.md`;
    const filePath = path.join(OUTPUT_DIR, filename);
    fs.writeFileSync(filePath, markdown);
    console.log(`[daily-digest] Saved: ${filePath}`);

    // Upload to Google Drive
    console.log('[daily-digest] Uploading to Google Drive...');
    const link = uploadToGDrive(filePath);

    if (link) {
        console.log(`[daily-digest] Uploaded: ${link}`);
    }

    console.log('[daily-digest] Done!');
}

main().catch(e => {
    console.error('[daily-digest] Error:', e.message);
    process.exit(1);
});
