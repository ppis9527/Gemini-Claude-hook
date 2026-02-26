#!/usr/bin/env node
/**
 * AfterModel Hook — Token Usage Monitor
 *
 * Monitors promptTokenCount from LLM responses. When usage exceeds 65%
 * of the worst-case context window (128K), forks a background extraction
 * process to save session facts to memory.db and write a summary to GEMINI.md.
 *
 * Anti-OOM design:
 * - Lock file ensures only 1 extraction process at a time
 * - Background process is detached + unref'd (won't block hook)
 * - Stale lock detection (>10 min)
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { fork } = require('child_process');

const WORST_CASE_WINDOW = 128_000;
const THRESHOLD = 0.65;
const TOKEN_THRESHOLD = Math.floor(WORST_CASE_WINDOW * THRESHOLD); // 83,200
const LOCK_FILE = '/tmp/gemini-extract.lock';
const STALE_LOCK_MS = 10 * 60 * 1000; // 10 minutes
const MIN_FREE_MB = 500; // Don't fork if less than 500MB free RAM

const MEMORY_ROOT = path.join(os.homedir(), '.openclaw/workspace/skills/memory-consolidation');
const STAGING_DIR = path.join(MEMORY_ROOT, 'staging');
const GEMINI_BASE = path.join(os.homedir(), '.gemini', 'tmp');
const GEMINI_MD = path.join(os.homedir(), '.gemini', 'GEMINI.md');
const EXTRACT_WORKER = path.join(os.homedir(), '.gemini', 'hooks', 'token-monitor-worker.js');

let stdinData = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { stdinData += chunk; });
process.stdin.on('end', () => {
    try {
        main();
    } catch (err) {
        console.error('[TokenMonitor] Error:', err.message);
    }
    process.exit(0);
});

// Safety timeout — never block the hook for more than 2.5s
setTimeout(() => process.exit(0), 2500);

function main() {
    // Parse stdin to get token usage
    let input;
    try {
        input = JSON.parse(stdinData);
    } catch {
        return; // Not valid JSON, skip silently
    }

    const promptTokens = input?.llm_response?.usageMetadata?.promptTokenCount;
    if (!promptTokens || typeof promptTokens !== 'number') {
        return; // No token info available
    }

    // Check threshold
    if (promptTokens < TOKEN_THRESHOLD) {
        return; // Below threshold, nothing to do
    }

    console.error(`[TokenMonitor] Token usage ${promptTokens}/${WORST_CASE_WINDOW} (${(promptTokens / WORST_CASE_WINDOW * 100).toFixed(1)}%) — triggering extraction`);

    // Check available memory before forking
    const freeMB = os.freemem() / (1024 * 1024);
    if (freeMB < MIN_FREE_MB) {
        console.error(`[TokenMonitor] Low RAM (${freeMB.toFixed(0)}MB free), skipping extraction`);
        return;
    }

    // Check lock file
    if (isLocked()) {
        console.error('[TokenMonitor] Extraction already in progress, skipping');
        return;
    }

    // Find latest session to extract
    const sessionPath = findLatestSession();
    if (!sessionPath) {
        console.error('[TokenMonitor] No session file found');
        return;
    }

    // Snapshot session to staging
    const snapshotPath = snapshotSession(sessionPath);
    if (!snapshotPath) {
        console.error('[TokenMonitor] Failed to snapshot session');
        return;
    }

    // Fork background worker (detached, won't block hook)
    try {
        const child = fork(EXTRACT_WORKER, [snapshotPath], {
            detached: true,
            stdio: 'ignore',
        });

        // Write lock file with child PID
        fs.writeFileSync(LOCK_FILE, JSON.stringify({
            pid: child.pid,
            timestamp: Date.now(),
            session: path.basename(sessionPath),
        }));

        child.unref();
        console.error(`[TokenMonitor] Background extraction started (PID: ${child.pid})`);
    } catch (err) {
        console.error(`[TokenMonitor] Failed to fork worker: ${err.message}`);
    }
}

function isLocked() {
    if (!fs.existsSync(LOCK_FILE)) return false;

    try {
        const lock = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8'));

        // Check if lock is stale (> 10 minutes)
        if (Date.now() - lock.timestamp > STALE_LOCK_MS) {
            console.error(`[TokenMonitor] Stale lock detected (${((Date.now() - lock.timestamp) / 60000).toFixed(1)} min old), removing`);
            fs.unlinkSync(LOCK_FILE);
            return false;
        }

        // Check if PID is still alive
        try {
            process.kill(lock.pid, 0); // Signal 0 = check if process exists
            return true; // Process is alive, lock is valid
        } catch {
            // Process is dead, lock is stale
            console.error(`[TokenMonitor] Lock PID ${lock.pid} is dead, removing stale lock`);
            fs.unlinkSync(LOCK_FILE);
            return false;
        }
    } catch {
        // Corrupt lock file, remove it
        try { fs.unlinkSync(LOCK_FILE); } catch {}
        return false;
    }
}

function findLatestSession() {
    if (!fs.existsSync(GEMINI_BASE)) return null;

    let latestFile = null;
    let latestMtime = 0;

    for (const entry of fs.readdirSync(GEMINI_BASE)) {
        const chatsDir = path.join(GEMINI_BASE, entry, 'chats');
        if (!fs.existsSync(chatsDir)) continue;
        try { if (!fs.statSync(chatsDir).isDirectory()) continue; } catch { continue; }

        for (const file of fs.readdirSync(chatsDir)) {
            if (file.startsWith('session-') && file.endsWith('.json')) {
                const filePath = path.join(chatsDir, file);
                try {
                    const stats = fs.statSync(filePath);
                    if (stats.mtimeMs > latestMtime) {
                        latestMtime = stats.mtimeMs;
                        latestFile = filePath;
                    }
                } catch { continue; }
            }
        }
    }

    return latestFile;
}

function snapshotSession(sessionPath) {
    try {
        if (!fs.existsSync(STAGING_DIR)) {
            fs.mkdirSync(STAGING_DIR, { recursive: true });
        }

        const stats = fs.statSync(sessionPath);
        if (stats.size < 100) return null;

        const basename = path.basename(sessionPath);
        const dest = path.join(STAGING_DIR, `token-monitor-${Date.now()}-${basename}`);
        fs.copyFileSync(sessionPath, dest);
        return dest;
    } catch (err) {
        console.error(`[TokenMonitor] Snapshot error: ${err.message}`);
        return null;
    }
}
