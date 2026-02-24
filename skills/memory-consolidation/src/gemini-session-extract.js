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
    main().catch(err => {
        console.error('[GeminiExtract] Error:', err.message);
        process.exit(0); // Don't block on error
    });
});

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

async function main() {
    // Try to get session path from stdin
    let sessionPath = null;

    try {
        if (stdinData.trim()) {
            const input = JSON.parse(stdinData);
            // Gemini CLI might pass session_path or similar
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

    const sessionId = path.basename(sessionPath, '.json').slice(0, 20);
    console.error(`[GeminiExtract] Processing session: ${sessionId}`);

    // Convert to JSONL
    const jsonlContent = convertToJsonl(sessionPath);
    if (!jsonlContent) {
        console.error('[GeminiExtract] No messages to extract');
        process.exit(0);
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
            process.exit(0);
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

    process.exit(0);
}
