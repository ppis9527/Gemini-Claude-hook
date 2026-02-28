#!/usr/bin/env node
/**
 * System Health Monitor
 *
 * Checks system health and reports to TG + Google Drive
 * - Disk space, memory, uptime
 * - PM2 services (erxia-bot, xiaoxu-bot)
 * - Memory DB status
 * - Cron jobs last run
 *
 * Usage: node system-health.js [--notify-always]
 *
 * Cron: 0 21 * * * (5:00 AM Taiwan time)
 */

const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Config
const TG_GROUP = '-1003738302620';
const GDRIVE_FOLDER = '103KLvYwFVcVCYYEeDyRsuT39nDj5ct8E';
const GOG_ACCOUNT = 'jerryyrliu@gmail.com';
const REPORT_DIR = path.join(process.env.HOME, '.openclaw/workspace/reports/system-health');
const MEMORY_DB = path.join(process.env.HOME, '.openclaw/workspace/skills/memory-consolidation/memory.db');
const NOTIFY_ALWAYS = process.argv.includes('--notify-always');

// Thresholds
const DISK_WARNING = 75;
const DISK_CRITICAL = 90;
const MEMORY_WARNING = 80;

// Ensure PATH includes nvm node for cron environment
const NVM_BIN = '/home/jerryyrliu/.nvm/versions/node/v24.13.0/bin';
const EXEC_ENV = { ...process.env, PATH: `${NVM_BIN}:${process.env.PATH}` };

function exec(cmd) {
    try {
        return execSync(cmd, { encoding: 'utf8', timeout: 30000, env: EXEC_ENV }).trim();
    } catch (e) {
        return null;
    }
}

function getDate() {
    return new Date().toISOString().split('T')[0];
}

function getTimestamp() {
    return new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });
}

// Check disk space
function checkDisk() {
    const result = { status: 'ok', items: [] };
    const output = exec('df -h');
    if (!output) return { status: 'error', items: [{ name: 'df', status: 'error', msg: 'Failed to run df' }] };

    const lines = output.split('\n').slice(1);
    for (const line of lines) {
        const parts = line.split(/\s+/);
        if (parts.length >= 6) {
            const [fs, size, used, avail, useStr, mount] = parts;
            const use = parseInt(useStr);
            if (isNaN(use)) continue;

            let status = 'ok';
            if (use >= DISK_CRITICAL) {
                status = 'critical';
                result.status = 'critical';
            } else if (use >= DISK_WARNING && result.status !== 'critical') {
                status = 'warning';
                if (result.status === 'ok') result.status = 'warning';
            }

            if (mount === '/' || mount.startsWith('/home') || use >= DISK_WARNING) {
                result.items.push({ name: mount, status, use: `${use}%`, avail });
            }
        }
    }
    return result;
}

// Check memory
function checkMemory() {
    const output = exec('free -m');
    if (!output) return { status: 'error', total: '?', used: '?', percent: '?' };

    const lines = output.split('\n');
    const memLine = lines.find(l => l.startsWith('Mem:'));
    if (!memLine) return { status: 'error', total: '?', used: '?', percent: '?' };

    const parts = memLine.split(/\s+/);
    const total = parseInt(parts[1]);
    const used = parseInt(parts[2]);
    const percent = Math.round((used / total) * 100);

    return {
        status: percent >= MEMORY_WARNING ? 'warning' : 'ok',
        total: `${Math.round(total / 1024)}GB`,
        used: `${Math.round(used / 1024)}GB`,
        percent: `${percent}%`
    };
}

// Check PM2 services
function checkPM2() {
    const result = { status: 'ok', services: [] };
    const output = exec('pm2 jlist');
    if (!output) return { status: 'error', services: [{ name: 'pm2', status: 'error' }] };

    try {
        const list = JSON.parse(output);
        const targets = ['erxia-bot', 'xiaoxu-bot'];

        for (const name of targets) {
            const svc = list.find(s => s.name === name);
            if (!svc) {
                result.services.push({ name, status: 'missing' });
                result.status = 'critical';
            } else if (svc.pm2_env?.status !== 'online') {
                result.services.push({ name, status: svc.pm2_env?.status || 'unknown' });
                result.status = 'critical';
            } else {
                const uptime = Math.round((Date.now() - svc.pm2_env.pm_uptime) / 60000);
                result.services.push({ name, status: 'online', uptime: `${uptime}m` });
            }
        }
    } catch (e) {
        return { status: 'error', services: [{ name: 'pm2', status: 'parse error' }] };
    }
    return result;
}

