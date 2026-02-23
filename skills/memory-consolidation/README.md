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
                          │      Pipeline (8 steps)       │
                          │                               │
                          │  1. Extract facts (Gemini LLM)│
                          │  2. Temporal alignment        │
                          │  3. Commit to SQLite          │
                          │  4. Generate digest           │
                          │  5. Embed (Gemini embedding)  │
                          │  6. Generate daily log        │
                          │  7. Weekly snapshot           │
                          │  8. Rolling topic files       │
                          └────────────┬──────────────────┘
                                       │
                    ┌──────────────────┼──────────────────┐
                    ▼                  ▼                  ▼
           ┌─────────────────┐  ┌────────────┐  ┌─────────────────┐
           │   memory.db      │  │   logs/     │  │    topics/       │
           │  SQLite + FTS5   │  │ YYYY-MM-DD  │  │ <category>.md    │
           │  + embeddings    │  │    .md      │  │ YYYY-Www-*.md    │
           └──┬──────┬──────┬─┘  └────────────┘  └─────────────────┘
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
| **Pipeline** | `run_pipeline.sh` | 8-step batch processing (steps 1-6) |
| **Weekly Cron** | `src/weekly-consolidation.sh` | Weekly topic consolidation (steps 7-8) |
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

### Core Pipeline (Steps 1-6)

Runs every 6 hours via `periodic-memory-sync.sh` and `daily-gemini-sync.sh`.

| Step | Script | Description | Tokens |
|---|---|---|---|
| 1 | `src/1-extract-facts.js` | Extract facts from session JSONL via Gemini 2.5-flash-lite | ~500 |
| 2 | `src/2-align-temporally.js` | Temporal alignment, dedup same key+value | 0 |
| 3 | `src/3-commit-to-db.js` | SQLite upsert with start_time/end_time lifecycle | 0 |
| 4 | `src/4-generate-digest.js` | Generate memory_digest.json | 0 |
| 5 | `src/5-embed-facts.js` | Generate Gemini embedding-001 vectors (3072-dim) | ~100 |
| 6 | `src/6-generate-daily-log.js` | Generate `logs/YYYY-MM-DD.md` from DB | 0 |

### Weekly Consolidation (Steps 7-8)

Runs every Sunday 4am via `src/weekly-consolidation.sh`.

| Step | Script | Description | Output |
|---|---|---|---|
| 7 | `src/7-consolidate-weekly.js` | Weekly snapshot by category | `topics/YYYY-Www-<category>.md` |
| 8 | `src/8-update-rolling-topics.js` | Rolling topic files (cross-week) | `topics/<category>.md`, `topics/index.md` |

### Output Directories

```
logs/
├── 2026-02-22.md          # Daily log (facts extracted that day)
├── 2026-02-23.md
└── ...

topics/
├── index.md               # Master index with fact counts per category
├── config.md              # Rolling topic file (all-time, updated weekly)
├── correction.md
├── agent.md
├── ...
├── 2026-W09-summary.md    # Weekly snapshot index
├── 2026-W09-config.md     # Weekly snapshot by category
└── ...
```

### Cron Schedule

```bash
# Every 6 hours: steps 1-6 (OpenClaw sessions)
0 */6 * * * /path/to/src/periodic-memory-sync.sh

# Every 6 hours: steps 1-6 (Gemini CLI sessions)
0 */6 * * * /path/to/src/daily-gemini-sync.sh

# Sunday 4am: steps 7-8 (weekly consolidation)
0 4 * * 0 /path/to/src/weekly-consolidation.sh
```

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
├── run_pipeline.sh              # Pipeline entry point (steps 1-6)
├── digest-config.json           # Display config (L0 thresholds, pinned keys)
├── SKILL.md                     # OpenClaw skill manifest
├── src/
│   ├── 1-extract-facts.js       # Step 1: LLM fact extraction
│   ├── 2-align-temporally.js    # Step 2: Temporal alignment & dedup
│   ├── 3-commit-to-db.js        # Step 3: SQLite upsert
│   ├── 4-generate-digest.js     # Step 4: Digest generation
│   ├── 5-embed-facts.js         # Step 5: Embedding backfill
│   ├── 6-generate-daily-log.js  # Step 6: Daily log generation
│   ├── 7-consolidate-weekly.js  # Step 7: Weekly snapshot
│   ├── 8-update-rolling-topics.js # Step 8: Rolling topic files
│   ├── weekly-consolidation.sh  # Weekly cron script (steps 7-8)
│   ├── periodic-memory-sync.sh  # 6h cron (OpenClaw sessions)
│   ├── daily-gemini-sync.sh     # 6h cron (Gemini CLI sessions)
│   ├── embed.js                 # Gemini embedding utility (zero npm deps)
│   ├── convert-gemini-sessions.js  # Gemini CLI session converter
│   ├── query-memory.js          # SessionStart hook script
│   └── archive-daily-logs.js    # Log archival utility
├── mcp/
│   ├── server.mjs               # MCP server (stdio transport)
│   └── package.json
├── cli/
│   └── memory-cli.js            # CLI for OpenClaw agents
├── logs/                        # Daily logs (gitignored)
│   └── YYYY-MM-DD.md
├── topics/                      # Topic files (gitignored)
│   ├── index.md                 # Master index
│   ├── <category>.md            # Rolling topic files
│   └── YYYY-Www-*.md            # Weekly snapshots
├── tests/
│   └── ...
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

### v2.3.0 (2026-02-23)

- Added step 6: Daily log generation (`logs/YYYY-MM-DD.md`) — 0 API calls
- Added step 7: Weekly snapshot consolidation (`topics/YYYY-Www-*.md`)
- Added step 8: Rolling topic files (`topics/<category>.md`, `topics/index.md`)
- Added `src/weekly-consolidation.sh` for weekly cron (Sunday 4am)
- Key normalization: handles both `/` and `.` separators in fact keys
- New output directories: `logs/` and `topics/`

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
