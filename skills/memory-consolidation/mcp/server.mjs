import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// better-sqlite3 is a native module that needs require()
const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { embedTexts, cosineSimilarity } = require(
  path.join(__dirname, "..", "src", "embed.js")
);
const { applyVerdict } = require(
  path.join(__dirname, "..", "src", "verdict.js")
);
const { hybridSearch } = require(
  path.join(__dirname, "..", "src", "hybrid-search.js")
);
const DB_PATH = path.join(__dirname, "..", "memory.db");
const DIGEST_PATH = path.join(__dirname, "..", "memory_digest.json");
const CONFIG_PATH = path.join(__dirname, "..", "digest-config.json");

function openDb(readonly = true) {
  return new Database(DB_PATH, { readonly });
}

function loadConfig() {
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
  } catch {
    return { min_count_for_l0: 5, max_categories_in_l0: 15 };
  }
}

function loadDigest() {
  try {
    return JSON.parse(readFileSync(DIGEST_PATH, "utf8"));
  } catch {
    return null;
  }
}

// ── MCP Server ──────────────────────────────────────────────────────────────

const server = new McpServer({
  name: "memory",
  version: "1.0.0",
});

// ── Tool: memory_summary ────────────────────────────────────────────────────

server.registerTool(
  "memory_summary",
  {
    description:
      "Get a compact one-line summary of the memory database — total fact count and top categories by frequency.",
    inputSchema: {},
  },
  async () => {
    const digest = loadDigest();
    if (!digest) {
      return {
        content: [{ type: "text", text: "[Memory — digest not available, run pipeline first]" }],
      };
    }

    const config = loadConfig();
    const minCount = config.min_count_for_l0 || 5;
    const maxCats = config.max_categories_in_l0 || 15;

    const filtered = Object.entries(digest.categories)
      .filter(([, v]) => v.count >= minCount)
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, maxCats);

    const totalFacts = filtered.reduce((sum, [, v]) => sum + v.count, 0);
    const catLine = filtered.map(([k, v]) => `${k}(${v.count})`).join(" ");
    const summary = `[Memory — ${digest.generated_at.slice(0, 10)} | ${totalFacts} facts] ${catLine}`;

    return { content: [{ type: "text", text: summary }] };
  }
);

// ── Tool: memory_search ─────────────────────────────────────────────────────

server.registerTool(
  "memory_search",
  {
    description:
      "Search memory facts. Filter by category prefix (e.g. 'user.'), specific keys, full-text query, semantic meaning, or list all. Priority: keys > semantic > query > prefix > all.",
    inputSchema: {
      prefix: z.string().optional().describe("Category prefix to filter by, e.g. 'user.' or 'project.'"),
      keys: z.array(z.string()).optional().describe("Specific dot-notation keys to fetch, e.g. ['user.name', 'user.language']"),
      semantic: z.string().optional().describe("Semantic search — find facts by meaning, not exact words (e.g. 'editor' finds 'user.ide: vscode')"),
      query: z.string().optional().describe("Full-text search across keys and values (FTS5)"),
      limit: z.number().int().min(1).max(500).optional().describe("Max results to return (default 50)"),
      // Four-Step Verdict parameters
      sourceVerified: z.boolean().optional().describe("Exclude inferred.* keys (only return user-stated facts)"),
      subject: z.string().optional().describe("Filter by subject (key must include this string)"),
      maxAgeDays: z.number().optional().describe("Filter by age (only return facts from last N days)"),
      // Type filtering (uses type_mappings from config)
      type: z.enum(["fact", "pref", "entity", "event", "agent", "inferred", "error", "all"]).optional().describe("Filter by memory type: fact, pref, entity, event, agent, inferred, error, or all"),
    },
  },
  async ({ prefix, keys, semantic, query, limit, sourceVerified, subject, maxAgeDays, type }) => {
    const db = openDb(true);
    const maxRows = limit || 50;
    let rows;

    if (keys && keys.length > 0) {
      const placeholders = keys.map(() => "?").join(",");
      rows = db
        .prepare(
          `SELECT key, value, start_time FROM memories
           WHERE end_time IS NULL AND key IN (${placeholders})
           ORDER BY start_time DESC
           LIMIT ?`
        )
        .all(...keys, maxRows);
    } else if (semantic) {
      // Hybrid search: combine vector similarity + BM25 (FTS5)
      const [queryEmb] = await embedTexts([semantic]);
      const hybridResults = hybridSearch(db, semantic, queryEmb, { limit: maxRows });
      rows = hybridResults.map(r => ({
        key: r.key,
        value: r.value,
        start_time: r.start_time,
        similarity: r.score,
        bm25Hit: r.bm25Hit,
      }));
    } else if (query) {
      // Quote each token to prevent FTS5 syntax errors (e.g. "-" as NOT operator)
      const safeQuery = query
        .split(/\s+/)
        .filter(Boolean)
        .map((t) => `"${t.replace(/"/g, '""')}"`)
        .join(" ");
      rows = db
        .prepare(
          `SELECT m.key, m.value, m.start_time
           FROM memories m
           JOIN memories_fts fts ON m.rowid = fts.rowid
           WHERE memories_fts MATCH ? AND m.end_time IS NULL
           ORDER BY rank
           LIMIT ?`
        )
        .all(safeQuery, maxRows);
    } else if (prefix) {
      rows = db
        .prepare(
          `SELECT key, value, start_time FROM memories
           WHERE end_time IS NULL AND key LIKE ?
           ORDER BY start_time DESC
           LIMIT ?`
        )
        .all(prefix + "%", maxRows);
    } else {
      rows = db
        .prepare(
          `SELECT key, value, start_time FROM memories
           WHERE end_time IS NULL
           ORDER BY start_time DESC
           LIMIT ?`
        )
        .all(maxRows);
    }

    db.close();

    // Apply Four-Step Verdict filtering
    if (sourceVerified || subject || maxAgeDays) {
      rows = applyVerdict(rows, { sourceVerified, subject, maxAgeDays });
    }

    // Apply type filtering using type_mappings from config
    if (type && type !== "all") {
      const config = loadConfig();
      const typeMappings = config.type_mappings || {};
      const prefixes = typeMappings[type] || [];
      if (prefixes.length > 0) {
        rows = rows.filter(r => prefixes.some(p => r.key && r.key.startsWith(p)));
      }
    }

    if (rows.length === 0) {
      return { content: [{ type: "text", text: "No matching facts found." }] };
    }

    const text = rows
      .map((r) => {
        if (r.similarity !== undefined) {
          const bm25Tag = r.bm25Hit ? " +bm25" : "";
          return `${r.key}: ${r.value} (score: ${r.similarity.toFixed(3)}${bm25Tag})`;
        }
        return `${r.key}: ${r.value}`;
      })
      .join("\n");
    return { content: [{ type: "text", text }] };
  }
);

