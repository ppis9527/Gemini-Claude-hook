#!/usr/bin/env node
/**
 * Instinct CLI - Manage learned behavioral rules
 *
 * Usage:
 *   instinct list                    # List all instincts
 *   instinct list --domain error     # Filter by domain
 *   instinct show <key>              # Show instinct details
 *   instinct extract [--store]       # Extract new instincts from cases/patterns
 *   instinct delete <key>            # Delete an instinct
 *   instinct stats                   # Show statistics
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbPath = process.env.MEMORY_DB_PATH || path.join(__dirname, '..', 'memory.db');

function getDb(readonly = true) {
    if (!fs.existsSync(dbPath)) {
        console.error('Database not found:', dbPath);
        process.exit(1);
    }
    const db = new Database(dbPath, { readonly });
    db.pragma('busy_timeout = 10000');
    if (!readonly) db.pragma('journal_mode = WAL');
    return db;
}

function listInstincts(domain = null) {
    const db = getDb();
    let sql = `
        SELECT key, value, start_time FROM memories
        WHERE key LIKE 'agent.instinct.%' AND end_time IS NULL
        ORDER BY key
    `;

    const rows = db.prepare(sql).all();
    db.close();

    const instincts = rows
        .map(r => {
            let value;
            try { value = JSON.parse(r.value); } catch { value = {}; }
            return { key: r.key, ...value, start_time: r.start_time };
        })
        .filter(i => !domain || i.domain === domain);

    if (instincts.length === 0) {
        console.log('No instincts found.');
        return;
    }

    console.log(`\n📚 Instincts (${instincts.length})\n`);

    // Group by domain
    const grouped = {};
    for (const i of instincts) {
        const d = i.domain || 'unknown';
        if (!grouped[d]) grouped[d] = [];
        grouped[d].push(i);
    }

    for (const [d, items] of Object.entries(grouped)) {
        console.log(`## ${d.toUpperCase()} (${items.length})`);
        for (const i of items) {
            const conf = i.confidence ? `${Math.round(i.confidence * 100)}%` : '?';
            const evidence = i.evidence_count ? `(${i.evidence_count}x)` : '';
            console.log(`  [${conf}] ${i.trigger || i.key}`);
            console.log(`       → ${(i.action || '').slice(0, 80)}`);
        }
        console.log('');
    }
}

function showInstinct(key) {
    const db = getDb();
    const row = db.prepare(`
        SELECT key, value, start_time, source FROM memories
        WHERE key = ? AND end_time IS NULL
    `).get(key);
    db.close();

    if (!row) {
        // Try partial match
        const db2 = getDb();
        const rows = db2.prepare(`
            SELECT key FROM memories
            WHERE key LIKE ? AND end_time IS NULL
        `).all(`%${key}%`);
        db2.close();

        if (rows.length > 0) {
            console.log('Did you mean:');
            rows.forEach(r => console.log(`  - ${r.key}`));
        } else {
            console.log('Instinct not found:', key);
        }
        return;
    }

    let value;
    try { value = JSON.parse(row.value); } catch { value = row.value; }

    console.log('\n📖 Instinct Details\n');
    console.log(`Key:        ${row.key}`);
    console.log(`Domain:     ${value.domain || 'unknown'}`);
    console.log(`Confidence: ${value.confidence ? Math.round(value.confidence * 100) + '%' : '?'}`);
    console.log(`Evidence:   ${value.evidence_count || 0} observations`);
    console.log(`Created:    ${row.start_time}`);
    console.log(`Source:     ${value.source || row.source || 'unknown'}`);
    console.log('');
    console.log(`Trigger:    ${value.trigger || 'N/A'}`);
    console.log(`Action:     ${value.action || 'N/A'}`);

    if (value.common_tools?.length > 0) {
        console.log(`Tools:      ${value.common_tools.join(', ')}`);
    }
    if (value.sequence?.length > 0) {
        console.log(`Sequence:   ${value.sequence.join(' → ')}`);
    }
    console.log('');
}

function deleteInstinct(key) {
    const db = getDb(false);
    const now = new Date().toISOString();

    const result = db.prepare(`
        UPDATE memories SET end_time = ?
        WHERE key = ? AND end_time IS NULL
    `).run(now, key);

    db.close();

    if (result.changes > 0) {
        console.log(`✓ Deleted: ${key}`);
    } else {
        console.log(`✗ Not found: ${key}`);
    }
}

function showStats() {
    const db = getDb();

    const total = db.prepare(`
        SELECT COUNT(*) as count FROM memories
        WHERE key LIKE 'agent.instinct.%' AND end_time IS NULL
    `).get();

    const byDomain = db.prepare(`
        SELECT
            json_extract(value, '$.domain') as domain,
            COUNT(*) as count
        FROM memories
        WHERE key LIKE 'agent.instinct.%' AND end_time IS NULL
          AND json_valid(value)
        GROUP BY domain
    `).all();

    const avgConfidence = db.prepare(`
        SELECT AVG(CAST(json_extract(value, '$.confidence') AS REAL)) as avg
        FROM memories
        WHERE key LIKE 'agent.instinct.%' AND end_time IS NULL
          AND json_valid(value)
    `).get();

    const cases = db.prepare(`
        SELECT COUNT(*) as count FROM memories
        WHERE key LIKE 'agent.case.%' AND end_time IS NULL
    `).get();

    const patterns = db.prepare(`
        SELECT COUNT(*) as count FROM memories
        WHERE key LIKE 'agent.pattern.%' AND end_time IS NULL
    `).get();

    db.close();

    console.log('\n📊 Instinct Statistics\n');
    console.log(`Total instincts:    ${total.count}`);
    console.log(`Avg confidence:     ${avgConfidence.avg ? Math.round(avgConfidence.avg * 100) + '%' : 'N/A'}`);
    console.log(`Source cases:       ${cases.count}`);
    console.log(`Source patterns:    ${patterns.count}`);
    console.log('');
    console.log('By domain:');
    for (const d of byDomain) {
        console.log(`  ${d.domain || 'unknown'}: ${d.count}`);
    }
    console.log('');
}

async function extractInstincts(store = false) {
    const { extractInstincts, storeInstincts } = require('../src/extract-instincts.js');
    const instincts = extractInstincts(0.5);

    console.log('\nExtracted instincts:');
    for (const i of instincts) {
        const val = JSON.parse(i.value);
        console.log(`  [${val.domain}] ${val.trigger} (${Math.round(val.confidence * 100)}%)`);
    }

    if (store && instincts.length > 0) {
        storeInstincts(instincts);
        console.log(`\n✓ Stored ${instincts.length} instinct(s)`);
    } else if (!store && instincts.length > 0) {
        console.log('\nUse --store to save to database');
    }
}

// CLI
const args = process.argv.slice(2);
const command = args[0];

switch (command) {
    case 'list':
    case 'ls':
        const domainIdx = args.indexOf('--domain');
        const domain = domainIdx !== -1 ? args[domainIdx + 1] : null;
        listInstincts(domain);
        break;

    case 'show':
    case 'get':
        if (!args[1]) {
            console.log('Usage: instinct show <key>');
            process.exit(1);
        }
        showInstinct(args[1]);
        break;

    case 'delete':
    case 'rm':
        if (!args[1]) {
            console.log('Usage: instinct delete <key>');
            process.exit(1);
        }
        deleteInstinct(args[1]);
        break;

    case 'extract':
        extractInstincts(args.includes('--store'));
        break;

    case 'stats':
        showStats();
        break;

    default:
        console.log(`
Instinct CLI - Manage learned behavioral rules

Usage:
  instinct list [--domain <domain>]   List all instincts
  instinct show <key>                 Show instinct details
  instinct extract [--store]          Extract from cases/patterns
  instinct delete <key>               Delete an instinct
  instinct stats                      Show statistics

Domains: error, workflow, tool, coding, testing
        `);
}
