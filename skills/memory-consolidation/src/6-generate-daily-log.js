/**
 * Step 6: Generate daily log from memory.db
 *
 * Queries facts created/updated on a given date, formats as markdown.
 * Usage: node 6-generate-daily-log.js [YYYY-MM-DD]
 *        (defaults to today)
 *
 * Output: logs/YYYY-MM-DD.md
 */

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const DB_PATH = process.env.MEMORY_DB_PATH || path.join(__dirname, '..', 'memory.db');
const LOGS_DIR = process.env.MEMORY_LOGS_DIR || path.join(__dirname, '..', 'logs');

function getDateArg() {
    const arg = process.argv[2];
    if (arg && /^\d{4}-\d{2}-\d{2}$/.test(arg)) {
        return arg;
    }
    return new Date().toISOString().slice(0, 10);
}

function normalizeKey(key) {
    // Normalize keys: replace / with . for consistency
    return key.replace(/\//g, '.');
}

function groupByCategory(facts) {
    const groups = {};
    for (const fact of facts) {
        const normalizedKey = normalizeKey(fact.key);
        const parts = normalizedKey.split('.');
        const category = parts[0] || 'misc';
        if (!groups[category]) groups[category] = [];
        groups[category].push({ ...fact, key: normalizedKey });
    }
    return groups;
}

function formatValue(value) {
    // Try to parse JSON for better formatting
    try {
        const parsed = JSON.parse(value);
        if (typeof parsed === 'object') {
            return '```json\n' + JSON.stringify(parsed, null, 2) + '\n```';
        }
        return String(parsed);
    } catch {
        return value;
    }
}

function generateMarkdown(date, facts) {
    const lines = [];
    lines.push(`# Daily Log: ${date}`);
    lines.push('');
    lines.push(`Generated: ${new Date().toISOString()}`);
    lines.push(`Facts: ${facts.length}`);
    lines.push('');

    if (facts.length === 0) {
        lines.push('_No new facts recorded today._');
        return lines.join('\n');
    }

    const groups = groupByCategory(facts);
    const sortedCategories = Object.keys(groups).sort();

    for (const category of sortedCategories) {
        const categoryFacts = groups[category];
        lines.push(`## ${category} (${categoryFacts.length})`);
        lines.push('');

        for (const fact of categoryFacts) {
            const shortKey = fact.key.split('.').slice(1).join('.') || fact.key;
            const time = fact.start_time.slice(11, 16); // HH:MM
            const value = formatValue(fact.value);

            // Single line if short, multi-line if long/JSON
            if (value.includes('\n') || value.length > 60) {
                lines.push(`### ${shortKey}`);
                lines.push(`_${time}_`);
                lines.push('');
                lines.push(value);
                lines.push('');
            } else {
                lines.push(`- **${shortKey}**: ${value} _(${time})_`);
            }
        }
        lines.push('');
    }

    return lines.join('\n');
}

function main() {
    const date = getDateArg();

    if (!fs.existsSync(DB_PATH)) {
        console.error(`DB not found: ${DB_PATH}`);
        process.exit(1);
    }

    // Ensure logs directory exists
    if (!fs.existsSync(LOGS_DIR)) {
        fs.mkdirSync(LOGS_DIR, { recursive: true });
    }

    const db = new Database(DB_PATH, { readonly: true });

    // Query facts created or updated on the given date
    const facts = db.prepare(`
        SELECT key, value, source, start_time
        FROM memories
        WHERE date(start_time) = ?
        ORDER BY start_time ASC
    `).all(date);

    db.close();

    const markdown = generateMarkdown(date, facts);
    const outputPath = path.join(LOGS_DIR, `${date}.md`);

    fs.writeFileSync(outputPath, markdown);
    console.log(`Daily log: ${outputPath} (${facts.length} facts)`);
}

main();
