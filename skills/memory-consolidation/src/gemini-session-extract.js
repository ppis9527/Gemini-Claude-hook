#!/usr/bin/env node
/**
 * Gemini CLI Session Extract Hook
 *
 * Works for both SessionEnd and PreCompress events.
 * Extracts facts from the current Gemini session.
 *
 * Usage (in ~/.gemini/settings.json):
 *   "SessionEnd": [{ "hooks": [{ "type": "command", "command": "node /path/to/gemini-session-extract.js" }] }]
 *   "PreCompress": [{ "hooks": [{ "type": "command", "command": "node /path/to/gemini-session-extract.js" }] }]
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const MEMORY_ROOT = path.join(os.homedir(), '.openclaw/workspace/skills/memory-consolidation');
const SRC_DIR = path.join(MEMORY_ROOT, 'src');
const GEMINI_BASE = path.join(os.homedir(), '.gemini', 'tmp');
const TIMEOUT = 60000;
const LOCK_FILE = '/tmp/gemini-session-extract.lock';
const STALE_LOCK_MS = 5 * 60 * 1000; // 5 minutes
const MIN_FREE_MB = 500;

// Read stdin (Gemini CLI may pass session info)
let stdinData = '';
const MAX_STDIN = 1024 * 1024;

process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
    if (stdinData.length < MAX_STDIN) {
        stdinData += chunk.substring(0, MAX_STDIN - stdinData.length);
    }
});

process.stdin.on('end', () => {
    // Lock check — prevent concurrent extractions (fork storm)
    if (isLocked()) {
        console.error('[GeminiExtract] Another extraction in progress, skipping');
        process.exit(0);
    }

    // RAM check
    const freeMB = os.freemem() / (1024 * 1024);
    if (freeMB < MIN_FREE_MB) {
        console.error(`[GeminiExtract] Low RAM (${freeMB.toFixed(0)}MB free), skipping`);
        process.exit(0);
    }

    // Acquire lock
    try {
        fs.writeFileSync(LOCK_FILE, JSON.stringify({ pid: process.pid, timestamp: Date.now() }));
    } catch {}

    main().catch(err => {
        console.error('[GeminiExtract] Error:', err.message);
    }).finally(() => {
        try { fs.unlinkSync(LOCK_FILE); } catch {}
        process.exit(0);
    });
});

function isLocked() {
    if (!fs.existsSync(LOCK_FILE)) return false;
    try {
        const lock = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8'));
        if (Date.now() - lock.timestamp > STALE_LOCK_MS) {
            fs.unlinkSync(LOCK_FILE);
            return false;
        }
        try { process.kill(lock.pid, 0); return true; } catch { fs.unlinkSync(LOCK_FILE); return false; }
    } catch {
        try { fs.unlinkSync(LOCK_FILE); } catch {}
        return false;
    }
}

/**
 * Find the most recently modified Gemini session file
 */
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

/**
 * Convert Gemini session JSON to JSONL format
 */
function convertToJsonl(sessionPath) {
    const raw = fs.readFileSync(sessionPath, 'utf8');
    let session;
    try {
        session = JSON.parse(raw);
    } catch {
        return null;
    }

    const messages = session.messages || [];
    const startTime = session.startTime || new Date().toISOString();
    const lines = [];

    for (const msg of messages) {
        if (msg.type !== 'user' && msg.type !== 'gemini') continue;

        let content = msg.content;
        if (Array.isArray(content)) {
            content = content
                .filter(p => p && typeof p.text === 'string')
                .map(p => p.text)
                .join('\n');
        }

        if (!content || typeof content !== 'string' || content.trim().length === 0) continue;

        const role = msg.type === 'user' ? 'user' : 'assistant';
        lines.push(JSON.stringify({
            type: 'message',
            message: { role, content },
            timestamp: startTime,
        }));
    }

    return lines.length > 0 ? lines.join('\n') + '\n' : null;
}

/**
 * Process staged snapshots from PreCompress hook.
 * These are copies of session JSONs saved before compression.
 */
async function processStagedSnapshots() {
    const STAGING_DIR = path.join(os.homedir(), '.openclaw/workspace/skills/memory-consolidation/staging');
    if (!fs.existsSync(STAGING_DIR)) return;

    const files = fs.readdirSync(STAGING_DIR).filter(f => f.startsWith('precompress-') && f.endsWith('.json'));
    if (files.length === 0) return;

    console.error(`[GeminiExtract] Found ${files.length} staged snapshot(s)`);
    for (const file of files) {
        const filePath = path.join(STAGING_DIR, file);
        try {
            await processSessionFile(filePath);
            fs.unlinkSync(filePath); // Clean up after processing
            console.error(`[GeminiExtract] Processed staged: ${file}`);
        } catch (err) {
            console.error(`[GeminiExtract] Failed staged ${file}: ${err.message}`);
        }
    }
}

