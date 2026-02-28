#!/usr/bin/env node
/**
 * PreCompress Hook — Throttled snapshot, NO background extraction
 *
 * Copies the active session JSON to staging/ for later fact extraction.
 * Throttle: skips if same session was snapshotted within THROTTLE_MS.
 * Cleanup: removes older snapshots of the same session (keep only latest).
 *
 * Fact extraction is handled by cron (daily-gemini-sync.sh).
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const GEMINI_BASE = path.join(os.homedir(), '.gemini', 'tmp');
const STAGING_DIR = path.join(os.homedir(), '.openclaw/workspace/skills/memory-consolidation/staging');
const THROTTLE_MS = 5 * 60 * 1000; // 5 minutes between snapshots of same session
const MAX_SNAPSHOTS_PER_SESSION = 3; // Keep only the latest N per session

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
            if ((file.startsWith('session-') || file.startsWith('tgbot-')) && file.endsWith('.json')) {
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

/**
 * Extract session ID from filename (e.g., "session-2026-02-24T04-27-661d4fa6.json" → "661d4fa6")
 */
function getSessionId(filename) {
    const base = path.basename(filename, '.json');
    const parts = base.split('-');
    return parts[parts.length - 1]; // Last segment is the UUID prefix
}

/**
 * Find existing snapshots for a session, sorted by mtime (oldest first)
 */
function findExistingSnapshots(sessionId) {
    const files = fs.readdirSync(STAGING_DIR)
        .filter(f => f.startsWith('precompress-') && f.includes(sessionId))
        .map(f => ({
            name: f,
            path: path.join(STAGING_DIR, f),
            mtime: fs.statSync(path.join(STAGING_DIR, f)).mtimeMs,
        }))
        .sort((a, b) => a.mtime - b.mtime);
    return files;
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

    const sessionId = getSessionId(sessionPath);
    const existing = findExistingSnapshots(sessionId);

    // Throttle: skip if latest snapshot is recent
    if (existing.length > 0) {
        const latestSnapshot = existing[existing.length - 1];
        const elapsed = Date.now() - latestSnapshot.mtime;
        if (elapsed < THROTTLE_MS) {
            console.error(`[PreCompress] Throttled (${Math.round(elapsed / 1000)}s since last, need ${THROTTLE_MS / 1000}s)`);
            return;
        }
    }

    // Save new snapshot
    const basename = path.basename(sessionPath);
    const dest = path.join(STAGING_DIR, `precompress-${Date.now()}-${basename}`);
    fs.copyFileSync(sessionPath, dest);
    console.error(`[PreCompress] Snapshot saved (${(stats.size / 1024).toFixed(0)}KB, session: ${sessionId})`);

    // Cleanup: remove older snapshots beyond MAX_SNAPSHOTS_PER_SESSION
    const allSnapshots = findExistingSnapshots(sessionId); // Re-read including the new one
    if (allSnapshots.length > MAX_SNAPSHOTS_PER_SESSION) {
        const toRemove = allSnapshots.slice(0, allSnapshots.length - MAX_SNAPSHOTS_PER_SESSION);
        for (const snap of toRemove) {
            try {
                fs.unlinkSync(snap.path);
            } catch {}
        }
        console.error(`[PreCompress] Cleaned ${toRemove.length} old snapshot(s)`);
    }
}
