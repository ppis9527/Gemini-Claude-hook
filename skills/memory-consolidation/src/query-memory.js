const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const os = require('os');

const dbPath     = process.env.MEMORY_DB_PATH     || path.join(__dirname, '..', 'memory.db');
const digestPath = process.env.MEMORY_DIGEST_PATH || path.join(__dirname, '..', 'memory_digest.json');
const configPath = process.env.MEMORY_CONFIG_PATH || path.join(__dirname, '..', 'digest-config.json');

function loadConfig() {
    try { return JSON.parse(fs.readFileSync(configPath, 'utf8')); }
    catch { return { min_count_for_l0: 5, max_categories_in_l0: 15 }; }
}

function parseArgs() {
    const args = process.argv.slice(2);
    const opts = { keys: null, prefix: null, query: null, limit: 10, format: 'text' };
    for (let i = 0; i < args.length; i++) {
        if      (args[i] === '--keys'   && args[i + 1]) opts.keys   = args[++i].split(',');
        else if (args[i] === '--prefix' && args[i + 1]) opts.prefix = args[++i];
        else if (args[i] === '--query'  && args[i + 1]) opts.query  = args[++i];
        else if (args[i] === '--limit'  && args[i + 1]) opts.limit  = parseInt(args[++i], 10);
        else if (args[i] === '--format' && args[i + 1]) opts.format = args[++i];
    }
    return opts;
}

function loadDigest() {
    if (!fs.existsSync(digestPath)) return null;
    try { return JSON.parse(fs.readFileSync(digestPath, 'utf8')); }
    catch { return null; }
}

/**
 * Reciprocal Rank Fusion: merge two ranked result lists.
 * @param {Array} vectorResults - results ranked by vector similarity
 * @param {Array} ftsResults - results ranked by FTS5 BM25
 * @param {number} k - RRF constant (default 60)
 * @returns {Array} merged results sorted by RRF score
 */
function mergeWithRRF(vectorResults, ftsResults, k = 60) {
    const scores = new Map();
    vectorResults.forEach((r, i) => {
        scores.set(r.key, (scores.get(r.key) || 0) + 1 / (i + 1 + k));
    });
    ftsResults.forEach((r, i) => {
        scores.set(r.key, (scores.get(r.key) || 0) + 1 / (i + 1 + k));
    });
    // Merge metadata from both result sets
    const allResults = new Map();
    [...vectorResults, ...ftsResults].forEach(r => {
        if (!allResults.has(r.key)) allResults.set(r.key, r);
    });
    return [...scores.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([key, score]) => ({ ...allResults.get(key), rrf_score: score }));
}

/**
 * Hybrid search combining vector similarity and FTS5 with RRF merging.
 * Falls back to single-method results if one method returns empty.
 * @param {string} query - search query text
 * @param {number} limit - max results
 * @returns {Array} merged results
 */
async function hybridQuery(query, limit = 10) {
    if (!fs.existsSync(dbPath) || !query) return [];

    const db = new Database(dbPath, { readonly: true });
    db.pragma('busy_timeout = 5000');

    // FTS search
    let ftsResults = [];
    try {
        const safeQuery = query
            .split(/\s+/)
            .filter(Boolean)
            .map(t => `"${t.replace(/"/g, '""')}"`)
            .join(' ');

        if (safeQuery) {
            ftsResults = db.prepare(`
                SELECT m.key, m.value FROM memories m
                JOIN memories_fts fts ON m.rowid = fts.rowid
                WHERE memories_fts MATCH ? AND m.end_time IS NULL
                ORDER BY bm25(memories_fts)
                LIMIT ?
            `).all(safeQuery, limit * 2).map(r => {
                let value;
                try { value = JSON.parse(r.value); } catch { value = r.value; }
                return { key: r.key, value };
            });
        }
    } catch {
        // FTS query may fail on syntax issues
    }

    // Vector search (only if embeddings exist and embed module is available)
    let vectorResults = [];
    try {
        const { embedTexts } = require('./embed.js');
        const queryEmbeddings = await embedTexts([query]);
        if (queryEmbeddings && queryEmbeddings[0]) {
            const queryVec = queryEmbeddings[0];
            const rows = db.prepare(`
                SELECT key, value, embedding FROM memories
                WHERE embedding IS NOT NULL AND end_time IS NULL
            `).all();

            vectorResults = rows
                .map(row => {
                    const stored = new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.byteLength / 4);
                    let dot = 0, normA = 0, normB = 0;
                    for (let i = 0; i < queryVec.length && i < stored.length; i++) {
                        dot += queryVec[i] * stored[i];
                        normA += queryVec[i] ** 2;
                        normB += stored[i] ** 2;
                    }
                    const similarity = dot / (Math.sqrt(normA) * Math.sqrt(normB) || 1);
                    let value;
                    try { value = JSON.parse(row.value); } catch { value = row.value; }
                    return { key: row.key, value, similarity };
                })
                .sort((a, b) => b.similarity - a.similarity)
                .slice(0, limit);
        }
    } catch {
        // embed.js not available or embedding failed
    }

    db.close();

    // If we have both, merge with RRF; otherwise return whichever is available
    if (vectorResults.length > 0 && ftsResults.length > 0) {
        return mergeWithRRF(vectorResults, ftsResults).slice(0, limit);
    }
    if (ftsResults.length > 0) return ftsResults.slice(0, limit);
    if (vectorResults.length > 0) return vectorResults.slice(0, limit);
    return [];
}

