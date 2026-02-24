#!/usr/bin/env node
/**
 * Extract agent learnings (cases & patterns) from session JSONL.
 * Identifies error→success patterns and frequently used tool sequences.
 *
 * Usage: node extract-agent-learnings.js <session.jsonl>
 *
 * Output: JSON array of {key, value, source} objects for memory storage.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');

function generateId() {
    return crypto.randomBytes(4).toString('hex');
}

/**
 * Read session JSONL and extract structured messages with tool usage info.
 * Handles both regular messages (type: "user"/"assistant") and progress messages.
 */
async function readSessionMessages(filePath) {
    const rl = readline.createInterface({
        input: fs.createReadStream(filePath),
        crlfDelay: Infinity
    });

    const messages = [];

    for await (const line of rl) {
        if (!line.trim()) continue;

        let record;
        try {
            record = JSON.parse(line);
        } catch {
            continue;
        }

        // Try to extract message from different record structures
        let message = null;
        let timestamp = record.timestamp;

        if (record.type === 'user' || record.type === 'assistant') {
            // Standard message format
            message = record.message;
        } else if (record.type === 'progress' && record.data?.message?.message) {
            // Progress message format (nested)
            message = record.data.message.message;
            timestamp = record.data.message.timestamp || timestamp;
        }

        if (!message || !message.role) continue;

        const role = message.role;
        const content = message.content;
        if (!content) continue;

        const toolUses = [];
        const texts = [];

        if (Array.isArray(content)) {
            for (const block of content) {
                if (block.type === 'tool_use') {
                    toolUses.push({
                        type: 'call',
                        name: block.name,
                        input: block.input,
                        id: block.id
                    });
                }
                if (block.type === 'tool_result') {
                    const contentStr = typeof block.content === 'string' ? block.content : '';
                    // Mark as error if is_error flag is true, or Exit code is non-zero
                    const hasError = block.is_error === true ||
                        /Exit code [1-9]/.test(contentStr);
                    toolUses.push({
                        type: 'result',
                        id: block.tool_use_id,
                        error: hasError,
                        content: contentStr.slice(0, 500)
                    });
                }
                if (block.type === 'text') {
                    texts.push(block.text);
                }
            }
        } else if (typeof content === 'string') {
            texts.push(content);
        }

        messages.push({
            role,
            texts,
            toolUses,
            timestamp,
            uuid: record.uuid
        });
    }

    return messages;
}

/**
 * Check if a message contains an error tool result.
 */
function hasErrorResult(msg) {
    if (!msg || !msg.toolUses) return false;
    return msg.toolUses.some(t => t.type === 'result' && t.error);
}

/**
 * Check if a message contains a successful tool result.
 */
function hasSuccessResult(msg) {
    if (!msg || !msg.toolUses) return false;
    return msg.toolUses.some(t => t.type === 'result' && !t.error);
}

/**
 * Extract the error description from a message.
 */
function extractProblem(msg) {
    const errorResult = msg.toolUses?.find(t => t.type === 'result' && t.error);
    if (!errorResult) return 'Unknown error';

    const content = errorResult.content || '';
    // Extract first meaningful error line
    const lines = content.split('\n').filter(l => l.trim() && l.trim().length > 5);
    const errorLine = lines.find(l =>
        l.toLowerCase().includes('error') ||
        l.toLowerCase().includes('fail') ||
        l.includes('Exit code') ||
        l.includes('ENOENT') ||
        l.includes('AssertionError')
    ) || lines[0] || 'Unknown error';

    // Clean up the error line - remove line number prefixes like "    1→"
    const cleanedLine = errorLine.replace(/^\s*\d+→\s*/, '').trim();
    return cleanedLine.slice(0, 200);
}

/**
 * Categorize the error type.
 */