async function main() {
    // First, process any staged snapshots from PreCompress
    await processStagedSnapshots();

    // Then process the current session
    let sessionPath = null;

    try {
        if (stdinData.trim()) {
            const input = JSON.parse(stdinData);
            sessionPath = input.session_path || input.sessionPath || input.path;
        }
    } catch {
        // stdin not valid JSON, ignore
    }

    // Fallback: find latest session
    if (!sessionPath || !fs.existsSync(sessionPath)) {
        sessionPath = findLatestSession();
    }

    if (!sessionPath) {
        console.error('[GeminiExtract] No session found');
        process.exit(0);
    }

    // Check if session has content
    const stats = fs.statSync(sessionPath);
    if (stats.size < 100) {
        console.error('[GeminiExtract] Session too small, skipping');
        process.exit(0);
    }

    await processSessionFile(sessionPath);
    process.exit(0);
}

/**
 * Process a single session file: extract facts, align, commit, learn.
 */
async function processSessionFile(sessionPath) {
    const sessionId = path.basename(sessionPath, '.json').slice(0, 20);
    console.error(`[GeminiExtract] Processing session: ${sessionId}`);

    // Convert to JSONL
    const jsonlContent = convertToJsonl(sessionPath);
    if (!jsonlContent) {
        console.error('[GeminiExtract] No messages to extract');
        return;
    }

    // Write temp JSONL file
    const tempJsonl = path.join(os.tmpdir(), `gemini-extract-${Date.now()}.jsonl`);
    fs.writeFileSync(tempJsonl, jsonlContent);

    try {
        // Step 1: Extract facts
        console.error('[GeminiExtract] Step 1: Extracting facts...');
        const extractResult = spawnSync('node', [
            path.join(SRC_DIR, '1-extract-facts.js'),
            tempJsonl
        ], {
            encoding: 'utf8',
            timeout: TIMEOUT,
            stdio: ['pipe', 'pipe', 'pipe']
        });

        if (extractResult.status !== 0) {
            console.error('[GeminiExtract] Extract failed:', extractResult.stderr?.slice(0, 200));
            return;
        }

        // Write facts to temp file
        const tempFactsFile = path.join(os.tmpdir(), `gemini-facts-${Date.now()}.jsonl`);
        if (extractResult.stdout) {
            fs.writeFileSync(tempFactsFile, extractResult.stdout);
        }

        // Step 2: Align and commit
        if (fs.existsSync(tempFactsFile) && fs.statSync(tempFactsFile).size > 0) {
            console.error('[GeminiExtract] Step 2: Aligning and committing...');

            const alignResult = spawnSync('node', [
                path.join(SRC_DIR, '2-align-temporally.js'),
                tempFactsFile
            ], {
                encoding: 'utf8',
                timeout: TIMEOUT,
                stdio: ['pipe', 'pipe', 'pipe']
            });

            const alignedFile = path.join(os.tmpdir(), `gemini-aligned-${Date.now()}.jsonl`);
            if (alignResult.stdout) {
                fs.writeFileSync(alignedFile, alignResult.stdout);
            }

            const commitResult = spawnSync('node', [
                path.join(SRC_DIR, '3-commit-to-db.js'),
                alignedFile
            ], {
                encoding: 'utf8',
                timeout: TIMEOUT,
                stdio: ['pipe', 'pipe', 'pipe']
            });

            if (commitResult.status === 0) {
                console.error('[GeminiExtract] Facts committed to DB');
            }

            try { fs.unlinkSync(alignedFile); } catch {}
            try { fs.unlinkSync(tempFactsFile); } catch {}
        }

        // Step 3: Extract agent learnings
        console.error('[GeminiExtract] Step 3: Extracting agent learnings...');
        spawnSync('node', [
            path.join(SRC_DIR, 'extract-agent-learnings.js'),
            tempJsonl,
            '--store'
        ], {
            encoding: 'utf8',
            timeout: TIMEOUT,
            stdio: ['pipe', 'pipe', 'pipe']
        });

        console.error('[GeminiExtract] Extraction complete');

    } finally {
        try { fs.unlinkSync(tempJsonl); } catch {}
    }
}
