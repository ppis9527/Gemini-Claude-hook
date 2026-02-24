/**
 * Tests for the read interface: query-memory.js
 *
 * Strategy: seed a temp DB, run 4-generate-digest.js to produce a temp digest,
 * then exercise query-memory.js in each mode and assert on stdout.
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const SRC_DIR      = path.join(__dirname, '..', 'src');
const DIGEST_SCRIPT = path.join(SRC_DIR, '4-generate-digest.js');
const QUERY_SCRIPT  = path.join(SRC_DIR, 'query-memory.js');
const DB_MODULE     = path.join(SRC_DIR, 'node_modules', 'better-sqlite3');
const Database      = require(DB_MODULE);

const TEMP_DB     = path.join(os.tmpdir(), `qmem-test-db-${process.pid}.db`);
const TEMP_DIGEST = path.join(os.tmpdir(), `qmem-test-digest-${process.pid}.json`);

const ENV = { ...process.env, MEMORY_DB_PATH: TEMP_DB, MEMORY_DIGEST_PATH: TEMP_DIGEST };

function run(extraArgs = []) {
    return spawnSync('node', [QUERY_SCRIPT, ...extraArgs], { encoding: 'utf8', env: ENV });
}

function seedAndDigest() {
    if (fs.existsSync(TEMP_DB)) fs.unlinkSync(TEMP_DB);
    if (fs.existsSync(TEMP_DIGEST)) fs.unlinkSync(TEMP_DIGEST);

    const db = new Database(TEMP_DB);
    db.exec(`
        CREATE TABLE IF NOT EXISTS memories (
            key TEXT NOT NULL, value TEXT, source TEXT,
            start_time TEXT NOT NULL, end_time TEXT,
            PRIMARY KEY (key, start_time)
        )
    `);
    const insert = db.prepare(
        'INSERT OR REPLACE INTO memories (key, value, source, start_time, end_time) VALUES (?, ?, ?, ?, ?)'
    );
    const facts = [
        { key: 'user.name',    value: '"Jerry"',   start_time: '2026-01-01T00:00:00Z' },
        { key: 'user.city',    value: '"Hsinchu"', start_time: '2026-01-01T00:00:00Z' },
        { key: 'user.lang',    value: '"zh-TW"',   start_time: '2026-01-01T00:00:00Z' },
        { key: 'project.name', value: '"OpenClaw"',start_time: '2026-01-01T00:00:00Z' },
    ];
    for (const f of facts) insert.run(f.key, f.value, 'raw_log', f.start_time, null);
    db.close();

    spawnSync('node', [DIGEST_SCRIPT], { encoding: 'utf8', env: ENV });
}

before(seedAndDigest);

after(() => {
    if (fs.existsSync(TEMP_DB))     fs.unlinkSync(TEMP_DB);
    if (fs.existsSync(TEMP_DIGEST)) fs.unlinkSync(TEMP_DIGEST);
});

// ── tests ─────────────────────────────────────────────────────────────────────

test('no args → L0 text output contains compact memory line', () => {
    const result = run();
    assert.equal(result.status, 0);
    assert.match(result.stdout, /\[Memory —/);
    assert.match(result.stdout, /facts\]/);
});

test('no args → output does not contain [Details] section', () => {
    const result = run();
    assert.doesNotMatch(result.stdout, /\[Details\]/);
});

test('--keys returns L0 + matching facts in [Details]', () => {
    const result = run(['--keys', 'user.name,user.city']);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /\[Details\]/);
    assert.match(result.stdout, /user\.name/);
    assert.match(result.stdout, /user\.city/);
    assert.doesNotMatch(result.stdout, /project\.name/, 'unrelated key should not appear');
});

test('--prefix filters by key prefix', () => {
    const result = run(['--prefix', 'user.']);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /user\.name/);
    assert.match(result.stdout, /user\.city/);
    assert.doesNotMatch(result.stdout, /project\.name/);
});

test('--prefix with non-matching prefix returns L0 only (no [Details])', () => {
    const result = run(['--prefix', 'nonexistent.']);
    assert.equal(result.status, 0);
    // No details section since no facts matched
    assert.doesNotMatch(result.stdout, /\[Details\]/);
});

test('--format json returns valid JSON with digest and facts fields', () => {
    const result = run(['--keys', 'user.name', '--format', 'json']);
    assert.equal(result.status, 0);
    const parsed = JSON.parse(result.stdout);
    assert.ok(parsed.digest, 'digest field required');
    assert.ok(Array.isArray(parsed.facts), 'facts must be an array');
    assert.equal(parsed.facts[0].key, 'user.name');
    assert.equal(parsed.facts[0].value, 'Jerry');
});

test('--limit caps the number of L1 facts returned', () => {
    const result = run(['--prefix', 'user.', '--limit', '1']);
    assert.equal(result.status, 0);
    const detailsSection = result.stdout.split('[Details]')[1] || '';
    const lines = detailsSection.trim().split('\n').filter(l => l.trim());
    assert.equal(lines.length, 1, 'only 1 fact should be returned');
});
