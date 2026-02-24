const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const dbPath     = process.env.MEMORY_DB_PATH     || path.join(__dirname, '..', 'memory.db');
const digestPath = process.env.MEMORY_DIGEST_PATH || path.join(__dirname, '..', 'memory_digest.json');
const configPath = process.env.MEMORY_CONFIG_PATH || path.join(__dirname, '..', 'digest-config.json');

function loadConfig() {
    try { return JSON.parse(fs.readFileSync(configPath, 'utf8')); }
    catch { return { min_count_for_l0: 5, max_categories_in_l0: 15 }; }
}

function parseArgs() {
    const args = process.argv.slice(2);
    const opts = { keys: null, prefix: null, limit: 10, format: 'text' };
    for (let i = 0; i < args.length; i++) {
        if      (args[i] === '--keys'   && args[i + 1]) opts.keys   = args[++i].split(',');
        else if (args[i] === '--prefix' && args[i + 1]) opts.prefix = args[++i];
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

function formatText(digest, l1Facts, topErrors = [], agentMemory = [], instincts = []) {
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
    return lines.join('\n');
}

function main() {
    const opts   = parseArgs();
    const digest = loadDigest();
    const l1Facts = (opts.keys || opts.prefix) ? queryL1(opts) : [];
    // Get top errors, agent memory, and instincts for SessionStart injection
    const isHookFormat = opts.format === 'claude' || opts.format === 'gemini-hook';
    const topErrors = isHookFormat ? getTopErrors(5) : [];
    const agentMemory = isHookFormat ? getRelevantAgentMemory(5) : [];
    const instincts = isHookFormat ? getInstincts(8, 0.6) : [];

    if (opts.format === 'json') {
        process.stdout.write(JSON.stringify({
            digest,
            facts: l1Facts,
            errors: topErrors,
            agentMemory,
            instincts
        }, null, 2) + '\n');
    } else if (opts.format === 'gemini-hook') {
        const textOutput = formatText(digest, l1Facts, topErrors, agentMemory, instincts);
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
        const textOutput = formatText(digest, l1Facts, topErrors, agentMemory, instincts);
        const hookResponse = {
            hookSpecificOutput: {
                additionalContext: textOutput
            }
        };
        process.stdout.write(JSON.stringify(hookResponse) + '\n');
    } else {
        process.stdout.write(formatText(digest, l1Facts, topErrors, agentMemory, instincts) + '\n');
    }
}

main();