function queryL1(opts) {
    if (!fs.existsSync(dbPath)) return [];
    const db = new Database(dbPath, { readonly: true });
    let rows = [];

    if (opts.keys) {
        const placeholders = opts.keys.map(() => '?').join(',');
        rows = db.prepare(`
            SELECT key, value FROM memories
            WHERE key IN (${placeholders}) AND end_time IS NULL
            LIMIT ?
        `).all(...opts.keys, opts.limit);
    } else if (opts.prefix) {
        rows = db.prepare(`
            SELECT key, value FROM memories
            WHERE key LIKE ? AND end_time IS NULL
            ORDER BY key
            LIMIT ?
        `).all(opts.prefix + '%', opts.limit);
    }

    db.close();
    return rows.map(r => {
        let value;
        try { value = JSON.parse(r.value); } catch { value = r.value; }
        return { key: r.key, value };
    });
}

function getTopErrors(limit = 5) {
    if (!fs.existsSync(dbPath)) return [];
    const db = new Database(dbPath, { readonly: true });

    // Get top errors by count (stored in JSON value)
    // Use CASE to handle both JSON and non-JSON values
    let rows;
    try {
        rows = db.prepare(`
            SELECT key, value FROM memories
            WHERE key LIKE 'error.%' AND end_time IS NULL
            ORDER BY CASE
                WHEN json_valid(value) THEN json_extract(value, '$.count')
                ELSE 0
            END DESC
            LIMIT ?
        `).all(limit);
    } catch {
        // Fallback: get errors without sorting by count
        rows = db.prepare(`
            SELECT key, value FROM memories
            WHERE key LIKE 'error.%' AND end_time IS NULL
            ORDER BY start_time DESC
            LIMIT ?
        `).all(limit);
    }

    db.close();
    return rows.map(r => {
        let value;
        try { value = JSON.parse(r.value); } catch { value = r.value; }
        return { key: r.key, value };
    });
}

/**
 * Get relevant agent memory (cases & patterns) for session injection.
 * @param {number} limit - Maximum number of entries to return
 * @returns {Array} Array of {key, value} objects
 */
function getRelevantAgentMemory(limit = 5) {
    if (!fs.existsSync(dbPath)) return [];
    const db = new Database(dbPath, { readonly: true });

    let rows;
    try {
        rows = db.prepare(`
            SELECT key, value FROM memories
            WHERE (key LIKE 'agent.case.%' OR key LIKE 'agent.pattern.%')
              AND end_time IS NULL
            ORDER BY start_time DESC
            LIMIT ?
        `).all(limit);
    } catch {
        rows = [];
    }

    db.close();
    return rows.map(r => {
        let value;
        try { value = JSON.parse(r.value); } catch { value = r.value; }
        return { key: r.key, value };
    });
}

/**
 * Get high-confidence instincts for session injection.
 * Instincts are learned behavioral rules from repeated observations.
 * @param {number} limit - Maximum number of entries to return
 * @param {number} minConfidence - Minimum confidence threshold (default 0.6)
 * @returns {Array} Array of {key, value} objects
 */
