/**
 * Tests for Step 3: Commit to DB (3-commit-to-db.js)
 *
 * Strategy: write temp timed_facts.jsonl, run the script via spawnSync with
 * TIMED_FACTS_FILE + MEMORY_DB_PATH pointing to temp paths, assert on DB content.
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const SRC_DIR   = path.join(__dirname, '..', 'src');
const SCRIPT    = path.join(SRC_DIR, '3-commit-to-db.js');
const DB_MODULE = path.join(SRC_DIR, 'node_modules', 'better-sqlite3');
const Database  = require(DB_MODULE);

const TEMP_TIMED = path.join(os.tmpdir(), `commit-test-timed-${process.pid}.jsonl`);
const TEMP_DB    = path.join(os.tmpdir(), `commit-test-db-${process.pid}.db`);

function run() {
    const result = spawnSync('node', [SCRIPT], {
        encoding: 'utf8',
        env: { ...process.env, TIMED_FACTS_FILE: TEMP_TIMED, MEMORY_DB_PATH: TEMP_DB },
    });
    if (result.status !== 0) throw new Error(`Script failed: ${result.stderr}`);
    return result;
}

function writeTimedFacts(facts) {
    fs.writeFileSync(TEMP_TIMED, facts.map(f => JSON.stringify(f)).join('\n') + '\n');
}

function queryDb(sql, params = []) {
    const db = new Database(TEMP_DB, { readonly: true });
    const rows = db.prepare(sql).all(...params);
    db.close();
    return rows;
}

function cleanup() {
    if (fs.existsSync(TEMP_TIMED)) fs.unlinkSync(TEMP_TIMED);
    if (fs.existsSync(TEMP_DB))    fs.unlinkSync(TEMP_DB);
}

before(cleanup);
after(cleanup);

// ── tests ─────────────────────────────────────────────────────────────────────

test('new facts are inserted into empty DB', () => {
    cleanup();
    writeTimedFacts([
        { key: 'user.name', value: 'Jerry', source: 'session:abc', start_time: '2026-01-01T10:00:00Z', end_time: null },
        { key: 'project.name', value: 'OpenClaw', source: 'session:abc', start_time: '2026-01-01T10:00:00Z', end_time: null },
    ]);
    const result = run();
    assert.match(result.stdout, /2 new/);

    const rows = queryDb('SELECT * FROM memories WHERE end_time IS NULL');
    assert.equal(rows.length, 2);
});

test('same facts re-committed are skipped (idempotent)', () => {
    cleanup();
    writeTimedFacts([
        { key: 'user.name', value: 'Jerry', source: 'session:abc', start_time: '2026-01-01T10:00:00Z', end_time: null },
    ]);
    run();
    // Run again with same facts
    const result = run();
    assert.match(result.stdout, /0 new/);
    assert.match(result.stdout, /1 skipped/);

    const rows = queryDb('SELECT * FROM memories');
    assert.equal(rows.length, 1, 'no duplicates');
});

test('updated value deactivates old row and inserts new', () => {
    cleanup();
    // First commit: Taipei
    writeTimedFacts([
        { key: 'user.city', value: 'Taipei', source: 'session:a', start_time: '2026-01-01T10:00:00Z', end_time: null },
    ]);
    run();

    // Second commit: Hsinchu (different value for same key)
    writeTimedFacts([
        { key: 'user.city', value: 'Hsinchu', source: 'session:b', start_time: '2026-01-02T10:00:00Z', end_time: null },
    ]);
    const result = run();
    assert.match(result.stdout, /1 updated/);

    const all = queryDb('SELECT * FROM memories ORDER BY start_time');
    assert.equal(all.length, 2, 'old + new rows');

    const old = all.find(r => r.value === 'Taipei');
    assert.ok(old.end_time, 'old row should have end_time');
    assert.equal(old.end_time, '2026-01-02T10:00:00Z');

    const current = all.find(r => r.value === 'Hsinchu');
    assert.equal(current.end_time, null, 'new row should be current');
});

test('memories table is created automatically', () => {
    cleanup();
    writeTimedFacts([
        { key: 'test.key', value: 'val', source: 'test', start_time: '2026-01-01T00:00:00Z', end_time: null },
    ]);
    run();
    // DB should exist and have the table
    const db = new Database(TEMP_DB, { readonly: true });
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
    db.close();
    assert.ok(tables.some(t => t.name === 'memories'), 'memories table should exist');
});

test('empty timed_facts produces no DB changes', () => {
    cleanup();
    fs.writeFileSync(TEMP_TIMED, '');
    const result = run();
    assert.match(result.stdout, /No timed facts/);
    assert.ok(!fs.existsSync(TEMP_DB), 'DB should not be created for empty input');
});

test('non-string values are JSON-stringified', () => {
    cleanup();
    writeTimedFacts([
        { key: 'config.debug', value: true, source: 'session:x', start_time: '2026-01-01T00:00:00Z', end_time: null },
        { key: 'config.ports', value: [8080, 3000], source: 'session:x', start_time: '2026-01-01T00:00:00Z', end_time: null },
    ]);
    run();
    const rows = queryDb('SELECT key, value FROM memories ORDER BY key');
    assert.equal(rows.find(r => r.key === 'config.debug').value, 'true');
    assert.equal(rows.find(r => r.key === 'config.ports').value, '[8080,3000]');
});
