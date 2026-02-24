/**
 * Step 1: Extract facts from a session JSONL file using Gemini CLI (flash-lite).
 *
 * Usage: node 1-extract-facts.js <session.jsonl>
 * Output: appends to facts.jsonl (path via FACTS_FILE env or default)
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const FACTS_FILE = process.env.FACTS_FILE || path.join(__dirname, 'facts.jsonl');
const PROCESSED_FILE = path.join(__dirname, '..', '.processed_sessions');
const CHUNK_LIMIT = 30_000; // chars

function getSessionId(filePath) {
    return path.basename(filePath, '.jsonl');
}

function isProcessed(sessionId, mtime) {
    if (!fs.existsSync(PROCESSED_FILE)) return false;
    const processed = fs.readFileSync(PROCESSED_FILE, 'utf8').split('\n');
    return processed.includes(`${sessionId}|${mtime}`);
}

function markProcessed(sessionId, mtime) {
    fs.appendFileSync(PROCESSED_FILE, `${sessionId}|${mtime}\n`);
}

const PROMPT = `Extract persistent factual information from this conversation as a JSON array.
Each fact must be an object with "key" (string, dot-notation category.field) and "value" (string).
Categories (use ONLY these exact singular forms): user, project, task, system, config, preference, location, tool, agent, workflow, team, environment, model, auth, channel, gateway, plugin, binding, command, meta
NEVER use plural forms (e.g. use "agent" not "agents", "model" not "models", "channel" not "channels").
Only persistent facts. NOT transient conversation or file contents.
Output ONLY a raw JSON array. NO markdown fences, NO preamble, NO explanations, NO footer.
If no facts: []`;

function readSessionMessages(filePath) {
    const lines = fs.readFileSync(filePath, 'utf8').split('\n').filter(Boolean);
    const textParts = [];

    for (const line of lines) {
        let record;
        try { record = JSON.parse(line); } catch { continue; }
        if (record.type !== 'message') continue;

        const role = record.message?.role;
        if (!role) continue;

        const content = record.message?.content;
        if (!content) continue;

        const texts = [];
        if (typeof content === 'string') {
            texts.push(content);
        } else if (Array.isArray(content)) {
            for (const block of content) {
                if (block.type === 'text' && block.text) {
                    texts.push(block.text);
                }
            }
        }

        if (texts.length > 0) {
            const label = role === 'user' ? '[user]' : '[assistant]';
            textParts.push(`${label} ${texts.join('\n')}`);
        }
    }

    return textParts.join('\n\n');
}

function chunkText(text) {
    if (text.length <= CHUNK_LIMIT) return [text];

    const chunks = [];
    let remaining = text;
    while (remaining.length > CHUNK_LIMIT) {
        let cutAt = remaining.lastIndexOf('\n\n', CHUNK_LIMIT);
        if (cutAt <= 0) cutAt = CHUNK_LIMIT;
        chunks.push(remaining.slice(0, cutAt));
        remaining = remaining.slice(cutAt).trimStart();
    }
    if (remaining.length > 0) chunks.push(remaining);
    return chunks;
}

function callGemini(text) {
    const result = spawnSync('gemini', ['-p', PROMPT, '-m', 'gemini-2.5-flash-lite'], {
        input: text,
        encoding: 'utf8',
        env: { 
            ...process.env, 
            GEMINI_SKIP_HOOKS: '1',
            GEMINI_CONFIG_DIR: '/tmp/gemini-null-' + Date.now()
        },
        timeout: 300_000,
        maxBuffer: 10 * 1024 * 1024,
    });

    if (result.status !== 0) {
        console.error('Gemini call failed (status ' + result.status + '):', result.stderr?.slice(0, 500));
        console.log('STDOUT was:', result.stdout?.slice(0, 500));
        return [];
    }

    let output = (result.stdout || '').trim();
    // Debug output:
    // console.log('DEBUG RAW OUTPUT:', output.slice(0, 100));
    
    // Improved JSON Extraction: Find the first '[' and last ']' to ignore preamble/footer
    const firstBracket = output.indexOf('[');
    const lastBracket = output.lastIndexOf(']');
    
    if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) {
        output = output.slice(firstBracket, lastBracket + 1);
    }

    try {
        const parsed = JSON.parse(output);
        if (!Array.isArray(parsed)) return [];
        // Basic schema validation
        return parsed.filter(f => f && typeof f.key === 'string' && f.value !== undefined);
    } catch (e) {
        console.error('Failed to parse Gemini output:', e.message, 'Raw (truncated):', output.slice(0, 300));
        return [];
    }
}

function extractSource(filePath) {
    const basename = path.basename(filePath, '.jsonl');
    // Use first segment of UUID-style filenames
    const firstSeg = basename.split('-')[0];
    return `session:${firstSeg}`;
}

function extractTimestamp(filePath) {
    const lines = fs.readFileSync(filePath, 'utf8').split('\n').filter(Boolean);
    for (const line of lines) {
        try {
            const record = JSON.parse(line);
            if (record.timestamp) return record.timestamp;
        } catch { /* skip */ }
    }
    return new Date().toISOString();
}

function main() {
    const inputFile = process.argv[2];
    if (!inputFile) {
        console.error('Usage: node 1-extract-facts.js <session.jsonl>');
        process.exit(1);
    }

    if (!fs.existsSync(inputFile)) {
        console.error(`File not found: ${inputFile}`);
        process.exit(1);
    }

    const sessionId = getSessionId(inputFile);
    const stats = fs.statSync(inputFile);
    const mtime = stats.mtimeMs.toString();

    if (isProcessed(sessionId, mtime)) {
        console.log(`Already processed: ${sessionId} (mtime match), skipping.`);
        return;
    }

    const conversationText = readSessionMessages(inputFile);
    if (conversationText.trim().length === 0) {
        console.log('Empty session, skipping.');
        markProcessed(sessionId, mtime);
        return;
    }

    const source = extractSource(inputFile);
    const timestamp = extractTimestamp(inputFile);
    const chunks = chunkText(conversationText);

    let allFacts = [];
    for (let i = 0; i < chunks.length; i++) {
        console.log(`  Chunk ${i + 1}/${chunks.length} (${chunks[i].length} chars)...`);
        const facts = callGemini(chunks[i]);
        allFacts = allFacts.concat(facts);
    }

    if (allFacts.length === 0) {
        console.log('No facts extracted.');
        markProcessed(sessionId, mtime);
        return;
    }

    // Append to facts.jsonl
    const lines = allFacts.map(f => JSON.stringify({
        key: f.key,
        value: f.value,
        source,
        message_timestamp: timestamp,
    }));

    fs.appendFileSync(FACTS_FILE, lines.join('\n') + '\n');
    markProcessed(sessionId, mtime);
    console.log(`Extracted ${allFacts.length} facts → ${FACTS_FILE}`);
}

main();