function getInstincts(limit = 10, minConfidence = 0.6) {
    if (!fs.existsSync(dbPath)) return [];
    const db = new Database(dbPath, { readonly: true });

    let rows;
    try {
        rows = db.prepare(`
            SELECT key, value FROM memories
            WHERE key LIKE 'agent.instinct.%' AND end_time IS NULL
            ORDER BY start_time DESC
            LIMIT ?
        `).all(limit * 2); // Fetch more, then filter by confidence
    } catch {
        rows = [];
    }

    db.close();

    return rows
        .map(r => {
            let value;
            try { value = JSON.parse(r.value); } catch { value = r.value; }
            return { key: r.key, value };
        })
        .filter(r => typeof r.value === 'object' && r.value.confidence >= minConfidence)
        .slice(0, limit);
}

/**
 * Load evolved instructions for session injection.
 */
function getEvolvedInstructions() {
    const injectPath = path.join(__dirname, '..', 'evolved-inject.json');
    if (!fs.existsSync(injectPath)) return [];
    try { return JSON.parse(fs.readFileSync(injectPath, 'utf8')); }
    catch { return []; }
}

/**
 * Load the most recent context checkpoint for session continuation.
 * Only returns checkpoints created within the last 6 hours.
 */
function getLatestCheckpoint() {
    const checkpointDir = path.join(os.homedir(), '.openclaw/workspace/data/checkpoints');
    const latestPath = path.join(checkpointDir, 'latest.md');
    if (!fs.existsSync(latestPath)) return null;

    try {
        const stat = fs.statSync(latestPath);
        const ageHours = (Date.now() - stat.mtimeMs) / (1000 * 60 * 60);
        if (ageHours > 6) return null; // Too old, not relevant

        const content = fs.readFileSync(latestPath, 'utf8');
        if (content.length < 50) return null;
        return content;
    } catch { return null; }
}

/**
 * Check for pending nudge and clear it after reading.
 * @returns {Object|null} nudge data or null
 */
function checkAndClearNudge() {
    if (!fs.existsSync(dbPath)) return null;
    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('busy_timeout = 5000');

    let nudge = null;
    try {
        const row = db.prepare(`
            SELECT key, value, start_time FROM memories
            WHERE key = 'system.nudge.pending' AND end_time IS NULL
            LIMIT 1
        `).get();

        if (row) {
            try { nudge = JSON.parse(row.value); } catch { nudge = null; }
            // Clear the nudge after reading
            const now = new Date().toISOString();
            db.prepare(`UPDATE memories SET end_time = ? WHERE key = 'system.nudge.pending' AND end_time IS NULL`).run(now);
        }
    } catch {
        nudge = null;
    }

    db.close();
    return nudge;
}