// Check Memory DB
function checkMemoryDB() {
    if (!fs.existsSync(MEMORY_DB)) {
        return { status: 'warning', size: '0', facts: 0, msg: 'DB not found' };
    }

    const stats = fs.statSync(MEMORY_DB);
    const sizeMB = (stats.size / 1024 / 1024).toFixed(2);

    // Get fact count using better-sqlite3
    let facts = 0;
    try {
        const dbPath = path.join(process.env.HOME, '.openclaw/workspace/skills/memory-consolidation/src/node_modules/better-sqlite3');
        const Database = require(dbPath);
        const db = new Database(MEMORY_DB, { readonly: true });
        const row = db.prepare('SELECT COUNT(*) as count FROM memories WHERE end_time IS NULL').get();
        facts = row?.count || 0;
        db.close();
    } catch (e) {
        // Fallback: just report size
    }

    return { status: 'ok', size: `${sizeMB}MB`, facts };
}

// Check cron jobs
function checkCronJobs() {
    const jobs = [
        { name: 'gemini-sync', log: '~/.openclaw/workspace/skills/memory-consolidation/pipeline_gemini_cron.log' },
        { name: 'daily-digest', log: '~/.openclaw/workspace/logs/daily-digest.log' }
    ];

    const result = { status: 'ok', jobs: [] };
    const now = Date.now();
    const staleHours = 24;

    for (const job of jobs) {
        const logPath = job.log.replace('~', process.env.HOME);
        if (!fs.existsSync(logPath)) {
            result.jobs.push({ name: job.name, status: 'no log', lastRun: 'never' });
            continue;
        }

        const stats = fs.statSync(logPath);
        const ageHours = (now - stats.mtimeMs) / 3600000;
        const lastRun = new Date(stats.mtimeMs).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });

        if (ageHours > staleHours) {
            result.jobs.push({ name: job.name, status: 'stale', lastRun });
            if (result.status === 'ok') result.status = 'warning';
        } else {
            result.jobs.push({ name: job.name, status: 'ok', lastRun });
        }
    }
    return result;
}

// Generate markdown report
function generateReport(checks) {
    const date = getDate();
    const timestamp = getTimestamp();
    const overall = ['critical', 'error', 'warning'].find(s =>
        Object.values(checks).some(c => c.status === s)
    ) || 'ok';

    const statusEmoji = { ok: '✅', warning: '⚠️', critical: '🔴', error: '❌' };

    let md = `# System Health Report

**Date**: ${date}
**Time**: ${timestamp}
**Status**: ${statusEmoji[overall]} ${overall.toUpperCase()}

---

## Disk Space ${statusEmoji[checks.disk.status]}

| Mount | Usage | Available | Status |
|-------|-------|-----------|--------|
`;
    for (const item of checks.disk.items) {
        md += `| ${item.name} | ${item.use} | ${item.avail} | ${statusEmoji[item.status]} |\n`;
    }

    md += `
## Memory ${statusEmoji[checks.memory.status]}

- **Total**: ${checks.memory.total}
- **Used**: ${checks.memory.used} (${checks.memory.percent})

## PM2 Services ${statusEmoji[checks.pm2.status]}

| Service | Status | Uptime |
|---------|--------|--------|
`;
    for (const svc of checks.pm2.services) {
        md += `| ${svc.name} | ${statusEmoji[svc.status === 'online' ? 'ok' : 'critical']} ${svc.status} | ${svc.uptime || '-'} |\n`;
    }

    md += `
## Memory DB ${statusEmoji[checks.memoryDB.status]}

- **Size**: ${checks.memoryDB.size}
- **Active Facts**: ${checks.memoryDB.facts}

## Cron Jobs ${statusEmoji[checks.cron.status]}

| Job | Status | Last Run |
|-----|--------|----------|
`;
    for (const job of checks.cron.jobs) {
        md += `| ${job.name} | ${statusEmoji[job.status === 'ok' ? 'ok' : 'warning']} | ${job.lastRun} |\n`;
    }

    md += `
---
#openclaw #system-health #${date} #monitoring
`;

    return { md, overall, date };
}