function categorizeError(errorText) {
    const text = (errorText || '').toLowerCase();

    if (text.includes('permission denied')) return 'permission';
    if (text.includes('not found') || text.includes('enoent')) return 'not_found';
    if (text.includes('syntax error')) return 'syntax';
    if (text.includes('exit code 1') || text.includes('test fail')) return 'test_failure';
    if (text.includes('connection') || text.includes('timeout')) return 'network';
    if (text.includes('already exists')) return 'conflict';
    if (text.includes('import') || text.includes('module')) return 'import';

    return 'generic';
}

/**
 * Find error→success patterns (cases) in the session.
 */
function findErrorRecoveryCases(messages, sessionId) {
    const cases = [];

    for (let i = 0; i < messages.length - 1; i++) {
        const errorMsg = messages[i];

        // Look for messages with error results
        if (!hasErrorResult(errorMsg)) continue;

        // Look for success in next few messages
        for (let j = i + 1; j < Math.min(i + 5, messages.length); j++) {
            const successMsg = messages[j];

            if (hasSuccessResult(successMsg)) {
                const problem = extractProblem(errorMsg);
                const errorType = categorizeError(problem);

                // Get recovery info from messages between error and success
                const recoveryMsgs = messages.slice(i + 1, j + 1);
                const solution = extractSolutionFromRecovery(recoveryMsgs);

                cases.push({
                    key: `agent.case.${errorType}.${generateId()}`,
                    value: JSON.stringify({
                        problem,
                        solution,
                        outcome: 'success',
                        session: sessionId,
                        timestamp: errorMsg.timestamp
                    }),
                    source: `auto:session:${sessionId}`
                });
                break;
            }
        }
    }

    return cases;
}

/**
 * Extract solution info from recovery messages.
 */
function extractSolutionFromRecovery(msgs) {
    const tools = [];
    const actions = [];
    let description = '';

    for (const msg of msgs) {
        // Collect tool calls
        for (const t of (msg.toolUses || [])) {
            if (t.type === 'call' && t.name) {
                tools.push(t.name);
                if (t.name === 'Bash' && t.input?.command) {
                    actions.push(`Bash: ${t.input.command.slice(0, 100)}`);
                } else if (t.name === 'Edit' && t.input?.file_path) {
                    actions.push(`Edit: ${path.basename(t.input.file_path)}`);
                } else if (t.name === 'Write' && t.input?.file_path) {
                    actions.push(`Write: ${path.basename(t.input.file_path)}`);
                }
            }
        }

        // Collect text explanations from assistant messages
        if (msg.role === 'assistant' && msg.texts?.length > 0) {
            description = msg.texts.join(' ').slice(0, 200);
        }
    }

    return {
        tools: [...new Set(tools)],
        actions: actions.slice(0, 3),
        description
    };
}

/**
 * Find repeated tool patterns in the session.
 */
function findToolPatterns(messages, sessionId) {
    const patterns = [];
    const toolCounts = {};
    const toolSequences = [];

    // Count individual tool usage
    for (const msg of messages) {
        if (!msg.toolUses) continue;

        const msgTools = [];
        for (const t of msg.toolUses) {
            if (t.type === 'call' && t.name) {
                toolCounts[t.name] = (toolCounts[t.name] || 0) + 1;
                msgTools.push(t.name);
            }
        }

        if (msgTools.length > 1) {
            toolSequences.push(msgTools.join('→'));
        }
    }

    // Pattern: Frequently used tools
    for (const [tool, count] of Object.entries(toolCounts)) {
        if (count >= 5) {
            patterns.push({
                key: `agent.pattern.frequent_${tool.toLowerCase()}`,
                value: `Tool ${tool} used ${count} times - indicates primary workflow`,
                source: `auto:session:${sessionId}`
            });
        }
    }

    // Pattern: Common tool sequences
    const seqCounts = {};
    for (const seq of toolSequences) {
        seqCounts[seq] = (seqCounts[seq] || 0) + 1;
    }

    for (const [seq, count] of Object.entries(seqCounts)) {
        if (count >= 3) {
            patterns.push({
                key: `agent.pattern.sequence_${generateId()}`,
                value: `Common sequence: ${seq} (${count}x)`,
                source: `auto:session:${sessionId}`
            });
        }
    }

    return patterns;
}

