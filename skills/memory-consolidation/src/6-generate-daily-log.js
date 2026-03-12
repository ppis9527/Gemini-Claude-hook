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

function formatValue(value, key) {
    // Try to parse JSON and convert to human-readable summary
    try {
        const parsed = JSON.parse(value);
        if (typeof parsed !== 'object' || parsed === null) return String(parsed);

        // Instinct: {trigger, action, confidence, domain, evidence_count, ...}
        if (parsed.trigger && parsed.action) {
            const conf = parsed.confidence ? ` (${Math.round(parsed.confidence * 100)}%)` : '';
            const evidence = parsed.evidence_count ? `, ${parsed.evidence_count} cases` : '';
            return `${parsed.trigger} → ${truncate(parsed.action, 100)}${conf}${evidence}`;
        }

        // Case: {problem, solution, outcome, ...}
        if (parsed.problem && parsed.solution) {
            const outcome = parsed.outcome ? ` [${parsed.outcome}]` : '';
            const sol = typeof parsed.solution === 'object'
                ? (parsed.solution.description || parsed.solution.tools?.join(', ') || JSON.stringify(parsed.solution))
                : parsed.solution;
            return `${truncate(parsed.problem, 80)} → ${truncate(sol, 80)}${outcome}`;
        }

        // Evolved instruction: {instruction, evidence, confidence, ...}
        if (parsed.instruction) {
            const conf = parsed.confidence ? ` [${parsed.confidence}]` : '';
            return `${truncate(parsed.instruction, 120)}${conf}`;
        }

        // Config/settings: flat object with simple values
        const entries = Object.entries(parsed);
        if (entries.length <= 5 && entries.every(([, v]) => typeof v !== 'object')) {
            return entries.map(([k, v]) => `${k}=${v}`).join(', ');
        }

        // Array of simple values
        if (Array.isArray(parsed) && parsed.length <= 10 && parsed.every(v => typeof v !== 'object')) {
            return parsed.join(', ');
        }

        // Fallback: summarize keys + first few values
        const summary = entries.slice(0, 4).map(([k, v]) => {
            const val = typeof v === 'object' ? JSON.stringify(v) : String(v);
            return `${k}: ${truncate(val, 40)}`;
        }).join(' | ');
        return entries.length > 4 ? `${summary} (+${entries.length - 4} more)` : summary;
    } catch {
        return value;
    }
}

function truncate(str, max) {
    if (!str) return '';
    str = String(str);
    return str.length > max ? str.slice(0, max - 1) + '…' : str;
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
            const value = formatValue(fact.value, fact.key);

            // Everything as one-liner now (JSON is summarized)
            if (value.length > 120) {
                lines.push(`### ${shortKey}`);
                lines.push(`_${time}_ — ${value}`);
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
