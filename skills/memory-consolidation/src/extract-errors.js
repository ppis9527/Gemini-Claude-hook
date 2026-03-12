#!/usr/bin/env node
// Extract error patterns from Claude Code session JSONL files
// Stores error.* facts in memory.db for future prevention

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const Database = require('better-sqlite3');

const dbPath = process.env.MEMORY_DB_PATH || path.join(__dirname, '..', 'memory.db');

function openDb() {
    return new Database(dbPath);
}

function normalizeCommand(cmd) {
    // Extract the base command pattern (remove specific paths/args)
    if (!cmd) return null;

    // Remove specific file paths, keep command structure
    const parts = cmd.split(/\s+/);
    const baseCmd = parts[0];

    // Categorize by command type
    if (['rm', 'rmdir', 'mv', 'cp'].includes(baseCmd)) return `filesystem.${baseCmd}`;
    if (['git'].includes(baseCmd)) return `git.${parts[1] || 'unknown'}`;
    if (['npm', 'yarn', 'pnpm', 'bun'].includes(baseCmd)) return `package.${baseCmd}`;
    if (['python', 'node', 'bash', 'sh'].includes(baseCmd)) return `script.${baseCmd}`;
    if (['sudo'].includes(baseCmd)) return `sudo.${parts[1] || 'unknown'}`;
    if (['docker', 'kubectl'].includes(baseCmd)) return `container.${baseCmd}`;

    return `bash.${baseCmd}`;
}

function extractErrorPattern(errorText) {
    if (!errorText) return 'unknown';

    const text = errorText.toLowerCase();

    if (text.includes('permission denied')) return 'permission_denied';
    if (text.includes('not found') || text.includes('no such file')) return 'not_found';
    if (text.includes('already exists')) return 'already_exists';
    if (text.includes('syntax error')) return 'syntax_error';
    if (text.includes('connection refused') || text.includes('econnrefused')) return 'connection_refused';
    if (text.includes('timeout')) return 'timeout';
    if (text.includes('out of memory') || text.includes('oom')) return 'out_of_memory';
    if (text.includes('disk full') || text.includes('no space')) return 'disk_full';
    if (text.includes('conflict')) return 'conflict';

    return 'generic';
}

async function extractErrorsFromSession(sessionPath) {
    if (!fs.existsSync(sessionPath)) {
        console.error(`Session file not found: ${sessionPath}`);
        return [];
    }

    const errors = [];
    const rl = readline.createInterface({
        input: fs.createReadStream(sessionPath),
        crlfDelay: Infinity
    });

    let lastCommand = null;
    let pendingError = null;

    for await (const line of rl) {
        if (!line.trim()) continue;

        try {
            const entry = JSON.parse(line);

            // Track tool calls (especially Bash)
            if (entry.type === 'tool_use' && entry.name === 'Bash') {
                lastCommand = entry.input?.command;
            }

            // Detect errors in tool results
            if (entry.type === 'tool_result' && entry.is_error) {
                if (lastCommand) {
                    const cmdCategory = normalizeCommand(lastCommand);
                    const errorType = extractErrorPattern(entry.content);

                    pendingError = {
                        key: `error.${cmdCategory}.${errorType}`,
                        command: lastCommand,
                        error: (entry.content || '').slice(0, 500), // Truncate long errors
                        timestamp: new Date().toISOString()
                    };
                }
            }

            // If we have a pending error and next command succeeds, record solution
            if (pendingError && entry.type === 'tool_result' && !entry.is_error && lastCommand) {
                pendingError.solution = lastCommand.slice(0, 500);
                errors.push(pendingError);
                pendingError = null;
            }

        } catch (e) {
            // Skip invalid JSON lines
        }
    }

    // Push any remaining error without solution
    if (pendingError) {
        errors.push(pendingError);
    }

    return errors;
}

function storeErrors(errors) {
    if (errors.length === 0) {
        console.log('No errors to store.');
        return;
    }

    const db = openDb();
    const now = new Date().toISOString();

    const selectStmt = db.prepare(
        'SELECT rowid, value FROM memories WHERE key = ? AND end_time IS NULL'
    );
    const updateEndStmt = db.prepare(
        'UPDATE memories SET end_time = ? WHERE key = ? AND end_time IS NULL'
    );
    const insertStmt = db.prepare(
        'INSERT INTO memories (key, value, source, start_time) VALUES (?, ?, ?, ?)'
    );

    for (const err of errors) {
        // Check if this error pattern exists
        const existing = selectStmt.get(err.key);

        let newValue;
        if (existing) {
            // Merge with existing: increment count
            try {
                const oldVal = JSON.parse(existing.value);
                oldVal.count = (oldVal.count || 1) + 1;
                oldVal.last_seen = err.timestamp;
                if (err.solution && !oldVal.solution) {
                    oldVal.solution = err.solution;
                }
                newValue = JSON.stringify(oldVal);
            } catch {
                newValue = JSON.stringify({
                    pattern: err.command,
                    error: err.error,
                    solution: err.solution || null,
                    count: 2,
                    last_seen: err.timestamp
                });
            }

            // Close old record
            updateEndStmt.run(now, err.key);
        } else {
            newValue = JSON.stringify({
                pattern: err.command,
                error: err.error,
                solution: err.solution || null,
                count: 1,
                last_seen: err.timestamp
            });
        }

        // Insert new record
        insertStmt.run(err.key, newValue, 'auto:extract-errors', now);
        console.log(`Stored: ${err.key}`);
    }

    db.close();
    console.log(`Processed ${errors.length} error(s).`);
}

async function main() {
    const sessionPath = process.argv[2];

    if (!sessionPath) {
        console.error('Usage: node extract-errors.js <session.jsonl>');
        process.exit(1);
    }

    const errors = await extractErrorsFromSession(sessionPath);
    storeErrors(errors);
}

main().catch(err => {
    console.error(err.message);
    process.exit(1);
});
