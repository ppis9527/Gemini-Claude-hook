#!/usr/bin/env node
/**
 * Gemini CLI Session Extract Hook (SessionEnd / PreCompress)
 *
 * Design: fork a detached background worker and exit immediately.
 * This prevents hook timeout (60s) from creating zombie processes.
 * The worker handles the full pipeline independently.
 *
 * Usage (in ~/.gemini/settings.json):
 *   "SessionEnd": [{ "hooks": [{ "type": "command", "command": "node /path/to/gemini-session-extract.js" }] }]
 */

const { fork } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const LOCK_FILE = '/tmp/gemini-session-extract.lock';
const STALE_LOCK_MS = 10 * 60 * 1000; // 10 minutes
const MIN_FREE_MB = 500;
const MEMORY_ROOT = path.join(os.homedir(), '.openclaw/workspace/skills/memory-consolidation');
const WORKER = path.join(MEMORY_ROOT, 'src', 'gemini-session-extract-worker.js');
const GEMINI_BASE = path.join(os.homedir(), '.gemini', 'tmp');

// Read stdin then decide
let stdinData = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { stdinData += chunk.slice(0, 4096); });
process.stdin.on('end', () => {
    try {
        run();
    } catch (err) {
        console.error('[GeminiExtract] Error:', err.message);
    }
    process.exit(0);
});

// Safety timeout — never block the hook
setTimeout(() => process.exit(0), 5000);

function run() {
    // RAM check
    const freeMB = os.freemem() / (1024 * 1024);
    if (freeMB < MIN_FREE_MB) {
        console.error(`[GeminiExtract] Low RAM (${freeMB.toFixed(0)}MB), skipping`);
        return;
    }

    // Lock check
    if (isLocked()) {
        console.error('[GeminiExtract] Extraction already in progress, skipping');
        return;
    }

    // Find session to extract
    let sessionPath = null;
    try {
        if (stdinData.trim()) {
            const input = JSON.parse(stdinData);
            sessionPath = input.session_path || input.sessionPath || input.path;
        }
    } catch {}

    if (!sessionPath || !fs.existsSync(sessionPath)) {
        sessionPath = findLatestSession();
    }

    if (!sessionPath) {
        console.error('[GeminiExtract] No session found');
        return;
    }

    const stats = fs.statSync(sessionPath);
    if (stats.size < 100) {
        console.error('[GeminiExtract] Session too small, skipping');
        return;
    }

    // Snapshot session to tmp (session file may change/vanish after SessionEnd)
    const snapshotPath = path.join(os.tmpdir(), `gemini-extract-snapshot-${Date.now()}.json`);
    fs.copyFileSync(sessionPath, snapshotPath);

    // Fork detached worker — won't block hook, won't become zombie
    try {
        const child = fork(WORKER, [snapshotPath], {
            detached: true,
            stdio: 'ignore',
        });

        // Write lock with child PID
        fs.writeFileSync(LOCK_FILE, JSON.stringify({
            pid: child.pid,
            timestamp: Date.now(),
            session: path.basename(sessionPath),
        }));

        child.unref();
        console.error(`[GeminiExtract] Background worker started (PID: ${child.pid})`);
    } catch (err) {
        console.error(`[GeminiExtract] Failed to fork worker: ${err.message}`);
        try { fs.unlinkSync(snapshotPath); } catch {}
    }
}

function isLocked() {
    if (!fs.existsSync(LOCK_FILE)) return false;
    try {
        const lock = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8'));
        if (Date.now() - lock.timestamp > STALE_LOCK_MS) {
            console.error(`[GeminiExtract] Stale lock (${((Date.now() - lock.timestamp) / 60000).toFixed(1)} min), removing`);
            fs.unlinkSync(LOCK_FILE);
            return false;
        }
        try { process.kill(lock.pid, 0); return true; } catch {
            console.error(`[GeminiExtract] Lock PID ${lock.pid} dead, removing`);
            fs.unlinkSync(LOCK_FILE);
            return false;
        }
    } catch {
        try { fs.unlinkSync(LOCK_FILE); } catch {}
        return false;
    }
}

function findLatestSession() {
    if (!fs.existsSync(GEMINI_BASE)) return null;
    let latestFile = null, latestMtime = 0;

    for (const entry of fs.readdirSync(GEMINI_BASE)) {
        const chatsDir = path.join(GEMINI_BASE, entry, 'chats');
        try { if (!fs.statSync(chatsDir).isDirectory()) continue; } catch { continue; }

        for (const file of fs.readdirSync(chatsDir)) {
            if (file.startsWith('session-') && file.endsWith('.json')) {
                const filePath = path.join(chatsDir, file);
                try {
                    const s = fs.statSync(filePath);
                    if (s.mtimeMs > latestMtime) { latestMtime = s.mtimeMs; latestFile = filePath; }
                } catch { continue; }
            }
        }
    }
    return latestFile;
}
