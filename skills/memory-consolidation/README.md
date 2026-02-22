# Memory Consolidation System

A persistent memory system for AI agents. Extracts facts from conversation sessions via LLM, stores them in SQLite with semantic embeddings, and provides multiple access interfaces (MCP server, CLI, hooks).

Built for [OpenClaw](https://openclaw.ai/), also works with Claude Code and Gemini CLI.

## Architecture

```
                          ┌──────────────────────────────┐
                          │       Session Sources         │
                          │  OpenClaw JSONL  │ Gemini JSON│
                          └────────┬─────────┬───────────┘
                                   │         │
                          ┌────────▼─────────▼───────────┐
                          │      Pipeline (5 steps)       │
                          │                               │
                          │  1. Extract facts (Gemini LLM)│
                          │  2. Temporal alignment        │
                          │  3. Commit to SQLite          │
                          │  4. Generate digest           │
                          │  5. Embed (Gemini embedding)  │
                          └────────────┬──────────────────┘
                                       │
                                       ▼
                              ┌─────────────────┐
                              │   memory.db      │
                              │  SQLite + FTS5   │
                              │  + embeddings    │
                              └──┬──────┬──────┬─┘
                                 │      │      │
                    ┌────────────▼┐  ┌──▼───┐  ┌▼────────────┐
                    │  MCP Server  │  │ CLI  │  │ Hook inject │
                    │ (Claude Code │  │(Open │  │(SessionStart│
                    │  Gemini CLI) │  │ Claw)│  │  summary)   │
                    └──────────────┘  └──────┘  └─────────────┘
```

## Components

| Component | Path | Description |
|---|---|---|
| **Pipeline** | `run_pipeline.sh` | 5-step batch processing of sessions into facts |
| **MCP Server** | `mcp/server.mjs` | Model Context Protocol server for Claude Code & Gemini CLI |
| **CLI** | `cli/memory-cli.js` | Command-line interface for OpenClaw agents (via `exec`) |
| **Hook** | `src/query-memory.js` | SessionStart hook that injects memory summary |

## Quick Start

### Install dependencies

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

# CLI (OpenClaw agents)
node cli/memory-cli.js summary
node cli/memory-cli.js search --prefix "error."
node cli/memory-cli.js search --semantic "database config"
node cli/memory-cli.js search --query "keyword"
node cli/memory-cli.js search --key "user.name"
node cli/memory-cli.js store "error.config.x" "description of what happened"
```

## Pipeline Steps

| Step | Script | Description |
|---|---|---|
| 1 | `src/1-extract-facts.js` | Extract facts from session JSONL via Gemini 2.5-flash-lite |
| 2 | `src/2-align-temporally.js` | Temporal alignment, dedup same key+value |
| 3 | `src/3-commit-to-db.js` | SQLite upsert with start_time/end_time lifecycle |
| 4 | `src/4-generate-digest.js` | Generate memory_digest.json and MEMORY.md |
| 5 | `src/5-embed-facts.js` | Generate Gemini embedding-001 vectors (3072-dim) |

### Idempotency

`.processed_sessions` tracks which sessions have been extracted. Prefixes prevent ID collisions:
- OpenClaw sessions: UUID (e.g. `2c4bc907-1870-...`)
- Gemini sessions: `gemini:` prefix (e.g. `gemini:1a237a8d-...`)

### Session Conversion

`src/convert-gemini-sessions.js` converts Gemini CLI JSON sessions (`~/.gemini/tmp/*/chats/session-*.json`) to pipeline-compatible JSONL format.

## MCP Server

Provides 3 tools via Model Context Protocol (stdio transport):

| Tool | Description |
|---|---|
| `memory_summary` | Compact one-line summary: fact count + top categories |
| `memory_search` | Search by prefix, exact keys, FTS5 query, or semantic similarity |
| `memory_store` | Store/update a fact (auto-embeds, manages FTS5 index) |

### Registration

**Claude Code:**
```bash
claude mcp add -s user memory node /path/to/mcp/server.mjs
```

**Gemini CLI:** Add to `~/.gemini/settings.json` mcpServers section.

## CLI

Standalone Node.js script for environments without MCP support (e.g. OpenClaw agents via `exec` tool).

```bash
node cli/memory-cli.js store <key> <value>
node cli/memory-cli.js search --prefix|--query|--semantic|--key <value>
node cli/memory-cli.js summary
```

## Semantic Search

- **Model:** Gemini `embedding-001` (3072 dimensions)
- **Storage:** BLOB column in SQLite (12,288 bytes per fact)
- **Query:** Cosine similarity at runtime, threshold >= 0.3
- **Auth:** Vertex AI (`gcloud` token, no TPM limit) > API key (env/Secret Manager fallback)

## SessionStart Hook

`src/query-memory.js` injects a compact memory summary at session start:

```
[Memory — 2026-02-21 | 742 facts] agent(105) memory(87) task(81) ...
```

## Fact Schema

Facts use dot-notation keys with controlled categories:

```
user.name: YJ
agent.貳俠.role: coordinator
error.config.mcp_key: OpenClaw does not support agents.list.mcp key
correction.agent.token: TELEGRAM_TOKEN_MAIN is for 貳俠 not 小序
```

**Categories:** user, project, task, system, config, preference, location, tool, agent, workflow, team, environment, model, auth, channel, gateway, plugin, binding, command, meta, error, correction

## Directory Structure

```
memory-consolidation/
├── run_pipeline.sh              # Pipeline entry point
├── digest-config.json           # Display config (L0 thresholds, pinned keys)
├── SKILL.md                     # OpenClaw skill manifest
├── src/
│   ├── 1-extract-facts.js       # Step 1: LLM fact extraction
│   ├── 2-align-temporally.js    # Step 2: Temporal alignment & dedup
│   ├── 3-commit-to-db.js        # Step 3: SQLite upsert
│   ├── 4-generate-digest.js     # Step 4: Digest generation
│   ├── 5-embed-facts.js         # Step 5: Embedding backfill
│   ├── embed.js                 # Gemini embedding utility (zero npm deps)
│   ├── convert-gemini-sessions.js  # Gemini CLI session converter
│   ├── query-memory.js          # SessionStart hook script
│   └── archive-daily-logs.js    # Log archival utility
├── mcp/
│   ├── server.mjs               # MCP server (stdio transport)
│   └── package.json
├── cli/
│   └── memory-cli.js            # CLI for OpenClaw agents
├── tests/
│   ├── run-tests.sh
│   ├── test-2-align-temporally.js
│   ├── test-3-commit-to-db.js
│   ├── test-4-generate-digest.js
│   └── test-query-memory.js
├── memory.db                    # SQLite database (gitignored)
├── memory_digest.json           # Generated digest (gitignored)
└── .processed_sessions          # Session tracking (gitignored)
```

## Configuration (`digest-config.json`)

| Key | Description |
|---|---|
| `shown_categories` | Categories always shown in MEMORY.md |
| `pinned_keys` | Keys shown in MEMORY.md Pinned section |
| `min_count_for_l0` | Minimum fact count for L0 display |
| `max_categories_in_l0` | Max categories in L0 summary |

## Requirements

- Node.js >= 18
- Gemini CLI (for fact extraction in step 1)
- `gcloud` CLI (for Vertex AI auth / Secret Manager)
- `better-sqlite3` (installed via npm in `src/`)
- `@modelcontextprotocol/sdk`, `zod` (installed via npm in `mcp/`)

## Changelog

### v2.2.0 (2026-02-21)

- Added `mcp/` — MCP server consolidated into repo
- Added `cli/` — CLI tool for OpenClaw agents (exec-based access)
- Added Gemini CLI session ingestion (`--gemini` mode + `convert-gemini-sessions.js`)
- Renamed repo from `memory-conslidation` to `memory-consolidation`

### v2.1.0 (2026-02-20)

- Added step 5: semantic embedding via Gemini embedding-001
- Category normalization (plural → singular)
- L0 compacted to single line format
- Added `--format gemini-hook` for Gemini CLI hook

### v2.0.0 (2026-02-20)

- Implemented steps 1-3 (extract, align, commit)
- Session dedup via `.processed_sessions`
- Backfill mode: `--backfill <directory>`
- 12 new tests

### v1.0.0 (2026-02-19)

- Initial release: digest generation + query interface
