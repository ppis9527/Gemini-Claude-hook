/**
 * Step 2: Align facts temporally.
 *
 * Reads facts.jsonl, groups by key, deduplicates same-value entries,
 * assigns start_time/end_time for value transitions, outputs timed_facts.jsonl.
 */

const fs = require('fs');
const path = require('path');

const FACTS_FILE       = process.env.FACTS_FILE       || path.join(__dirname, 'facts.jsonl');
const TIMED_FACTS_FILE = process.env.TIMED_FACTS_FILE || path.join(__dirname, 'timed_facts.jsonl');

// Normalize plural category prefixes to singular
const CATEGORY_ALIASES = {
    agents: 'agent', models: 'model', channels: 'channel', bindings: 'binding',
    plugins: 'plugin', commands: 'command', tools: 'tool', tasks: 'task',
    projects: 'project', workflows: 'workflow', teams: 'team', users: 'user',
    preferences: 'preference', locations: 'location', environments: 'environment',
    configs: 'config', systems: 'system', skills: 'skill', errors: 'error',
    conversations: 'conversation', messages: 'message', builds: 'build',
};

function normalizeKey(key) {
    const dotIdx = key.indexOf('.');
    if (dotIdx === -1) return key;
    const prefix = key.slice(0, dotIdx);
    const rest = key.slice(dotIdx);
    return (CATEGORY_ALIASES[prefix] || prefix) + rest;
}

function readFacts() {
    if (!fs.existsSync(FACTS_FILE)) return [];
    const lines = fs.readFileSync(FACTS_FILE, 'utf8').split('\n').filter(Boolean);
    const facts = [];
    for (const line of lines) {
        try { facts.push(JSON.parse(line)); } catch { /* skip malformed */ }
    }
    return facts;
}

function alignFacts(facts) {
    // Normalize keys then group
    const groups = {};
    for (const fact of facts) {
        fact.key = normalizeKey(fact.key);
        if (!groups[fact.key]) groups[fact.key] = [];
        groups[fact.key].push(fact);
    }

    const timedFacts = [];

    for (const [key, entries] of Object.entries(groups)) {
        // Sort by message_timestamp ascending
        entries.sort((a, b) => (a.message_timestamp || '').localeCompare(b.message_timestamp || ''));

        // Deduplicate: same key + same value → keep only the earliest
        const deduped = [];
        const seenValues = new Set();
        for (const entry of entries) {
            const valStr = JSON.stringify(entry.value);
            if (seenValues.has(valStr)) continue;
            seenValues.add(valStr);
            deduped.push(entry);
        }

        // Assign start_time / end_time
        for (let i = 0; i < deduped.length; i++) {
            const current = deduped[i];
            const next = deduped[i + 1];

            timedFacts.push({
                key: current.key,
                value: current.value,
                source: current.source,
                start_time: current.message_timestamp,
                end_time: next ? next.message_timestamp : null,
            });
        }
    }

    return timedFacts;
}

function main() {
    const facts = readFacts();
    if (facts.length === 0) {
        console.log('No facts to align.');
        fs.writeFileSync(TIMED_FACTS_FILE, '');
        return;
    }

    const timedFacts = alignFacts(facts);

    const lines = timedFacts.map(f => JSON.stringify(f));
    fs.writeFileSync(TIMED_FACTS_FILE, lines.join('\n') + '\n');
    console.log(`Aligned ${timedFacts.length} timed facts → ${TIMED_FACTS_FILE}`);
}

// Export for testing
module.exports = { alignFacts, normalizeKey };

// Run if executed directly
if (require.main === module) {
    main();
}
