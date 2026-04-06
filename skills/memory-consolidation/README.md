# Memory Consolidation System

A persistent memory system for AI agents. Extracts facts from conversation sessions via LLM, stores them in SQLite with semantic embeddings, and provides multiple access interfaces (MCP server, CLI, hooks).

Built for [OpenClaw](https://openclaw.ai/), also works with Claude Code and Gemini CLI.

**Current stats (2026-04-05):** 32,389 entries · 344.8 MB · 4,398 instincts · 85.7% embedding coverage

## Architecture

```
Session Sources
  Claude Code (JSONL)  │  Gemini CLI (JSON)  │  TG Bots (貳俠/小序)
         │                      │
         ▼                      ▼
  PreCompact Hook        daily-gemini-sync.sh (every 12h)
         │                      │
         └──────────┬───────────┘
                    ▼
              run_pipeline.sh
         ┌──────────────────────┐
         │  [1] extract-facts   │  ← Gemini 2.5-flash-lite
         │  [1.5] agent-learn   │  ← rule-based (no API)
         │  [2] align-temporal  │
         │  [3] commit + dedup  │  ← LLM dedup (flash-lite)
         │  [4] gen-digest      │
         │  [5] embed-facts     │  ← gemini-embedding-001 (3072-dim)
         └──────────┬───────────┘
                    ▼
              memory.db (SQLite)
         ┌──────────┼───────────┐
         ▼          ▼           ▼
    MCP Server     CLI    SessionStart Hook
   (Claude/Gemini) (shell) (digest + instincts)

instinct-cli.js extract --store  (every 6h)
  agent.case.* + agent.pattern.* → agent.instinct.*
```

## Components

| Component | Path | Description |
|---|---|---|
| **Pipeline** | `run_pipeline.sh` | 5-step batch processing |
| **MCP Server** | `mcp/server.mjs` | Model Context Protocol server for Claude Code & Gemini CLI |
| **CLI** | `cli/memory-cli.js` | Command-line interface |
| **Instinct CLI** | `cli/instinct-cli.js` | Manage learned behavioral rules |
| **SessionStart Hook** | `src/query-memory.js` | Injects memory summary + instincts at session start |
| **PreCompact Hook** | `hooks/pre-compact-extract.js` | Extracts facts before `/compact` |
| **Gemini Extract** | `src/gemini-session-extract.js` | SessionEnd/PreCompress hook for Gemini CLI |
| **Token Monitor** | `hooks/gemini/token-monitor.js` | AfterModel hook — proactive extraction at 65% context usage |

## Quick Start

```bash
cd src && npm install
cd ../mcp && npm install
```

### Run the pipeline

```bash
# Process a single session
./run_pipeline.sh <session.jsonl>

# Backfill a directory of sessions
./run_pipeline.sh --backfill <directory>

# Ingest Gemini CLI sessions
./run_pipeline.sh --gemini
```

### Query memory

```bash
# MCP (Claude Code / Gemini CLI)
memory_summary()
memory_search({ prefix: "user." })
memory_search({ semantic: "database config" })
memory_store({ key: "error.config.x", value: "..." })

# CLI
node cli/memory-cli.js summary
node cli/memory-cli.js search --prefix "error."
node cli/memory-cli.js search --semantic "database config"
node cli/memory-cli.js store "error.config.x" "description"
```

## Pipeline Steps

Runs on every `/compact` (PreCompact hook) and every 12 hours (Gemini sessions).

| Step | Script | Description | Cost |
|---|---|---|---|
| 1 | `src/1-extract-facts.js` | Extract facts via Gemini 2.5-flash-lite | ~500 tokens |
| 1.5 | `src/extract-agent-learnings.js` | Rule-based case/pattern extraction (direct to DB) | 0 |
| 2 | `src/2-align-temporally.js` | Temporal alignment (relative → absolute dates) | 0 |
| 3 | `src/3-commit-to-db.js` | SQLite upsert + LLM dedup (cosine > 0.85 pre-filter) | ~100 tokens |
| 4 | `src/4-generate-digest.js` | Generate `memory_digest.json` | 0 |
| 5 | `src/5-embed-facts.js` | Gemini `embedding-001` vectors (3072-dim, incremental) | ~100 tokens |

### Cron Schedule

```bash
# Every 12 hours: Gemini CLI session ingestion
0 */12 * * * bash src/daily-gemini-sync.sh

# Every 6 hours: instinct extraction from cases/patterns
30 */6 * * * node cli/instinct-cli.js extract --store

# Weekly: agent entry pruning (Sunday 3am)
0 3 * * 0  # agent.case.* >30d + access_count<2 → delete
           # agent.pattern.* >60d + access_count<2 → delete
```

## Instincts

Behavioral rules derived from repeated observations. Injected at SessionStart (confidence ≥ 60%).

```
agent.instinct.<domain>.<id>
```

Domains: `error`, `workflow`, `tool`, `coding`, `testing`

### Confidence Scoring

| Evidence count | Confidence |
|---|---|
| ≥10 | 90% |
| ≥7 | 80% |
| ≥5 | 70% |
| ≥3 | 60% |
| ≥2 | 50% |
| 1 | 40% |

### Instinct CLI

```bash
node cli/instinct-cli.js list
node cli/instinct-cli.js list --domain error
node cli/instinct-cli.js show agent.instinct.error.test_failure
node cli/instinct-cli.js extract --store
node cli/instinct-cli.js stats
```

## MCP Server

| Tool | Description |
|---|---|
| `memory_summary` | Hierarchical category overview |
| `memory_search` | Hybrid search: exact key / prefix / FTS5 / semantic vector |
| `memory_store` | Store/update a fact |

**Registration:**
```bash
# Claude Code
claude mcp add -s user memory node /path/to/mcp/server.mjs

# Gemini CLI — add to ~/.gemini/settings.json mcpServers section
```

## Hybrid Search (RRF: Vector + FTS5)

Reciprocal Rank Fusion combining semantic vectors and keyword matching:

| Method | Finds | Example |
|---|---|---|
| **Vector** | Semantically similar | "editor" → finds "VSCode", "IDE" |
| **FTS5 (BM25)** | Exact keywords | "GOG_KEYRING_PASSWORD" → exact match |

Formula: `score = 1/(rank_v + k) + 1/(rank_fts + k)`, k=60

## Database Schema

```sql
CREATE TABLE memories (
    key           TEXT PRIMARY KEY,
    value         TEXT NOT NULL,
    source        TEXT,
    start_time    TEXT,   -- ISO 8601
    end_time      TEXT,   -- NULL = active
    access_count  INTEGER DEFAULT 0,
    last_accessed TEXT,
    embedding     BLOB    -- Float32Array, 3072-dim
);
```

**Key prefix distribution:**

| Prefix | % | Description |
|---|---|---|
| `agent.*` | 60% | Cases, patterns, instincts |
| `claude.*` | 15% | Claude session facts |
| `task.*` | 8% | Task state |
| `user.*` | 2% | User identity/preferences |
| `project.*` | 2% | Project decisions |
| Other | 13% | config, entity, event, error, etc. |

## Hooks

### PreCompact Hook (`hooks/pre-compact-extract.js`)

Extracts facts before every `/compact` to prevent context loss. Also counts tool calls — if ≥15, stores a nudge that reminds the agent to check memory next session.

### Gemini CLI Real-time Extraction

`src/gemini-session-extract.js` hooks into SessionEnd and PreCompress events for real-time extraction without waiting for the 12h cron.

### Token Monitor (AfterModel Hook)

Monitors `promptTokenCount` — triggers background extraction at 65% of 128K context window. 3-layer anti-OOM: RAM check (500MB min), lock file (singleton), Node heap cap.

## Directory Structure

```
memory-consolidation/
├── run_pipeline.sh              # Pipeline entry point (steps 1-5)
├── digest-config.json           # Dedup + display config
├── src/
│   ├── 1-extract-facts.js
│   ├── 2-align-temporally.js
│   ├── 3-commit-to-db.js
│   ├── 4-generate-digest.js
│   ├── 5-embed-facts.js
│   ├── extract-agent-learnings.js  # Step 1.5: rule-based cases/patterns
│   ├── extract-instincts.js        # Instinct aggregation
│   ├── embed.js                    # Gemini + Vertex AI embedding
│   ├── hybrid-search.js            # Vector + FTS5 RRF
│   ├── dedup-decision.js           # LLM dedup judgment
│   ├── query-memory.js             # SessionStart injection
│   ├── noise-filter.js             # Low-value fact filtering
│   ├── convert-gemini-sessions.js  # Gemini CLI → JSONL
│   ├── gemini-session-extract.js   # Gemini SessionEnd/PreCompress hook
│   ├── gemini-precompress-snapshot.js
│   └── daily-gemini-sync.sh        # Cron: Gemini sync
├── cli/
│   ├── memory-cli.js               # Shell CLI
│   └── instinct-cli.js             # Instinct management
├── mcp/
│   ├── server.mjs                  # MCP server
│   └── package.json
├── hooks/
│   └── gemini/
│       ├── token-monitor.js
│       └── token-monitor-worker.js
├── docs/
│   └── superpowers/specs/          # Design documents
├── memory.db                        # SQLite (gitignored)
├── memory_digest.json               # Cached digest (gitignored)
├── staging/                         # PreCompact snapshots (gitignored)
└── .processed_sessions              # Session tracking (gitignored)
```

## Requirements

- Node.js >= 18
- `better-sqlite3` (npm in `src/`)
- `@modelcontextprotocol/sdk`, `zod` (npm in `mcp/`)
- Gemini API key (`GOOGLE_API_KEY`) or `gcloud` CLI (Vertex AI fallback)

## Changelog

### v2.9.0 (2026-04-05)

- **Removed pipeline steps 6-8**: daily-log, weekly-consolidation, rolling-topics — unused in practice
- **Removed evolve-instructions.js**: redundant with instinct-cli, file had grown to 65K lines with no pruning
- **Added weekly agent entry pruning**: `agent.case.*` >30d + `access_count<2` deleted; patterns >60d
- **Added design docs**: `docs/superpowers/specs/` with Mermaid architecture diagrams (Obsidian format)
- **DB maintenance**: VACUUM after pruning (361 MB → 345 MB), backfilled 332 missing embeddings
- **Cleaned staging/**: 2,253 → 365 files (208 MB → 113 MB)

### v2.8.0 (2026-03-12)

- **RRF Hybrid Search**: Reciprocal Rank Fusion (Vector + FTS5), formula `1/(rank+k)`, k=60
- **Skill Synthesis**: `src/synthesize-skills.js` — auto-generates SKILL.md from instincts
- **Nudge Mechanism**: PreCompact counts tool calls; ≥15 → stores `system.nudge.pending`
- **PreCompact Extraction**: extract facts before `/compact`

### v2.7.0 (2026-02-27)

- **Token Monitor**: AfterModel hook monitors promptTokenCount (65% threshold), forks detached background worker
- 3-layer anti-OOM: RAM check, lock file, Node heap cap
- **PreCompress snapshot**: lightweight snapshot hook (`gemini-precompress-snapshot.js`)

### v2.6.0 (2026-02-25)

- **Noise Filter**: filters boilerplate, agent denials, meta-questions (~30-50% token reduction)
- **Hybrid Search**: Vector + BM25 weighted fusion

### v2.5.0 (2026-02-25)

- **Gemini CLI real-time extraction**: SessionEnd + PreCompress hooks

### v2.4.0 (2026-02-25)

- **Instincts**: behavioral rules from cases/patterns, injected at SessionStart (confidence ≥60%)
- `cli/instinct-cli.js`, cron every 6h

### v2.3.0 (2026-02-23)

- Added steps 6-8: daily logs, weekly snapshots, rolling topics *(removed in v2.9.0)*

### v2.2.0 (2026-02-21)

- Added `mcp/`, `cli/`, Gemini CLI ingestion (`--gemini` mode)

### v2.1.0 (2026-02-20)

- Step 5: semantic embedding via Gemini embedding-001

### v2.0.0 (2026-02-20)

- Steps 1-3: extract, align, commit. Session dedup, backfill mode.

### v1.0.0 (2026-02-19)

- Initial release: digest generation + query interface