// Send TG notification
function sendTG(message) {
    const token = exec('gcloud secrets versions access latest --secret=TELEGRAM_TOKEN_MAIN 2>/dev/null');
    if (!token) {
        console.error('[TG] No token available');
        return false;
    }

    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const payload = JSON.stringify({
        chat_id: TG_GROUP,
        text: message,
        parse_mode: 'Markdown'
    });

    const result = spawnSync('curl', ['-s', '-X', 'POST', url, '-H', 'Content-Type: application/json', '-d', payload]);
    return result.status === 0;
}

// Upload to Google Drive
function uploadGDrive(filePath, fileName) {
    try {
        const password = exec('gcloud secrets versions access latest --secret=GOG_KEYRING_PASSWORD');
        if (!password) return false;

        const result = execSync(
            `GOG_KEYRING_PASSWORD="${password}" gog drive upload "${filePath}" --parent "${GDRIVE_FOLDER}" --account "${GOG_ACCOUNT}" --name "${fileName}"`,
            { encoding: 'utf8', timeout: 60000 }
        );
        return true;
    } catch (e) {
        console.error('[system-health] GDrive upload error:', e.message);
        return false;
    }
}

// Main
async function main() {
    console.log(`[system-health] Starting check at ${getTimestamp()}`);

    // Run all checks
    const checks = {
        disk: checkDisk(),
        memory: checkMemory(),
        pm2: checkPM2(),
        memoryDB: checkMemoryDB(),
        cron: checkCronJobs()
    };

    // Generate report
    const { md, overall, date } = generateReport(checks);

    // Save locally
    if (!fs.existsSync(REPORT_DIR)) {
        fs.mkdirSync(REPORT_DIR, { recursive: true });
    }
    const localPath = path.join(REPORT_DIR, `${date}.md`);
    fs.writeFileSync(localPath, md);
    console.log(`[system-health] Report saved: ${localPath}`);

    // Upload to Google Drive
    const uploaded = uploadGDrive(localPath, `system-health-${date}.md`);
    console.log(`[system-health] Google Drive upload: ${uploaded ? 'success' : 'failed'}`);

    // Send TG notification if issues or --notify-always
    const hasIssues = overall !== 'ok';
    if (hasIssues || NOTIFY_ALWAYS) {
        const emoji = { ok: '✅', warning: '⚠️', critical: '🔴', error: '❌' };
        let msg = `${emoji[overall]} *System Health Report*\n`;
        msg += `📅 ${date}\n\n`;

        if (checks.disk.status !== 'ok') {
            msg += `💾 Disk: ${checks.disk.items.filter(i => i.status !== 'ok').map(i => `${i.name} ${i.use}`).join(', ')}\n`;
        }
        if (checks.pm2.status !== 'ok') {
            msg += `🤖 PM2: ${checks.pm2.services.filter(s => s.status !== 'online').map(s => s.name).join(', ')} down\n`;
        }
        if (checks.cron.status !== 'ok') {
            msg += `⏰ Cron: ${checks.cron.jobs.filter(j => j.status !== 'ok').map(j => j.name).join(', ')} stale\n`;
        }
        if (overall === 'ok') {
            msg += `All systems operational.`;
        }

        const sent = sendTG(msg);
        console.log(`[system-health] TG notification: ${sent ? 'sent' : 'failed'}`);
    }

    console.log(`[system-health] Done. Overall: ${overall}`);
    process.exit(overall === 'ok' ? 0 : 1);
}

main().catch(e => {
    console.error('[system-health] Fatal error:', e);
    process.exit(1);
});
