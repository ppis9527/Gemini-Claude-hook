/**
 * Tests for Phase 4: Digest Generator (4-generate-digest.js)
 *
 * Strategy: seed a temp DB directly with better-sqlite3, run the script via
 * spawnSync with MEMORY_DB_PATH + MEMORY_DIGEST_PATH pointing to temp paths,
 * then assert on the resulting memory_digest.json.
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const SRC_DIR   = path.join(__dirname, '..', 'src');
const SCRIPT    = path.join(SRC_DIR, '4-generate-digest.js');
const DB_MODULE = path.join(SRC_DIR, 'node_modules', 'better-sqlite3');
const Database  = require(DB_MODULE);

const TEMP_DB     = path.join(os.tmpdir(), `digest-test-db-${process.pid}.db`);
const TEMP_DIGEST = path.join(os.tmpdir(), `digest-test-out-${process.pid}.json`);

function runScript() {
    const result = spawnSync('node', [SCRIPT], {
        encoding: 'utf8',
        env: { ...process.env, MEMORY_DB_PATH: TEMP_DB, MEMORY_DIGEST_PATH: TEMP_DIGEST },
    });
    if (result.status !== 0) throw new Error(`Script failed: ${result.stderr}`);
}

function seedDb(facts) {
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
    for (const f of facts) insert.run(f.key, f.value, f.source, f.start_time, f.end_time ?? null);
    db.close();
}

function readDigest() {
    return JSON.parse(fs.readFileSync(TEMP_DIGEST, 'utf8'));
}

before(() => {
    if (fs.existsSync(TEMP_DB))     fs.unlinkSync(TEMP_DB);
    if (fs.existsSync(TEMP_DIGEST)) fs.unlinkSync(TEMP_DIGEST);
});

after(() => {
    if (fs.existsSync(TEMP_DB))     fs.unlinkSync(TEMP_DB);
    if (fs.existsSync(TEMP_DIGEST)) fs.unlinkSync(TEMP_DIGEST);
});

// ── tests ─────────────────────────────────────────────────────────────────────

test('digest has required top-level fields', () => {
    if (fs.existsSync(TEMP_DB)) fs.unlinkSync(TEMP_DB);
    seedDb([{ key: 'user.name', value: '"Alice"', source: 'raw_log', start_time: '2026-01-01T00:00:00Z' }]);
    runScript();
    const d = readDigest();
    assert.ok(d.generated_at, 'generated_at required');
    assert.equal(typeof d.total_facts, 'number');
    assert.equal(typeof d.summary, 'string');
    assert.equal(typeof d.categories, 'object');
});

test('only current facts (end_time IS NULL) are counted', () => {
    if (fs.existsSync(TEMP_DB)) fs.unlinkSync(TEMP_DB);
    seedDb([
        { key: 'user.city', value: '"Taipei"',  source: 'raw_log', start_time: '2026-01-01T10:00:00Z', end_time: '2026-01-01T15:00:00Z' },
        { key: 'user.city', value: '"Hsinchu"', source: 'raw_log', start_time: '2026-01-01T15:00:00Z' },
    ]);
    runScript();
    const d = readDigest();
    assert.equal(d.total_facts, 1, 'only the current (null end_time) fact counted');
    assert.equal(d.categories['user'].count, 1);
});

test('facts are grouped by key prefix', () => {
    if (fs.existsSync(TEMP_DB)) fs.unlinkSync(TEMP_DB);
    seedDb([
        { key: 'user.name',        value: '"Alice"', source: 'raw_log', start_time: '2026-01-01T00:00:00Z' },
        { key: 'user.city',        value: '"Taipei"', source: 'raw_log', start_time: '2026-01-01T00:00:00Z' },
        { key: 'project.name',     value: '"OpenClaw"', source: 'raw_log', start_time: '2026-01-01T00:00:00Z' },
    ]);
    runScript();
    const d = readDigest();
    assert.equal(d.categories['user'].count, 2);
    assert.equal(d.categories['project'].count, 1);
    assert.equal(d.total_facts, 3);
});

test('top facts appear inside each category', () => {
    if (fs.existsSync(TEMP_DB)) fs.unlinkSync(TEMP_DB);
    seedDb([
        { key: 'user.name', value: '"Jerry"', source: 'raw_log', start_time: '2026-01-01T00:00:00Z' },
    ]);
    runScript();
    const d = readDigest();
    const userFacts = d.categories['user'].facts;
    assert.ok('user.name' in userFacts, 'user.name should appear in top facts');
    assert.equal(userFacts['user.name'], 'Jerry');
});

test('empty DB produces digest with zero facts', () => {
    if (fs.existsSync(TEMP_DB)) fs.unlinkSync(TEMP_DB);
    seedDb([]);
    runScript();
    const d = readDigest();
    assert.equal(d.total_facts, 0);
    assert.deepEqual(d.categories, {});
});
