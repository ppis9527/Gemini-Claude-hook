#!/usr/bin/env node
/**
 * Token Monitor Worker — Background extraction process
 *
 * Forked by token-monitor.js (detached). Runs the full extraction pipeline
 * on a session snapshot, then writes a summary to GEMINI.md ## Session Context.
 *
 * Usage: node token-monitor-worker.js <snapshot-path>
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const MEMORY_ROOT = path.join(os.homedir(), '.openclaw/workspace/skills/memory-consolidation');
const SRC_DIR = path.join(MEMORY_ROOT, 'src');
const FACTS_FILE = path.join(MEMORY_ROOT, 'facts.jsonl');
const LOCK_FILE = '/tmp/gemini-extract.lock';
const GEMINI_MD = path.join(os.homedir(), '.gemini', 'GEMINI.md');
const TIMEOUT = 120_000; // 2 min per step (background, no rush)
const MIN_FREE_MB = 500; // Don't extract if less than 500MB free RAM

const snapshotPath = process.argv[2];

if (!snapshotPath || !fs.existsSync(snapshotPath)) {
    cleanup();
    process.exit(1);
}

// Memory safety check — abort if not enough RAM
const freeMem = os.freemem() / (1024 * 1024);
if (freeMem < MIN_FREE_MB) {
    log(`Aborting: only ${freeMem.toFixed(0)}MB free (need ${MIN_FREE_MB}MB)`);
    cleanup();
    process.exit(0);
}

main();

function main() {
    try {
        log('Starting extraction from snapshot');

        // Step 1: Convert session JSON to JSONL
        const jsonlContent = convertToJsonl(snapshotPath);
        if (!jsonlContent) {
            log('No messages to extract');
            cleanup();
            return;
        }

        const tempJsonl = path.join(os.tmpdir(), `token-monitor-${Date.now()}.jsonl`);
        fs.writeFileSync(tempJsonl, jsonlContent);

        try {
            // Memory check before heavy operations
            const preExtractFreeMB = os.freemem() / (1024 * 1024);
            log(`Free RAM before extraction: ${preExtractFreeMB.toFixed(0)}MB`);
            if (preExtractFreeMB < MIN_FREE_MB) {
                log(`Aborting: insufficient RAM (${preExtractFreeMB.toFixed(0)}MB < ${MIN_FREE_MB}MB)`);
                cleanup();
                return;
            }

            // Record facts.jsonl size before extraction so we can read new facts
            const factsFileSizeBefore = fs.existsSync(FACTS_FILE) ? fs.statSync(FACTS_FILE).size : 0;

            // Step 2: Extract facts (writes to FACTS_FILE via appendFileSync)
            log('Extracting facts...');
            const extractResult = spawnSync('node', [
                path.join(SRC_DIR, '1-extract-facts.js'),
                tempJsonl,
            ], {
                encoding: 'utf8',
                timeout: TIMEOUT,
                stdio: ['pipe', 'pipe', 'pipe'],
                env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=200' },
            });

            if (extractResult.status !== 0) {
                log(`Extract failed: ${extractResult.stderr?.slice(0, 200)}`);
                cleanup();
                return;
            }

            // Read newly appended facts from facts.jsonl
            let extractedFacts = [];
            const factsFileSizeAfter = fs.existsSync(FACTS_FILE) ? fs.statSync(FACTS_FILE).size : 0;
            if (factsFileSizeAfter > factsFileSizeBefore) {
                try {
                    const fd = fs.openSync(FACTS_FILE, 'r');
                    const newBytes = Buffer.alloc(factsFileSizeAfter - factsFileSizeBefore);
                    fs.readSync(fd, newBytes, 0, newBytes.length, factsFileSizeBefore);
                    fs.closeSync(fd);
                    extractedFacts = newBytes.toString('utf8')
                        .trim().split('\n')
                        .filter(Boolean)
                        .map(line => { try { return JSON.parse(line); } catch { return null; } })
                        .filter(Boolean);
                    log(`Read ${extractedFacts.length} new facts from facts.jsonl`);
                } catch (err) {
                    log(`Failed to read new facts: ${err.message}`);
                }
            }

            // Step 3: Align and commit to DB (use the new facts)
            if (extractedFacts.length > 0) {
                log('Aligning and committing...');
                const tempFactsFile = path.join(os.tmpdir(), `token-monitor-facts-${Date.now()}.jsonl`);
                fs.writeFileSync(tempFactsFile, extractedFacts.map(f => JSON.stringify(f)).join('\n') + '\n');

                const alignResult = spawnSync('node', [
                    path.join(SRC_DIR, '2-align-temporally.js'),
                    tempFactsFile,
                ], {
                    encoding: 'utf8',
                    timeout: TIMEOUT,
                    stdio: ['pipe', 'pipe', 'pipe'],
                });

                const alignedFile = path.join(os.tmpdir(), `token-monitor-aligned-${Date.now()}.jsonl`);
                if (alignResult.stdout) {
                    fs.writeFileSync(alignedFile, alignResult.stdout);
                }

                const commitResult = spawnSync('node', [
                    path.join(SRC_DIR, '3-commit-to-db.js'),
                    alignedFile,
                ], {
                    encoding: 'utf8',
                    timeout: TIMEOUT,
                    stdio: ['pipe', 'pipe', 'pipe'],
                });

                if (commitResult.status === 0) {
                    log('Facts committed to DB');
                }

                try { fs.unlinkSync(alignedFile); } catch {}
                try { fs.unlinkSync(tempFactsFile); } catch {}
            }

            // Step 4: Extract agent learnings
            log('Extracting agent learnings...');
            spawnSync('node', [
                path.join(SRC_DIR, 'extract-agent-learnings.js'),
                tempJsonl,
                '--store',
            ], {
                encoding: 'utf8',
                timeout: TIMEOUT,
                stdio: ['pipe', 'pipe', 'pipe'],
            });

            // Step 5: Write summary to GEMINI.md
            writeSummaryToGeminiMd(extractedFacts);

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

/**
 * Convert Gemini session JSON to JSONL format
 * (Same logic as gemini-session-extract.js)
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
 * Write/update the ## Session Context section in GEMINI.md
 */
