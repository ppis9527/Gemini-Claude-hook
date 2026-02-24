/**
 * Step 7: Consolidate weekly facts into topic files
 *
 * Groups facts from the past 7 days by category prefix,
 * outputs topic-specific markdown files.
 *
 * Usage: node 7-consolidate-weekly.js [--week YYYY-Www | --end-date YYYY-MM-DD]
 *        (defaults to current week)
 *
 * Output: topics/YYYY-Www-<category>.md
 *         topics/YYYY-Www-summary.md (index)
 */

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const DB_PATH = process.env.MEMORY_DB_PATH || path.join(__dirname, '..', 'memory.db');
const TOPICS_DIR = process.env.MEMORY_TOPICS_DIR || path.join(__dirname, '..', 'topics');

// Get ISO week number
function getWeekNumber(date) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    return { year: d.getUTCFullYear(), week: weekNo };
}

// Get date range for a week
function getWeekRange(year, week) {
    // ISO week starts Monday
    const simple = new Date(year, 0, 1 + (week - 1) * 7);
    const dow = simple.getDay();
    const ISOweekStart = new Date(simple);
    if (dow <= 4) {
        ISOweekStart.setDate(simple.getDate() - simple.getDay() + 1);
    } else {
        ISOweekStart.setDate(simple.getDate() + 8 - simple.getDay());
    }
    const ISOweekEnd = new Date(ISOweekStart);
    ISOweekEnd.setDate(ISOweekStart.getDate() + 6);

    return {
        start: ISOweekStart.toISOString().slice(0, 10),
        end: ISOweekEnd.toISOString().slice(0, 10)
    };
}

function parseArgs() {
    const args = process.argv.slice(2);
    let endDate = new Date();

    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--week' && args[i + 1]) {
            // Format: YYYY-Www (e.g., 2026-W08)
            const match = args[i + 1].match(/^(\d{4})-W(\d{2})$/);
            if (match) {
                const year = parseInt(match[1]);
                const week = parseInt(match[2]);
                const range = getWeekRange(year, week);
                return { year, week, ...range };
            }
        }
        if (args[i] === '--end-date' && args[i + 1]) {
            endDate = new Date(args[i + 1]);
        }
    }

    // Default: current week based on endDate
    const { year, week } = getWeekNumber(endDate);
    const range = getWeekRange(year, week);
    return { year, week, ...range };
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

function generateTopicMarkdown(category, facts, weekLabel, dateRange) {
    const lines = [];
    lines.push(`# ${category}`);
    lines.push('');
    lines.push(`Week: ${weekLabel} (${dateRange.start} ~ ${dateRange.end})`);
    lines.push(`Facts: ${facts.length}`);
    lines.push('');

    // Group by sub-category (second level)
    const subGroups = {};
    for (const fact of facts) {
        const parts = fact.key.split('.');
        const subCat = parts.length > 1 ? parts[1] : '_root';
        if (!subGroups[subCat]) subGroups[subCat] = [];
        subGroups[subCat].push(fact);
    }

    for (const [subCat, subFacts] of Object.entries(subGroups).sort()) {
        if (subCat !== '_root') {
            lines.push(`## ${subCat}`);
            lines.push('');
        }

        for (const fact of subFacts) {
            const keyParts = fact.key.split('.');
            const shortKey = keyParts.slice(2).join('.') || keyParts.slice(1).join('.') || fact.key;
            const date = fact.start_time.slice(0, 10);
            const value = formatValue(fact.value);

            if (value.includes('\n') || value.length > 80) {
                lines.push(`### ${shortKey}`);
                lines.push(`_${date}_`);
                lines.push('');
                lines.push(value);
                lines.push('');
            } else {
                lines.push(`- **${shortKey}**: ${value} _(${date})_`);
            }
        }
        lines.push('');
    }

    return lines.join('\n');
}

function generateSummaryMarkdown(weekLabel, dateRange, groups) {
    const lines = [];
    lines.push(`# Weekly Summary: ${weekLabel}`);
    lines.push('');
    lines.push(`Period: ${dateRange.start} ~ ${dateRange.end}`);
    lines.push(`Generated: ${new Date().toISOString()}`);
    lines.push('');

    const totalFacts = Object.values(groups).reduce((sum, g) => sum + g.length, 0);
    lines.push(`## Overview`);
    lines.push('');
    lines.push(`Total facts: ${totalFacts}`);
    lines.push(`Categories: ${Object.keys(groups).length}`);
    lines.push('');

    lines.push(`## Categories`);
    lines.push('');
    lines.push('| Category | Facts | Link |');
    lines.push('|----------|-------|------|');

    for (const [category, facts] of Object.entries(groups).sort((a, b) => b[1].length - a[1].length)) {
        const filename = `${weekLabel}-${category}.md`;
        lines.push(`| ${category} | ${facts.length} | [${filename}](./${filename}) |`);
    }
    lines.push('');

    // Top facts preview (most recent from each category)
    lines.push(`## Highlights`);
    lines.push('');
    for (const [category, facts] of Object.entries(groups).sort()) {
        const recent = facts.slice(-2); // last 2 facts
        lines.push(`### ${category}`);
        for (const fact of recent) {
            const shortKey = fact.key.split('.').slice(1).join('.');
            const shortVal = fact.value.length > 100 ? fact.value.slice(0, 100) + '...' : fact.value;
            lines.push(`- ${shortKey}: ${shortVal}`);
        }
        lines.push('');
    }

    return lines.join('\n');
}

function main() {
    const { year, week, start, end } = parseArgs();
    const weekLabel = `${year}-W${String(week).padStart(2, '0')}`;
    const dateRange = { start, end };

    console.log(`Consolidating week ${weekLabel} (${start} ~ ${end})...`);

    if (!fs.existsSync(DB_PATH)) {
        console.error(`DB not found: ${DB_PATH}`);
        process.exit(1);
    }

    if (!fs.existsSync(TOPICS_DIR)) {
        fs.mkdirSync(TOPICS_DIR, { recursive: true });
    }

    const db = new Database(DB_PATH, { readonly: true });

    // Query facts from the week
    const facts = db.prepare(`
        SELECT key, value, source, start_time
        FROM memories
        WHERE date(start_time) BETWEEN ? AND ?
        ORDER BY start_time ASC
    `).all(start, end);

    db.close();

    if (facts.length === 0) {
        console.log(`No facts found for week ${weekLabel}.`);
        return;
    }

    const groups = groupByCategory(facts);

    // Generate topic files
    let filesWritten = 0;
    for (const [category, catFacts] of Object.entries(groups)) {
        const markdown = generateTopicMarkdown(category, catFacts, weekLabel, dateRange);
        const filename = `${weekLabel}-${category}.md`;
        const filepath = path.join(TOPICS_DIR, filename);
        fs.writeFileSync(filepath, markdown);
        filesWritten++;
    }

    // Generate summary
    const summaryMd = generateSummaryMarkdown(weekLabel, dateRange, groups);
    const summaryPath = path.join(TOPICS_DIR, `${weekLabel}-summary.md`);
    fs.writeFileSync(summaryPath, summaryMd);

    console.log(`Weekly consolidation: ${facts.length} facts → ${filesWritten + 1} files`);
    console.log(`  Summary: ${summaryPath}`);
}

main();
