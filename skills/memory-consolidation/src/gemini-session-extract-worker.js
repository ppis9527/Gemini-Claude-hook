#!/usr/bin/env node
/**
 * Gemini Session Extract Worker — Background process
 *
 * Forked (detached) by gemini-session-extract.js.
 * Runs the full extraction pipeline on a session snapshot.
 *
 * Usage: node gemini-session-extract-worker.js <snapshot-path>
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const MEMORY_ROOT = path.join(os.homedir(), '.openclaw/workspace/skills/memory-consolidation');
const SRC_DIR = path.join(MEMORY_ROOT, 'src');
const LOCK_FILE = '/tmp/gemini-session-extract.lock';
const LOG_FILE = '/tmp/gemini-session-extract-worker.log';
const STEP_TIMEOUT = 90_000; // 90s per step (background, generous)
const MIN_FREE_MB = 300;

const snapshotPath = process.argv[2];

if (!snapshotPath || !fs.existsSync(snapshotPath)) {
    log('No snapshot file, exiting');
    cleanup();
    process.exit(1);
}

main();

function main() {
    try {
        const freeMB = os.freemem() / (1024 * 1024);
        if (freeMB < MIN_FREE_MB) {
            log(`Aborting: ${freeMB.toFixed(0)}MB free < ${MIN_FREE_MB}MB`);
            cleanup();
            return;
        }

        log(`Processing: ${path.basename(snapshotPath)}`);

        // Convert session JSON to JSONL
        const jsonlContent = convertToJsonl(snapshotPath);
        if (!jsonlContent) {
            log('No messages to extract');
            cleanup();
            return;
        }

        const tempJsonl = path.join(os.tmpdir(), `gemini-extract-${Date.now()}.jsonl`);
        fs.writeFileSync(tempJsonl, jsonlContent);

        try {
            // Step 1: Extract facts
            log('Step 1: Extracting facts...');
            const extractResult = spawnSync('node', [
                path.join(SRC_DIR, '1-extract-facts.js'),
                tempJsonl,
            ], {
                encoding: 'utf8',
                timeout: STEP_TIMEOUT,
                killSignal: 'SIGKILL',
                stdio: ['pipe', 'pipe', 'pipe'],
                env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=200' },
            });

            if (extractResult.status !== 0) {
                log(`Extract failed: ${(extractResult.stderr || '').slice(0, 200)}`);
                cleanup();
                return;
            }

            log(`Extract stdout: ${(extractResult.stdout || '').length} bytes`);

            // Step 2: Align temporally
            const tempFactsFile = path.join(os.tmpdir(), `gemini-facts-${Date.now()}.jsonl`);
            if (extractResult.stdout) {
                fs.writeFileSync(tempFactsFile, extractResult.stdout);
            }

            if (fs.existsSync(tempFactsFile) && fs.statSync(tempFactsFile).size > 0) {
                log('Step 2: Aligning and committing...');

                const alignResult = spawnSync('node', [
                    path.join(SRC_DIR, '2-align-temporally.js'),
                    tempFactsFile,
                ], {
                    encoding: 'utf8',
                    timeout: STEP_TIMEOUT,
                    killSignal: 'SIGKILL',
                    stdio: ['pipe', 'pipe', 'pipe'],
                });

                const alignedFile = path.join(os.tmpdir(), `gemini-aligned-${Date.now()}.jsonl`);
                if (alignResult.stdout) {
                    fs.writeFileSync(alignedFile, alignResult.stdout);
                }

                // Step 3: Commit to DB
                spawnSync('node', [
                    path.join(SRC_DIR, '3-commit-to-db.js'),
                    alignedFile,
                ], {
                    encoding: 'utf8',
                    timeout: STEP_TIMEOUT,
                    killSignal: 'SIGKILL',
                    stdio: ['pipe', 'pipe', 'pipe'],
                });

                log('Facts committed to DB');
                try { fs.unlinkSync(alignedFile); } catch {}
                try { fs.unlinkSync(tempFactsFile); } catch {}
            }

            // Step 4: Extract agent learnings
            log('Step 4: Agent learnings...');
            spawnSync('node', [
                path.join(SRC_DIR, 'extract-agent-learnings.js'),
                tempJsonl,
                '--store',
            ], {
                encoding: 'utf8',
                timeout: STEP_TIMEOUT,
                killSignal: 'SIGKILL',
                stdio: ['pipe', 'pipe', 'pipe'],
            });

            log('Extraction complete');

        } finally {
            try { fs.unlinkSync(tempJsonl); } catch {}
        }

        // Clean up snapshot
        try { fs.unlinkSync(snapshotPath); } catch {}

    } catch (err) {
        log(`Error: ${err.message}`);
    } finally {
        cleanup();
    }
}

function convertToJsonl(sessionPath) {
    const raw = fs.readFileSync(sessionPath, 'utf8');
    let session;
    try { session = JSON.parse(raw); } catch { return null; }

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

function cleanup() {
    try { fs.unlinkSync(LOCK_FILE); } catch {}
}

function log(msg) {
    const ts = new Date().toISOString().slice(0, 19);
    try { fs.appendFileSync(LOG_FILE, `[${ts}] ${msg}\n`); } catch {}
}
