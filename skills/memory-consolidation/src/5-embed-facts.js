#!/usr/bin/env node
/**
 * Step 5: Backfill embeddings for facts that have none.
 *
 * Queries all active facts with embedding IS NULL, batch-embeds via
 * Gemini embedding-001, and writes the Float32Array BLOBs back to DB.
 *
 * Safe to re-run — only processes rows where embedding IS NULL.
 */

const Database = require("better-sqlite3");
const path = require("path");
const { embedTexts } = require("./embed");
const { ensureTable } = require("./3-commit-to-db");

const DB_PATH =
  process.env.MEMORY_DB_PATH || path.join(__dirname, "..", "memory.db");

async function main() {
  const db = new Database(DB_PATH);
  ensureTable(db);

  const rows = db
    .prepare(
      `SELECT rowid, key, value FROM memories
       WHERE embedding IS NULL AND end_time IS NULL`
    )
    .all();

  if (rows.length === 0) {
    console.log("All active facts already have embeddings.");
    db.close();
    return;
  }

  console.log(`Embedding ${rows.length} facts...`);

  const texts = rows.map((r) => `${r.key}: ${r.value}`);
  const embeddings = await embedTexts(texts);

  const update = db.prepare(
    `UPDATE memories SET embedding = ? WHERE rowid = ?`
  );

  const run = db.transaction(() => {
    for (let i = 0; i < rows.length; i++) {
      const buf = Buffer.from(embeddings[i].buffer);
      update.run(buf, rows[i].rowid);
    }
  });
  run();

  db.close();
  console.log(`Done — embedded ${rows.length} facts.`);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
