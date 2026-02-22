/**
 * Tests for Step 2: Temporal Alignment (2-align-temporally.js)
 *
 * Strategy: write a temp facts.jsonl, run the script via spawnSync with
 * FACTS_FILE + TIMED_FACTS_FILE pointing to temp paths, assert on output.
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const SRC_DIR = path.join(__dirname, '..', 'src');
const SCRIPT  = path.join(SRC_DIR, '2-align-temporally.js');

const TEMP_FACTS = path.join(os.tmpdir(), `align-test-facts-${process.pid}.jsonl`);
const TEMP_TIMED = path.join(os.tmpdir(), `align-test-timed-${process.pid}.jsonl`);

function run() {
    const result = spawnSync('node', [SCRIPT], {
        encoding: 'utf8',
        env: { ...process.env, FACTS_FILE: TEMP_FACTS, TIMED_FACTS_FILE: TEMP_TIMED },
    });
    if (result.status !== 0) throw new Error(`Script failed: ${result.stderr}`);
    return result;
}

function writeFacts(facts) {
    fs.writeFileSync(TEMP_FACTS, facts.map(f => JSON.stringify(f)).join('\n') + '\n');
}

function readTimedFacts() {
    const lines = fs.readFileSync(TEMP_TIMED, 'utf8').split('\n').filter(Boolean);
    return lines.map(l => JSON.parse(l));
}

function cleanup() {
    if (fs.existsSync(TEMP_FACTS)) fs.unlinkSync(TEMP_FACTS);
    if (fs.existsSync(TEMP_TIMED)) fs.unlinkSync(TEMP_TIMED);
}

before(cleanup);
after(cleanup);

// ── tests ─────────────────────────────────────────────────────────────────────

test('single fact gets start_time and null end_time', () => {
    cleanup();
    writeFacts([
        { key: 'user.name', value: 'Jerry', source: 'session:abc', message_timestamp: '2026-01-01T10:00:00Z' },
    ]);
    run();
    const result = readTimedFacts();
    assert.equal(result.length, 1);
    assert.equal(result[0].key, 'user.name');
    assert.equal(result[0].value, 'Jerry');
    assert.equal(result[0].start_time, '2026-01-01T10:00:00Z');
    assert.equal(result[0].end_time, null);
});

test('duplicate key+value is deduplicated (keeps earliest)', () => {
    cleanup();
    writeFacts([
        { key: 'user.name', value: 'Jerry', source: 'session:abc', message_timestamp: '2026-01-01T10:00:00Z' },
        { key: 'user.name', value: 'Jerry', source: 'session:def', message_timestamp: '2026-01-02T10:00:00Z' },
    ]);
    run();
    const result = readTimedFacts();
    assert.equal(result.length, 1, 'duplicate should be removed');
    assert.equal(result[0].start_time, '2026-01-01T10:00:00Z', 'earliest kept');
    assert.equal(result[0].end_time, null);
});

test('same key, different values → old gets end_time, new gets null', () => {
    cleanup();
    writeFacts([
        { key: 'user.city', value: 'Taipei', source: 'session:abc', message_timestamp: '2026-01-01T10:00:00Z' },
        { key: 'user.city', value: 'Hsinchu', source: 'session:def', message_timestamp: '2026-01-02T10:00:00Z' },
    ]);
    run();
    const result = readTimedFacts();
    assert.equal(result.length, 2);

    const taipei = result.find(f => f.value === 'Taipei');
    const hsinchu = result.find(f => f.value === 'Hsinchu');
    assert.ok(taipei, 'Taipei fact should exist');
    assert.ok(hsinchu, 'Hsinchu fact should exist');

    assert.equal(taipei.end_time, '2026-01-02T10:00:00Z', 'old value closed by new');
    assert.equal(hsinchu.end_time, null, 'latest value is current');
});

test('different keys are independent', () => {
    cleanup();
    writeFacts([
        { key: 'user.name', value: 'Jerry', source: 'session:abc', message_timestamp: '2026-01-01T10:00:00Z' },
        { key: 'project.name', value: 'OpenClaw', source: 'session:abc', message_timestamp: '2026-01-01T10:00:00Z' },
    ]);
    run();
    const result = readTimedFacts();
    assert.equal(result.length, 2);
    assert.ok(result.every(f => f.end_time === null), 'both should be current');
});

test('empty facts file produces empty output', () => {
    cleanup();
    fs.writeFileSync(TEMP_FACTS, '');
    run();
    const content = fs.readFileSync(TEMP_TIMED, 'utf8').trim();
    assert.equal(content, '', 'output should be empty');
});

test('three value changes create proper chain', () => {
    cleanup();
    writeFacts([
        { key: 'user.city', value: 'Taipei', source: 'session:a', message_timestamp: '2026-01-01T10:00:00Z' },
        { key: 'user.city', value: 'Hsinchu', source: 'session:b', message_timestamp: '2026-01-02T10:00:00Z' },
        { key: 'user.city', value: 'Kaohsiung', source: 'session:c', message_timestamp: '2026-01-03T10:00:00Z' },
    ]);
    run();
    const result = readTimedFacts();
    assert.equal(result.length, 3);

    // Sort by start_time for predictable ordering
    result.sort((a, b) => a.start_time.localeCompare(b.start_time));

    assert.equal(result[0].value, 'Taipei');
    assert.equal(result[0].end_time, '2026-01-02T10:00:00Z');

    assert.equal(result[1].value, 'Hsinchu');
    assert.equal(result[1].end_time, '2026-01-03T10:00:00Z');

    assert.equal(result[2].value, 'Kaohsiung');
    assert.equal(result[2].end_time, null);
});