// ── Tool: memory_store ──────────────────────────────────────────────────────

server.registerTool(
  "memory_store",
  {
    description:
      "Store or update a memory fact. Key should use dot-notation (e.g. 'user.name', 'project.stack'). Existing active facts with the same key will be closed (end_time set).",
    inputSchema: {
      key: z.string().min(1).describe("Dot-notation key, e.g. 'user.preferred_editor'"),
      value: z.string().min(1).describe("The value to store"),
    },
  },
  async ({ key, value }) => {
    const db = openDb(false);
    const now = new Date().toISOString();

    // Find existing active fact for FTS cleanup
    const oldRow = db.prepare(
      `SELECT rowid, key, value FROM memories WHERE key = ? AND end_time IS NULL`
    ).get(key);

    if (oldRow) {
      // Remove old entry from FTS index
      db.prepare(
        "INSERT INTO memories_fts(memories_fts, rowid, key, value) VALUES('delete', ?, ?, ?)"
      ).run(oldRow.rowid, oldRow.key, oldRow.value);
    }

    // Close any existing active fact with the same key
    db.prepare(
      `UPDATE memories SET end_time = ? WHERE key = ? AND end_time IS NULL`
    ).run(now, key);

    // Insert the new fact
    db.prepare(
      `INSERT INTO memories (key, value, source, start_time, end_time)
       VALUES (?, ?, ?, ?, NULL)`
    ).run(key, value, "mcp:memory_store", now);

    // Add new entry to FTS index
    const newRow = db.prepare(
      `SELECT rowid FROM memories WHERE key = ? AND start_time = ?`
    ).get(key, now);
    if (newRow) {
      db.prepare(
        `INSERT INTO memories_fts(rowid, key, value) VALUES (?, ?, ?)`
      ).run(newRow.rowid, key, value);
    }

    // Auto-embed the new fact
    try {
      const [emb] = await embedTexts([`${key}: ${value}`]);
      const buf = Buffer.from(emb.buffer);
      db.prepare(`UPDATE memories SET embedding = ? WHERE rowid = ?`).run(
        buf,
        newRow.rowid
      );
    } catch (err) {
      console.error("Auto-embed failed (non-fatal):", err.message);
    }

    db.close();

    return {
      content: [{ type: "text", text: `Stored: ${key} = ${value}` }],
    };
  }
);

// ── Start ───────────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Memory MCP Server running on stdio");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
