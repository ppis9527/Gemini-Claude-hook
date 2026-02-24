// Convert Gemini CLI sessions to JSONL format for the memory pipeline.
// Scans ~/.gemini/tmp/{hash}/chats/session-{id}.json and converts each
// to a pipeline-compatible JSONL file.
//
// Usage: node convert-gemini-sessions.js --output-dir <dir>
//
// Idempotency: uses .processed_sessions with "gemini:" prefix to skip
// already-converted sessions.

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const os = require('os');

const PROCESSED_FILE = path.join(__dirname, '..', '.processed_sessions');
const GEMINI_BASE = path.join(os.homedir(), '.gemini', 'tmp');

function parseArgs() {
    const args = process.argv.slice(2);
    let outputDir = null;
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--output-dir' && args[i + 1]) {
            outputDir = args[i + 1];
            i++;
        }
    }
    if (!outputDir) {
        console.error('Usage: node convert-gemini-sessions.js --output-dir <dir>');
        process.exit(1);
    }
    return { outputDir };
}

function getProcessedMap() {
    if (!fs.existsSync(PROCESSED_FILE)) return new Map();
    const map = new Map();
    fs.readFileSync(PROCESSED_FILE, 'utf8').split('\n').filter(Boolean).forEach(line => {
        const [id, mtime] = line.split('|');
        map.set(id, mtime);
    });
    return map;
}

function markProcessed(sessionId, mtime) {
    fs.appendFileSync(PROCESSED_FILE, `${sessionId}|${mtime}\n`);
}

function findGeminiSessions() {
    const sessions = [];
    if (!fs.existsSync(GEMINI_BASE)) return sessions;

    for (const entry of fs.readdirSync(GEMINI_BASE)) {
        const chatsDir = path.join(GEMINI_BASE, entry, 'chats');
        if (!fs.existsSync(chatsDir) || !fs.statSync(chatsDir).isDirectory()) continue;

        for (const file of fs.readdirSync(chatsDir)) {
            if (file.startsWith('session-') && file.endsWith('.json')) {
                sessions.push(path.join(chatsDir, file));
            }
        }
    }

    return sessions.sort();
}

function convertSession(filePath) {
    const raw = fs.readFileSync(filePath, 'utf8');
    let session;
    try {
        session = JSON.parse(raw);
    } catch {
        console.error(`  Skipping (invalid JSON): ${filePath}`);
        return null;
    }

    const messages = session.messages || [];
    const startTime = session.startTime || new Date().toISOString();
    const lines = [];

    for (const msg of messages) {
        if (msg.type !== 'user' && msg.type !== 'gemini') continue;

        let content = msg.content;
        // Normalize content: list of {text} → concatenated string
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

    return lines.length > 0 ? lines : null;
}

function main() {
    const { outputDir } = parseArgs();
    fs.mkdirSync(outputDir, { recursive: true });

    const processedMap = getProcessedMap();
    const sessionFiles = findGeminiSessions();

    console.log(`Found ${sessionFiles.length} Gemini sessions.`);

    let converted = 0;
    let skipped = 0;

    for (const filePath of sessionFiles) {
        const stats = fs.statSync(filePath);
        const currentMtime = stats.mtimeMs.toString();

        // Read sessionId from file content
        let sessionId;
        try {
            const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            sessionId = data.sessionId || path.basename(filePath, '.json');
        } catch {
            sessionId = path.basename(filePath, '.json');
        }

        const trackedId = `gemini:${sessionId}`;

        // Skip only if the session exists and mtime matches
        if (processedMap.has(trackedId) && processedMap.get(trackedId) === currentMtime) {
            skipped++;
            continue;
        }

        const lines = convertSession(filePath);
        if (!lines) {
            markProcessed(trackedId, currentMtime);
            skipped++;
            continue;
        }

        const outFile = path.join(outputDir, `gemini-${sessionId}.jsonl`);
        fs.writeFileSync(outFile, lines.join('\n') + '\n');
        markProcessed(trackedId, currentMtime);
        converted++;
    }

    console.log(`Converted/Updated: ${converted}, Skipped: ${skipped}`);
}

main();
