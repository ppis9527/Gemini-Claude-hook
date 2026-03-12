#!/usr/bin/env node
/**
 * Extract structured context checkpoint from a session transcript.
 *
 * Inspired by ReMe's context compaction format.
 * Uses Gemini flash-lite to produce a structured checkpoint that preserves
 * task progress, decisions, and critical context across compaction.
 *
 * Usage:
 *   node extract-checkpoint.js <session.jsonl>
 *   node extract-checkpoint.js <session.jsonl> --agent claude|gemini
 *
 * Output: writes checkpoint to ~/.openclaw/workspace/data/checkpoints/<session-id>.md
 *         also writes latest.md symlink for quick access
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const CHECKPOINT_DIR = path.join(os.homedir(), '.openclaw/workspace/data/checkpoints');
const MAX_TRANSCRIPT_CHARS = 25000;

// Headless HOME for gemini -p
const HEADLESS_HOME = '/tmp/gemini-headless';
const HEADLESS_GEMINI = path.join(HEADLESS_HOME, '.gemini');
const REAL_GEMINI = path.join(os.homedir(), '.gemini');

function ensureHeadless() {
    if (!fs.existsSync(HEADLESS_GEMINI)) {
        fs.mkdirSync(HEADLESS_GEMINI, { recursive: true });
    }
    fs.writeFileSync(path.join(HEADLESS_GEMINI, 'settings.json'),
        '{"security":{"auth":{"selectedType":"oauth-personal"}},"hooks":{},"mcpServers":{}}');
    for (const f of ['google_accounts.json', 'oauth_creds.json']) {
        const src = path.join(REAL_GEMINI, f);
        const dst = path.join(HEADLESS_GEMINI, f);
        if (fs.existsSync(src)) {
            try { fs.copyFileSync(src, dst); } catch {}
        }
    }
}

function extractMessages(jsonlPath) {
    const content = fs.readFileSync(jsonlPath, 'utf8');
    const lines = content.trim().split('\n');
    const messages = [];

    for (const line of lines) {
        try {
            const entry = JSON.parse(line);
            // Claude Code format
            if (entry.type === 'human' || entry.type === 'assistant') {
                const role = entry.type === 'human' ? 'User' : 'Assistant';
                let text = '';
                if (typeof entry.message === 'string') {
                    text = entry.message;
                } else if (entry.message?.content) {
                    if (typeof entry.message.content === 'string') {
                        text = entry.message.content;
                    } else if (Array.isArray(entry.message.content)) {
                        text = entry.message.content
                            .filter(b => b.type === 'text')
                            .map(b => b.text)
                            .join('\n');
                    }
                }
                if (text.trim()) {
                    messages.push(`${role}: ${text.slice(0, 3000)}`);
                }
            }
            // Gemini format
            if (entry.role === 'user' || entry.role === 'model') {
                const role = entry.role === 'user' ? 'User' : 'Assistant';
                const text = entry.parts?.map(p => p.text || '').join('\n') || '';
                if (text.trim()) {
                    messages.push(`${role}: ${text.slice(0, 3000)}`);
                }
            }
        } catch {}
    }

    // Take the most recent messages that fit within char limit
    let total = 0;
    const recent = [];
    for (let i = messages.length - 1; i >= 0; i--) {
        if (total + messages[i].length > MAX_TRANSCRIPT_CHARS) break;
        recent.unshift(messages[i]);
        total += messages[i].length;
    }

    return recent.join('\n---\n');
}

function callGemini(prompt) {
    ensureHeadless();

    const result = spawnSync('gemini', [
        '-m', 'gemini-2.5-flash-lite',
        '-p', prompt
    ], {
        encoding: 'utf8',
        timeout: 60000,
        env: { ...process.env, HOME: HEADLESS_HOME },
        stdio: ['pipe', 'pipe', 'pipe']
    });

    if (result.status !== 0) {
        throw new Error(`Gemini failed: ${result.stderr?.slice(0, 200)}`);
    }

    return (result.stdout || '').trim();
}

function main() {
    const args = process.argv.slice(2);
    const jsonlPath = args.find(a => !a.startsWith('--'));
    const agentArg = args.indexOf('--agent');
    const agent = agentArg >= 0 ? args[agentArg + 1] : 'claude';

    if (!jsonlPath || !fs.existsSync(jsonlPath)) {
        console.error('Usage: node extract-checkpoint.js <session.jsonl> [--agent claude|gemini]');
        process.exit(1);
    }

    const sessionId = path.basename(jsonlPath, '.jsonl').slice(0, 8);
    const transcript = extractMessages(jsonlPath);

    if (transcript.length < 200) {
        console.error(`[Checkpoint] Session ${sessionId} too short (${transcript.length} chars), skipping`);
        process.exit(0);
    }

    const prompt = `You are a session checkpoint extractor. Analyze the following conversation transcript and produce a structured checkpoint in Markdown.

Output EXACTLY this format (keep section headers, fill in content):

## Goal
- [What the user is trying to accomplish — can be multiple goals]

## Constraints
- [Any preferences, limitations, or rules mentioned]

## Progress
- [done] Completed tasks
- [wip] Tasks in progress
- [blocked] Blocked tasks with reason

## Key Decisions
- [Decision made] — reason

## Next Steps
1. [Most immediate next action]
2. [Following actions]

## Critical Context
- [File paths, function names, error messages, config values that must not be lost]

Rules:
- Be concise — each bullet should be 1 line
- Use the user's language for descriptions (Traditional Chinese if the conversation is in Chinese)
- Only include sections that have content
- Do not add any text outside the sections

Transcript:
${transcript}`;

    console.error(`[Checkpoint] Extracting from session ${sessionId} (${transcript.length} chars, agent: ${agent})...`);
    const checkpoint = callGemini(prompt);

    if (!checkpoint || checkpoint.length < 50) {
        console.error('[Checkpoint] Empty or too short result, skipping');
        process.exit(0);
    }

    // Add metadata header
    const now = new Date().toISOString();
    const fullCheckpoint = `<!-- session: ${sessionId} | agent: ${agent} | created: ${now} -->
${checkpoint}
`;

    // Save checkpoint
    fs.mkdirSync(CHECKPOINT_DIR, { recursive: true });
    const checkpointFile = path.join(CHECKPOINT_DIR, `${sessionId}.md`);
    fs.writeFileSync(checkpointFile, fullCheckpoint);

    // Update latest symlink
    const latestLink = path.join(CHECKPOINT_DIR, 'latest.md');
    try { fs.unlinkSync(latestLink); } catch {}
    try { fs.symlinkSync(checkpointFile, latestLink); } catch {}

    console.error(`[Checkpoint] Saved: ${checkpointFile} (${checkpoint.length} chars)`);

    // Output the checkpoint to stdout for piping
    process.stdout.write(fullCheckpoint);
}

main();
