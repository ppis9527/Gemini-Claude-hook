#!/usr/bin/env node
// CLI interface to memory.db for OpenClaw agents (via exec tool).
// Reuses the same DB and embed logic as the MCP server.
//
// Usage:
//   node memory-cli.js store <key> <value>
//   node memory-cli.js search --prefix <prefix>
//   node memory-cli.js search --query <text>
//   node memory-cli.js search --semantic <text>
//   node memory-cli.js search --key <key>
//   node memory-cli.js summary

const path = require('path');
const Database = require(path.join(__dirname, '..', 'src', 'node_modules', 'better-sqlite3'));
const { embedTexts, cosineSimilarity } = require(path.join(__dirname, '..', 'src', 'embed.js'));

const DB_PATH = path.join(__dirname, '..', 'memory.db');
const MAX_ROWS = 50;

function openDb(readonly = true) {
  return new Database(DB_PATH, { readonly });
}

async function cmdStore(key, value) {
  const db = openDb(false);
  const now = new Date().toISOString();

  const oldRow = db.prepare(
    'SELECT rowid, key, value FROM memories WHERE key = ? AND end_time IS NULL'
  ).get(key);

  if (oldRow) {
    db.prepare(
      "INSERT INTO memories_fts(memories_fts, rowid, key, value) VALUES('delete', ?, ?, ?)"
    ).run(oldRow.rowid, oldRow.key, oldRow.value);
  }

  db.prepare(
    'UPDATE memories SET end_time = ? WHERE key = ? AND end_time IS NULL'
  ).run(now, key);

  db.prepare(
    'INSERT INTO memories (key, value, source, start_time, end_time) VALUES (?, ?, ?, ?, NULL)'
  ).run(key, value, 'cli:memory_store', now);

  const newRow = db.prepare(
    'SELECT rowid FROM memories WHERE key = ? AND start_time = ?'
  ).get(key, now);

  if (newRow) {
    db.prepare(
      'INSERT INTO memories_fts(rowid, key, value) VALUES (?, ?, ?)'
    ).run(newRow.rowid, key, value);

    try {
      const [emb] = await embedTexts([`${key}: ${value}`]);
      const buf = Buffer.from(emb.buffer);
      db.prepare('UPDATE memories SET embedding = ? WHERE rowid = ?').run(buf, newRow.rowid);
    } catch {}
  }

  db.close();
  console.log(`Stored: ${key} = ${value}`);
}

async function cmdSearch(opts) {
  const db = openDb(true);
  let rows;

  if (opts.key) {
    rows = db.prepare(
      'SELECT key, value FROM memories WHERE end_time IS NULL AND key = ? ORDER BY start_time DESC LIMIT ?'
    ).all(opts.key, MAX_ROWS);
  } else if (opts.semantic) {
    const [queryEmb] = await embedTexts([opts.semantic]);
    const allRows = db.prepare(
      'SELECT key, value, embedding FROM memories WHERE embedding IS NOT NULL AND end_time IS NULL'
    ).all();
    const scored = [];
    for (const r of allRows) {
      const emb = new Float32Array(r.embedding.buffer, r.embedding.byteOffset, r.embedding.byteLength / 4);
      const sim = cosineSimilarity(queryEmb, emb);
      if (sim >= 0.3) scored.push({ key: r.key, value: r.value, sim });
    }
    scored.sort((a, b) => b.sim - a.sim);
    rows = scored.slice(0, MAX_ROWS);
  } else if (opts.query) {
    const safeQuery = opts.query.split(/\s+/).filter(Boolean).map(t => `"${t.replace(/"/g, '""')}"`).join(' ');
    rows = db.prepare(
      'SELECT m.key, m.value FROM memories m JOIN memories_fts fts ON m.rowid = fts.rowid WHERE memories_fts MATCH ? AND m.end_time IS NULL ORDER BY rank LIMIT ?'
    ).all(safeQuery, MAX_ROWS);
  } else if (opts.prefix) {
    rows = db.prepare(
      'SELECT key, value FROM memories WHERE end_time IS NULL AND key LIKE ? ORDER BY start_time DESC LIMIT ?'
    ).all(opts.prefix + '%', MAX_ROWS);
  } else {
    rows = db.prepare(
      'SELECT key, value FROM memories WHERE end_time IS NULL ORDER BY start_time DESC LIMIT ?'
    ).all(MAX_ROWS);
  }

  db.close();

  if (rows.length === 0) {
    console.log('No matching facts found.');
    return;
  }

  for (const r of rows) {
    const suffix = r.sim !== undefined ? ` (similarity: ${r.sim.toFixed(3)})` : '';
    console.log(`${r.key}: ${r.value}${suffix}`);
  }
}

function cmdSummary() {
  const db = openDb(true);
  const total = db.prepare('SELECT COUNT(*) as c FROM memories WHERE end_time IS NULL').get().c;
  const cats = db.prepare(
    "SELECT substr(key, 1, instr(key, '.') - 1) as cat, COUNT(*) as c FROM memories WHERE end_time IS NULL GROUP BY cat ORDER BY c DESC LIMIT 15"
  ).all();
  db.close();
  const catLine = cats.map(r => `${r.cat}(${r.c})`).join(' ');
  console.log(`[Memory | ${total} facts] ${catLine}`);
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);

  if (cmd === 'store') {
    const key = rest[0];
    const value = rest.slice(1).join(' ');
    if (!key || !value) { console.error('Usage: memory-cli.js store <key> <value>'); process.exit(1); }
    await cmdStore(key, value);
  } else if (cmd === 'search') {
    const opts = {};
    for (let i = 0; i < rest.length; i++) {
      if (rest[i] === '--prefix' && rest[i + 1]) { opts.prefix = rest[++i]; }
      else if (rest[i] === '--query' && rest[i + 1]) { opts.query = rest[++i]; }
      else if (rest[i] === '--semantic' && rest[i + 1]) { opts.semantic = rest[++i]; }
      else if (rest[i] === '--key' && rest[i + 1]) { opts.key = rest[++i]; }
    }
    await cmdSearch(opts);
  } else if (cmd === 'summary') {
    cmdSummary();
  } else {
    console.error('Usage:');
    console.error('  memory-cli.js store <key> <value>');
    console.error('  memory-cli.js search --prefix|--query|--semantic|--key <value>');
    console.error('  memory-cli.js summary');
    process.exit(1);
  }
}

main().catch(err => { console.error(err.message); process.exit(1); });