function formatText(digest, l1Facts, topErrors = [], agentMemory = [], instincts = [], evolvedInstructions = [], checkpoint = null, nudge = null) {
    const lines = [];
    if (digest) {
        const config = loadConfig();
        const minCount = config.min_count_for_l0 || 5;
        const maxCats = config.max_categories_in_l0 || 15;

        // Filter categories: must meet min_count, then take top N by count
        const filtered = Object.entries(digest.categories)
            .filter(([, v]) => v.count >= minCount)
            .sort((a, b) => b[1].count - a[1].count)
            .slice(0, maxCats);

        const totalFacts = filtered.reduce((sum, [, v]) => sum + v.count, 0);
        const catLine = filtered.map(([k, v]) => `${k}(${v.count})`).join(' ');

        lines.push(`[Memory — ${digest.generated_at.slice(0, 10)} | ${totalFacts} facts] ${catLine}`);
    } else {
        lines.push('[Memory — digest not available, run pipeline first]');
    }
    if (l1Facts.length > 0) {
        lines.push('[Details]');
        for (const { key, value } of l1Facts) {
            lines.push(`${key} = ${JSON.stringify(value)}`);
        }
    }
    // Add top errors section
    if (topErrors.length > 0) {
        lines.push('[Past Errors — avoid repeating]');
        for (const { key, value } of topErrors) {
            const errorInfo = typeof value === 'object' ? value : {};
            const hint = errorInfo.solution
                ? `Solution: ${errorInfo.solution}`
                : `Error: ${(errorInfo.error || '').slice(0, 100)}`;
            lines.push(`${key} (${errorInfo.count || 1}x): ${hint}`);
        }
    }
    // Add agent memory section (cases & patterns)
    if (agentMemory.length > 0) {
        const cases = agentMemory.filter(m => m.key.includes('.case.'));
        const patterns = agentMemory.filter(m => m.key.includes('.pattern.'));

        if (cases.length > 0) {
            lines.push('[Agent Cases — learned problem solutions]');
            for (const { key, value } of cases) {
                const caseInfo = typeof value === 'object' ? value : {};
                const problem = caseInfo.problem || 'Unknown';
                const solution = caseInfo.solution?.description || caseInfo.solution?.tools?.join(', ') || 'N/A';
                lines.push(`${key.split('.').slice(-1)[0]}: ${problem.slice(0, 80)} → ${solution.slice(0, 80)}`);
            }
        }

        if (patterns.length > 0) {
            lines.push('[Agent Patterns — effective workflows]');
            for (const { key, value } of patterns) {
                const patternDesc = typeof value === 'string' ? value : JSON.stringify(value);
                lines.push(`${key.split('.').slice(-1)[0]}: ${patternDesc.slice(0, 120)}`);
            }
        }
    }
    // Add instincts section (learned behavioral rules)
    if (instincts.length > 0) {
        lines.push('[Instincts — learned behaviors (do not repeat mistakes)]');
        for (const { key, value } of instincts) {
            const domain = key.split('.')[2] || 'general';
            const conf = value.confidence ? `${Math.round(value.confidence * 100)}%` : '';
            const trigger = value.trigger || '';
            const action = value.action || '';
            lines.push(`[${domain}] ${trigger} → ${action} (${conf})`);
        }
    }
    // Add evolved instructions (self-evolution agent output)
    if (evolvedInstructions.length > 0) {
        const highConf = evolvedInstructions.filter(i => i.confidence === 'high');
        if (highConf.length > 0) {
            lines.push('[Evolved Instructions — auto-generated from error patterns]');
            for (const i of highConf) {
                lines.push(`• ${i.instruction}`);
            }
        }
    }
    // Add nudge message if pending
    if (nudge) {
        lines.push(`[Nudge — previous session used ${nudge.tool_calls} tool calls. Consider synthesizing a reusable skill or pattern.]`);
    }
    // Add recent checkpoint for session continuation
    if (checkpoint) {
        lines.push('[Recent Session Checkpoint — continue from here if relevant]');
        // Strip HTML comment metadata, keep only the markdown content
        const cleanCheckpoint = checkpoint.replace(/<!--[\s\S]*?-->\n?/, '').trim();
        lines.push(cleanCheckpoint);
    }
    return lines.join('\n');
}

async function main() {
    const opts   = parseArgs();
    const digest = loadDigest();
    const l1Facts = (opts.keys || opts.prefix)
        ? queryL1(opts)
        : opts.query
            ? await hybridQuery(opts.query, opts.limit)
            : [];
    // Get top errors, agent memory, and instincts for SessionStart injection
    const isHookFormat = opts.format === 'claude' || opts.format === 'gemini-hook';
    const topErrors = isHookFormat ? getTopErrors(5) : [];
    const agentMemory = isHookFormat ? getRelevantAgentMemory(5) : [];
    const instincts = isHookFormat ? getInstincts(8, 0.6) : [];
    const evolvedInstructions = isHookFormat ? getEvolvedInstructions() : [];
    const checkpoint = isHookFormat ? getLatestCheckpoint() : null;
    const nudge = isHookFormat ? checkAndClearNudge() : null;

    if (opts.format === 'json') {
        process.stdout.write(JSON.stringify({
            digest,
            facts: l1Facts,
            errors: topErrors,
            agentMemory,
            instincts
        }, null, 2) + '\n');
    } else if (opts.format === 'gemini-hook') {
        const textOutput = formatText(digest, l1Facts, topErrors, agentMemory, instincts, evolvedInstructions, checkpoint, nudge);
        const hookResponse = {
            hookSpecificOutput: {
                additionalContext: textOutput
            },
            systemMessage: "🧠 Memory consolidated.",
            suppressOutput: true
        };
        process.stdout.write(JSON.stringify(hookResponse, null, 2) + '\n');
    } else if (opts.format === 'claude') {
        // Claude Code SessionStart hook format
        const textOutput = formatText(digest, l1Facts, topErrors, agentMemory, instincts, evolvedInstructions, checkpoint, nudge);
        const hookResponse = {
            hookSpecificOutput: {
                additionalContext: textOutput
            }
        };
        process.stdout.write(JSON.stringify(hookResponse) + '\n');
    } else {
        process.stdout.write(formatText(digest, l1Facts, topErrors, agentMemory, instincts, evolvedInstructions, checkpoint, nudge) + '\n');
    }
}

main().catch(console.error);
