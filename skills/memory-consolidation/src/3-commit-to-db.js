/**
 * Step 3: Commit timed facts to SQLite memory.db.
 *
 * Reads timed_facts.jsonl, upserts into memory.db with deduplication.
 * Uses dedupDecision() for semantic dedup before commit.
 * Reports: N new, N updated, N merged, N skipped.
 */

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const { dedupDecision } = require('./dedup-decision.js');

const TIMED_FACTS_FILE = process.env.TIMED_FACTS_FILE || path.join(__dirname, 'timed_facts.jsonl');
const DB_PATH          = process.env.MEMORY_DB_PATH   || path.join(__dirname, '..', 'memory.db');

function ensureTable(db) {
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
    db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts
        USING fts5(key, value, content='memories', content_rowid='rowid')
    `);
    // Migration: add embedding column for semantic search
    try {
        db.exec(`ALTER TABLE memories ADD COLUMN embedding BLOB`);
    } catch {
        // Column already exists — ignore
    }
}

function readTimedFacts() {
    if (!fs.existsSync(TIMED_FACTS_FILE)) return [];
    const lines = fs.readFileSync(TIMED_FACTS_FILE, 'utf8').split('\n').filter(Boolean);
    const facts = [];
    for (const line of lines) {
        try { facts.push(JSON.parse(line)); } catch { /* skip malformed */ }
    }
    return facts;
}

/**
 * Commit facts with semantic deduplication.
 * @param {Database} db - better-sqlite3 instance
 * @param {Array} facts - array of fact objects
 * @returns {Promise<Object>} - { newCount, updatedCount, mergedCount, skippedCount }
 */
async function commitFacts(db, facts) {
    const findActive = db.prepare(
        'SELECT rowid, key, value, start_time FROM memories WHERE key = ? AND end_time IS NULL'
    );
    const deactivate = db.prepare(
        'UPDATE memories SET end_time = ? WHERE key = ? AND start_time = ?'
    );
    const insert = db.prepare(
        'INSERT OR REPLACE INTO memories (key, value, source, start_time, end_time) VALUES (?, ?, ?, ?, ?)'
    );
    const ftsInsert = db.prepare(
        'INSERT INTO memories_fts(rowid, key, value) VALUES (?, ?, ?)'
    );
    const ftsDelete = db.prepare(
        "INSERT INTO memories_fts(memories_fts, rowid, key, value) VALUES('delete', ?, ?, ?)"
    );
    const getRowid = db.prepare(
        'SELECT rowid FROM memories WHERE key = ? AND start_time = ?'
    );

    let newCount = 0, updatedCount = 0, mergedCount = 0, skippedCount = 0;

    for (const fact of facts) {
        const valStr = typeof fact.value === 'string' ? fact.value : JSON.stringify(fact.value);

        // Run semantic dedup decision
        const decision = await dedupDecision(fact, db);

        if (decision.action === 'skip') {
            skippedCount++;
            continue;
        }

        if (decision.action === 'merge' && decision.target) {
            // Merge: update the target key's value
            const targetRow = findActive.get(decision.target);
            if (targetRow) {
                // Deactivate old, insert merged value under target key
                ftsDelete.run(targetRow.rowid, targetRow.key, targetRow.value);
                deactivate.run(fact.start_time, targetRow.key, targetRow.start_time);
                insert.run(decision.target, valStr, fact.source, fact.start_time, fact.end_time ?? null);
                const newRow = getRowid.get(decision.target, fact.start_time);
                if (newRow) ftsInsert.run(newRow.rowid, decision.target, valStr);
                mergedCount++;
                continue;
            }
            // If target not found, fall through to create
        }

        // action === 'create' (or merge fallback)
        const activeRow = findActive.get(fact.key);

        if (activeRow) {
            // Same key exists with active (null end_time) row
            if (activeRow.value === valStr) {
                // Same value → skip
                skippedCount++;
                continue;
            } else {
                // Different value → deactivate old, insert new
                ftsDelete.run(activeRow.rowid, activeRow.key, activeRow.value);
                deactivate.run(fact.start_time, activeRow.key, activeRow.start_time);
                insert.run(fact.key, valStr, fact.source, fact.start_time, fact.end_time ?? null);
                const newRow = getRowid.get(fact.key, fact.start_time);
                if (newRow) ftsInsert.run(newRow.rowid, fact.key, valStr);
                updatedCount++;
            }
        } else {
            // No active row for this key → insert
            insert.run(fact.key, valStr, fact.source, fact.start_time, fact.end_time ?? null);
            const newRow = getRowid.get(fact.key, fact.start_time);
            if (newRow) ftsInsert.run(newRow.rowid, fact.key, valStr);
            newCount++;
        }
    }

    return { newCount, updatedCount, mergedCount, skippedCount };
}

async function main() {
    const facts = readTimedFacts();
    if (facts.length === 0) {
        console.log('No timed facts to commit.');
        return;
    }

    const db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('busy_timeout = 10000');
    ensureTable(db);

    // commitFacts is async (due to dedupDecision), so we can't use db.transaction() directly
    // Instead, we wrap the async call and handle transactions manually
    try {
        db.exec('BEGIN TRANSACTION');
        const result = await commitFacts(db, facts);
        db.exec('COMMIT');

        console.log(`Committed: ${result.newCount} new, ${result.updatedCount} updated, ${result.mergedCount} merged, ${result.skippedCount} skipped.`);
    } catch (err) {
        db.exec('ROLLBACK');
        throw err;
    } finally {
        db.close();
    }
}

function rebuildFts(dbOrPath) {
    const db = typeof dbOrPath === 'string'
        ? new Database(dbOrPath)
        : (dbOrPath || new Database(DB_PATH));
    const ownDb = typeof dbOrPath === 'string' || !dbOrPath;

    ensureTable(db);

    // Rebuild: drop all FTS content, re-insert from active memories
    db.exec("INSERT INTO memories_fts(memories_fts) VALUES('rebuild')");

    console.log('FTS5 index rebuilt from memories table.');
    if (ownDb) db.close();
}

// Export for testing
module.exports = { ensureTable, commitFacts, rebuildFts };

// Run if executed directly
if (require.main === module) {
    main().catch(err => {
        console.error('Error:', err.message);
        process.exit(1);
    });
}
