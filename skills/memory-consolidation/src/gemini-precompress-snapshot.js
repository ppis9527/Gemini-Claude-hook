#!/usr/bin/env node
/**
 * PreCompress Hook — Snapshot only, NO background extraction
 *
 * Just copy the session JSON to staging/. That's it.
 * Fact extraction is handled by cron (daily-gemini-sync.sh).
 *
 * Previous version forked background gemini -p processes which:
 * - Each consumed ~200MB RAM
 * - Raced on the same staging files (ENOENT errors)
 * - Caused OOM on 3.8GB VM
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const GEMINI_BASE = path.join(os.homedir(), '.gemini', 'tmp');
const STAGING_DIR = path.join(os.homedir(), '.openclaw/workspace/skills/memory-consolidation/staging');

if (!fs.existsSync(STAGING_DIR)) {
    fs.mkdirSync(STAGING_DIR, { recursive: true });
}

let stdinData = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { stdinData += chunk; });
process.stdin.on('end', () => {
    try {
        main();
    } catch (err) {
        console.error('[PreCompress] Error:', err.message);
    }
    process.exit(0);
});

function findLatestSession() {
    if (!fs.existsSync(GEMINI_BASE)) return null;
    let latestFile = null;
    let latestMtime = 0;

    for (const entry of fs.readdirSync(GEMINI_BASE)) {
        const chatsDir = path.join(GEMINI_BASE, entry, 'chats');
        if (!fs.existsSync(chatsDir) || !fs.statSync(chatsDir).isDirectory()) continue;

        for (const file of fs.readdirSync(chatsDir)) {
            if (file.startsWith('session-') && file.endsWith('.json')) {
                const filePath = path.join(chatsDir, file);
                const stats = fs.statSync(filePath);
                if (stats.mtimeMs > latestMtime) {
                    latestMtime = stats.mtimeMs;
                    latestFile = filePath;
                }
            }
        }
    }
    return latestFile;
}

function main() {
    const sessionPath = findLatestSession();
    if (!sessionPath) {
        console.error('[PreCompress] No session found');
        return;
    }

    const stats = fs.statSync(sessionPath);
    if (stats.size < 100) {
        console.error('[PreCompress] Session too small, skipping');
        return;
    }

    const basename = path.basename(sessionPath);
    const dest = path.join(STAGING_DIR, `precompress-${Date.now()}-${basename}`);
    fs.copyFileSync(sessionPath, dest);
    console.error(`[PreCompress] Snapshot saved (${(stats.size / 1024).toFixed(0)}KB)`);
}