/**
 * Find successful multi-step workflows.
 */
function findSuccessfulWorkflows(messages, sessionId) {
    const workflows = [];

    // Find consecutive successful tool uses (workflow completion)
    let successStreak = [];

    for (const msg of messages) {
        if (hasSuccessResult(msg)) {
            const tools = msg.toolUses
                .filter(t => t.type === 'call')
                .map(t => t.name);
            successStreak.push(...tools);
        } else if (hasErrorResult(msg)) {
            // End of successful streak
            if (successStreak.length >= 5) {
                workflows.push({
                    key: `agent.pattern.workflow_${generateId()}`,
                    value: `Successful workflow: ${[...new Set(successStreak)].join(' → ')} (${successStreak.length} steps)`,
                    source: `auto:session:${sessionId}`
                });
            }
            successStreak = [];
        }
    }

    // Check final streak
    if (successStreak.length >= 5) {
        workflows.push({
            key: `agent.pattern.workflow_${generateId()}`,
            value: `Successful workflow: ${[...new Set(successStreak)].join(' → ')} (${successStreak.length} steps)`,
            source: `auto:session:${sessionId}`
        });
    }

    return workflows;
}

/**
 * Main extraction function.
 */
async function extractAgentLearnings(sessionPath) {
    const messages = await readSessionMessages(sessionPath);

    if (messages.length === 0) {
        return [];
    }

    const sessionId = path.basename(sessionPath, '.jsonl').split('-')[0];
    const learnings = [];

    // 1. Find error→success patterns (cases)
    const cases = findErrorRecoveryCases(messages, sessionId);
    learnings.push(...cases);

    // 2. Find repeated tool patterns
    const patterns = findToolPatterns(messages, sessionId);
    learnings.push(...patterns);

    // 3. Find successful workflows
    const workflows = findSuccessfulWorkflows(messages, sessionId);
    learnings.push(...workflows);

    return learnings;
}

// CLI entry point
if (require.main === module) {
    const args = process.argv.slice(2);
    const storeIdx = args.indexOf('--store');
    const storeMode = storeIdx !== -1;

    // Remove --store from args
    if (storeMode) args.splice(storeIdx, 1);

    const inputFile = args[0];
    const dbPath = process.env.MEMORY_DB_PATH || path.join(__dirname, '..', 'memory.db');

    if (!inputFile) {
        console.error('Usage: node extract-agent-learnings.js <session.jsonl> [--store]');
        console.error('  --store: Store learnings to memory.db');
        process.exit(1);
    }

    if (!fs.existsSync(inputFile)) {
        console.error(`File not found: ${inputFile}`);
        process.exit(1);
    }

    extractAgentLearnings(inputFile)
        .then(learnings => {
            console.log(JSON.stringify(learnings, null, 2));

            if (storeMode && learnings.length > 0) {
                storeLearnings(learnings, dbPath);
            }
        })
        .catch(err => {
            console.error(`Error: ${err.message}`);
            process.exit(1);
        });
}

/**
 * Store learnings to memory database.
 */
function storeLearnings(learnings, dbPath) {
    if (learnings.length === 0) return;

    const Database = require('better-sqlite3');
    const db = new Database(dbPath);

    // Ensure table exists
    db.exec(`
        CREATE TABLE IF NOT EXISTS memories (
            key TEXT NOT NULL,
            value TEXT,
            source TEXT,
            start_time TEXT NOT NULL,
            end_time TEXT,
            PRIMARY KEY (key, start_time)
        )
    `);

    const now = new Date().toISOString();
    const insert = db.prepare(
        'INSERT OR REPLACE INTO memories (key, value, source, start_time, end_time) VALUES (?, ?, ?, ?, ?)'
    );

    for (const learning of learnings) {
        insert.run(learning.key, learning.value, learning.source, now, null);
    }

    db.close();
    console.error(`Stored ${learnings.length} learning(s) to database.`);
}

module.exports = { extractAgentLearnings, readSessionMessages, storeLearnings };
