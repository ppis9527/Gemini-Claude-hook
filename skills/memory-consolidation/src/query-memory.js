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

function formatText(digest, l1Facts) {
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
    return lines.join('\n');
}

function main() {
    const opts   = parseArgs();
    const digest = loadDigest();
    const l1Facts = (opts.keys || opts.prefix) ? queryL1(opts) : [];

    if (opts.format === 'json') {
        process.stdout.write(JSON.stringify({ digest, facts: l1Facts }, null, 2) + '\n');
    } else if (opts.format === 'gemini-hook') {
        const textOutput = formatText(digest, l1Facts);
        const hookResponse = {
            hookSpecificOutput: {
                additionalContext: textOutput
            },
            systemMessage: "🧠 Memory consolidated.",
            suppressOutput: true
        };
        process.stdout.write(JSON.stringify(hookResponse, null, 2) + '\n');
    } else {
        process.stdout.write(formatText(digest, l1Facts) + '\n');
    }
}

main();
