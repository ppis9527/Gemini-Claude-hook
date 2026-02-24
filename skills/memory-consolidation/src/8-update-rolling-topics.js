/**
 * Step 8: Update rolling topic files
 *
 * Aggregates all facts (or recent N weeks) by category into
 * a single rolling file per topic. Shows timeline of changes.
 *
 * Usage: node 8-update-rolling-topics.js [--weeks N]
 *        (defaults to all facts)
 *
 * Output: topics/<category>.md (rolling, always up-to-date)
 *         topics/index.md (master index)
 */

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const DB_PATH = process.env.MEMORY_DB_PATH || path.join(__dirname, '..', 'memory.db');
const TOPICS_DIR = process.env.MEMORY_TOPICS_DIR || path.join(__dirname, '..', 'topics');

function parseArgs() {
    const args = process.argv.slice(2);
    let weeks = null; // null = all time

    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--weeks' && args[i + 1]) {
            weeks = parseInt(args[i + 1]);
        }
    }
    return { weeks };
}

function normalizeKey(key) {
    // Normalize keys: replace / with . for consistency
    return key.replace(/\//g, '.');
}

function groupByCategory(facts) {
    const groups = {};
    for (const fact of facts) {
        // Normalize the key first
        const normalizedKey = normalizeKey(fact.key);
        const parts = normalizedKey.split('.');
        const category = parts[0] || 'misc';
        if (!groups[category]) groups[category] = [];
        // Store with normalized key
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

function generateRollingTopicMarkdown(category, facts, dateRange) {
    const lines = [];
    lines.push(`# ${category}`);
    lines.push('');
    lines.push(`> Rolling topic file - auto-updated weekly`);
    lines.push(`> Period: ${dateRange.start} ~ ${dateRange.end}`);
    lines.push(`> Facts: ${facts.length}`);
    lines.push(`> Updated: ${new Date().toISOString().slice(0, 16)}`);
    lines.push('');

    // Group by sub-category
    const subGroups = {};
    for (const fact of facts) {
        const parts = fact.key.split('.');
        const subCat = parts.length > 1 ? parts[1] : '_general';
        if (!subGroups[subCat]) subGroups[subCat] = [];
        subGroups[subCat].push(fact);
    }

    // Sort sub-categories, put _general last
    const sortedSubs = Object.keys(subGroups).sort((a, b) => {
        if (a === '_general') return 1;
        if (b === '_general') return -1;
        return a.localeCompare(b);
    });

    for (const subCat of sortedSubs) {
        const subFacts = subGroups[subCat];

        if (subCat !== '_general') {
            lines.push(`## ${subCat}`);
            lines.push('');
        }

        // Sort by date descending (newest first)
        subFacts.sort((a, b) => b.start_time.localeCompare(a.start_time));

        // Group by third-level key
        const keyGroups = {};
        for (const fact of subFacts) {
            const keyParts = fact.key.split('.');
            const thirdLevel = keyParts.slice(2).join('.') || '_root';
            if (!keyGroups[thirdLevel]) keyGroups[thirdLevel] = [];
            keyGroups[thirdLevel].push(fact);
        }

        for (const [key, keyFacts] of Object.entries(keyGroups)) {
            if (key !== '_root' && keyFacts.length > 0) {
                // Multiple facts for same key = show timeline
                if (keyFacts.length > 1) {
                    lines.push(`### ${key}`);
                    lines.push('');
                    lines.push('| Date | Value |');
                    lines.push('|------|-------|');
                    for (const fact of keyFacts.slice(0, 5)) { // limit to 5 most recent
                        const date = fact.start_time.slice(0, 10);
                        const shortVal = fact.value.length > 50
                            ? fact.value.slice(0, 50) + '...'
                            : fact.value;
                        lines.push(`| ${date} | ${shortVal} |`);
                    }
                    if (keyFacts.length > 5) {
                        lines.push(`| ... | (${keyFacts.length - 5} more) |`);
                    }
                    lines.push('');

                    // Show latest value in full
                    const latest = keyFacts[0];
                    const value = formatValue(latest.value);
                    if (value.includes('\n') || value.length > 100) {
                        lines.push('**Latest:**');
                        lines.push('');
                        lines.push(value);
                        lines.push('');
                    }
                } else {
                    // Single fact
                    const fact = keyFacts[0];
                    const date = fact.start_time.slice(0, 10);
                    const value = formatValue(fact.value);

                    if (value.includes('\n') || value.length > 80) {
                        lines.push(`### ${key}`);
                        lines.push(`_${date}_`);
                        lines.push('');
                        lines.push(value);
                        lines.push('');
                    } else {
                        lines.push(`- **${key}**: ${value} _(${date})_`);
                    }
                }
            } else {
                // Root level facts (no third-level key)
                for (const fact of keyFacts) {
                    const date = fact.start_time.slice(0, 10);
                    const shortKey = fact.key.split('.').slice(1).join('.') || fact.key;
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
            }
        }
        lines.push('');
    }

    // Add hashtags
    lines.push('---');
    lines.push(`#openclaw #rolling-topic #${category} #memory`);

    return lines.join('\n');
}

function generateIndexMarkdown(groups, dateRange) {
    const lines = [];
    lines.push('# Memory Topics Index');
    lines.push('');
    lines.push(`> Auto-generated rolling index`);
    lines.push(`> Period: ${dateRange.start} ~ ${dateRange.end}`);
    lines.push(`> Updated: ${new Date().toISOString().slice(0, 16)}`);
    lines.push('');

    const totalFacts = Object.values(groups).reduce((sum, g) => sum + g.length, 0);
    lines.push(`**Total facts:** ${totalFacts}`);
    lines.push(`**Categories:** ${Object.keys(groups).length}`);
    lines.push('');

    lines.push('## Topics');
    lines.push('');
    lines.push('| Topic | Facts | Latest Update | Link |');
    lines.push('|-------|-------|---------------|------|');

    // Sort by fact count descending
    const sorted = Object.entries(groups).sort((a, b) => b[1].length - a[1].length);

    for (const [category, facts] of sorted) {
        const latestDate = facts
            .map(f => f.start_time.slice(0, 10))
            .sort()
            .pop();
        lines.push(`| ${category} | ${facts.length} | ${latestDate} | [${category}.md](./${category}.md) |`);
    }
    lines.push('');

    // Quick links to weekly snapshots
    lines.push('## Weekly Snapshots');
    lines.push('');

    const weeklyFiles = fs.readdirSync(TOPICS_DIR)
        .filter(f => /^\d{4}-W\d{2}-summary\.md$/.test(f))
        .sort()
        .reverse()
        .slice(0, 8); // last 8 weeks

    if (weeklyFiles.length > 0) {
        for (const file of weeklyFiles) {
            const week = file.replace('-summary.md', '');
            lines.push(`- [${week}](./${file})`);
        }
    } else {
        lines.push('_No weekly snapshots yet._');
    }
    lines.push('');

    // Add hashtags
    const categoryTags = Object.keys(groups).slice(0, 5).map(c => `#${c}`).join(' ');
    lines.push('---');
    lines.push(`#openclaw #memory-index #topics ${categoryTags}`);

    return lines.join('\n');
}

function main() {
    const { weeks } = parseArgs();

    if (!fs.existsSync(DB_PATH)) {
        console.error(`DB not found: ${DB_PATH}`);
        process.exit(1);
    }

    if (!fs.existsSync(TOPICS_DIR)) {
        fs.mkdirSync(TOPICS_DIR, { recursive: true });
    }

    const db = new Database(DB_PATH, { readonly: true });

    // Build date range
    let startDate, endDate;
    endDate = new Date().toISOString().slice(0, 10);

    if (weeks) {
        const start = new Date();
        start.setDate(start.getDate() - (weeks * 7));
        startDate = start.toISOString().slice(0, 10);
        console.log(`Rolling topics: last ${weeks} weeks (${startDate} ~ ${endDate})...`);
    } else {
        // Get earliest fact date
        const earliest = db.prepare(`
            SELECT MIN(date(start_time)) as min_date FROM memories
        `).get();
        startDate = earliest?.min_date || endDate;
        console.log(`Rolling topics: all time (${startDate} ~ ${endDate})...`);
    }

    const dateRange = { start: startDate, end: endDate };

    // Query all active facts in range
    const facts = db.prepare(`
        SELECT key, value, source, start_time
        FROM memories
        WHERE date(start_time) BETWEEN ? AND ?
          AND end_time IS NULL
        ORDER BY start_time ASC
    `).all(startDate, endDate);

    db.close();

    if (facts.length === 0) {
        console.log('No facts found.');
        return;
    }

    const groups = groupByCategory(facts);

    // Generate rolling topic files
    let filesWritten = 0;
    for (const [category, catFacts] of Object.entries(groups)) {
        const markdown = generateRollingTopicMarkdown(category, catFacts, dateRange);
        const filepath = path.join(TOPICS_DIR, `${category}.md`);
        fs.writeFileSync(filepath, markdown);
        filesWritten++;
    }

    // Generate index
    const indexMd = generateIndexMarkdown(groups, dateRange);
    const indexPath = path.join(TOPICS_DIR, 'index.md');
    fs.writeFileSync(indexPath, indexMd);

    console.log(`Rolling topics: ${facts.length} facts → ${filesWritten} topic files + index`);
}

main();