function writeSummaryToGeminiMd(facts) {
    if (!facts || facts.length === 0) return;

    // Build summary lines from extracted facts
    const summaryLines = [];
    for (const fact of facts.slice(0, 15)) { // Limit to 15 most relevant
        const key = fact.key || '';
        const value = fact.value || '';
        if (!value) continue;

        if (key.startsWith('task.') || key.startsWith('session.')) {
            summaryLines.push(`- 進行中：${value}`);
        } else if (key.startsWith('decision.') || key.startsWith('event.')) {
            summaryLines.push(`- 決定了：${value}`);
        } else if (key.startsWith('error.') || key.startsWith('correction.')) {
            summaryLines.push(`- 注意：${value}`);
        } else if (key.startsWith('project.') || key.startsWith('config.')) {
            summaryLines.push(`- 環境：${value}`);
        } else {
            summaryLines.push(`- ${value}`);
        }
    }

    if (summaryLines.length === 0) return;

    const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
    const sessionBlock = [
        '## Session Context',
        '<!-- Auto-generated by token-monitor extraction. DO NOT edit manually. -->',
        ...summaryLines,
        `<!-- Updated: ${timestamp} -->`,
    ].join('\n');

    try {
        let content = '';
        if (fs.existsSync(GEMINI_MD)) {
            content = fs.readFileSync(GEMINI_MD, 'utf8');
        }

        // Replace existing Session Context block, or append
        const sectionRegex = /## Session Context\n<!-- Auto-generated by token-monitor extraction\..*?-->\n[\s\S]*?<!-- Updated:.*?-->/;
        if (sectionRegex.test(content)) {
            content = content.replace(sectionRegex, sessionBlock);
        } else {
            // Append after the last line
            content = content.trimEnd() + '\n\n' + sessionBlock + '\n';
        }

        fs.writeFileSync(GEMINI_MD, content);
        log(`Updated GEMINI.md Session Context (${summaryLines.length} items)`);
    } catch (err) {
        log(`Failed to update GEMINI.md: ${err.message}`);
    }
}

function cleanup() {
    try { fs.unlinkSync(LOCK_FILE); } catch {}
}

function log(msg) {
    const ts = new Date().toISOString().slice(11, 19);
    try {
        fs.appendFileSync('/tmp/token-monitor-worker.log', `[${ts}] ${msg}\n`);
    } catch {}
}
