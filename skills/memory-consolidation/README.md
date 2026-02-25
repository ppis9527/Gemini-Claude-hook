# Memory Consolidation System

A persistent memory system for AI agents. Extracts facts from conversation sessions via LLM, stores them in SQLite with semantic embeddings, and provides multiple access interfaces (MCP server, CLI, hooks).

Built for [OpenClaw](https://openclaw.ai/), also works with Claude Code and Gemini CLI.

## Architecture

```
                    ┌─────────────────────────────────────────┐
                    │            Session Sources               │
                    │  Claude Code  │  Gemini CLI  │  OpenClaw │
                    │    JSONL      │    JSON      │   JSONL   │
                    └───────┬───────────┬──────────────┬──────┘
                            │           │              │
                    ┌───────▼───────────▼──────────────▼──────┐
                    │          Noise Filter                    │
                    │  (boilerplate, denials, meta-questions)  │
                    └───────────────────┬─────────────────────┘
                                        │
                    ┌───────────────────▼─────────────────────┐
                    │          Pipeline (8 steps)              │
                    │                                          │
                    │  1. Extract facts (Gemini LLM)           │
                    │  2. Temporal alignment                   │
                    │  3. Commit + LLM dedup (skip/merge/new)  │
                    │  4. Generate digest                      │
                    │  5. Embed (Gemini embedding)             │
                    │  6. Generate daily log                   │
                    │  7. Weekly snapshot                      │
                    │  8. Rolling topic files                  │
                    └───────────────────┬─────────────────────┘
                                        │
                    ┌───────────────────┼───────────────────┐
                    ▼                   ▼                   ▼
           ┌─────────────────┐  ┌────────────┐  ┌─────────────────┐
           │   memory.db      │  │   logs/     │  │    topics/       │
           │  SQLite + FTS5   │  │ YYYY-MM-DD  │  │ <category>.md    │
           │  + embeddings    │  │    .md      │  │ YYYY-Www-*.md    │
           └──┬──────┬──────┬─┘  └────────────┘  └─────────────────┘
              │      │      │
 ┌────────────▼┐  ┌──▼───┐  ┌▼────────────┐
 │ Hybrid Search│  │ CLI  │  │ Hook inject │
 │ (Vector+BM25)│  │      │  │(SessionStart│
 │  MCP Server  │  │      │  │  summary)   │
 └──────────────┘  └──────┘  └─────────────┘
```

## Components

| Component | Path | Description |
|---|---|---|
| **Pipeline** | `run_pipeline.sh` | 8-step batch processing (steps 1-6) |
| **Weekly Cron** | `src/weekly-consolidation.sh` | Weekly topic consolidation (steps 7-8) |
| **MCP Server** | `mcp/server.mjs` | Model Context Protocol server for Claude Code & Gemini CLI |
| **CLI** | `cli/memory-cli.js` | Command-line interface for OpenClaw agents (via `exec`) |
| **Instinct CLI** | `cli/instinct-cli.js` | Manage learned behavioral rules (instincts) |
| **Hook** | `src/query-memory.js` | SessionStart hook that injects memory summary + instincts |
| **Gemini Extract** | `src/gemini-session-extract.js` | SessionEnd/PreCompress hook for real-time Gemini fact extraction |

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
| 1 | `src/1-extract-facts.js` | Extract facts from session JSONL via Gemini 2.5-flash-lite (with noise filter) | ~500 |
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

# Every 6 hours +30min: instinct extraction (after memory sync)
30 */6 * * * node /path/to/cli/instinct-cli.js extract --store

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

## Hybrid Search (Vector + BM25)

The MCP server uses **hybrid search** combining semantic vectors and keyword matching:

| Method | Finds | Example |
|--------|-------|---------|
| **Vector** | Semantically similar | Search "editor" → finds "VSCode", "IDE" |
| **BM25 (FTS5)** | Exact keywords | Search "GOG_KEYRING_PASSWORD" → exact match |

Results are merged with weighted scoring + BM25 bonus when both methods agree.

### Configuration

- **Model:** Gemini `embedding-001` (3072 dimensions)
- **Storage:** BLOB column in SQLite (12,288 bytes per fact)
- **Vector threshold:** Cosine similarity >= 0.3
- **Fusion:** 70% vector + 30% BM25, +15% bonus for dual matches
- **Auth:** Vertex AI (`gcloud` token, no TPM limit) > API key (env/Secret Manager fallback)

## Noise Filter

Before LLM extraction, conversations are filtered to remove low-quality content:

| Category | Examples | Reason |
|----------|----------|--------|
| **Boilerplate** | "hi", "ok", "thanks" | No factual content |
| **Agent denials** | "I don't have data", "I don't recall" | No information |
| **Meta-questions** | "Do you remember?", "Did I mention?" | Questions about memory |
| **System output** | Pure JSON, log prefixes | Tool output, not facts |

This reduces LLM tokens by ~30-50% while preserving meaningful content.

## Hooks

### SessionStart Hook

`src/query-memory.js` injects a compact memory summary at session start:

```
[Memory — 2026-02-21 | 742 facts] agent(105) memory(87) task(81) ...
[Instincts — learned behaviors (do not repeat mistakes)]
[error] when encountering test failure → Use Bash (90%)
[tool] when edit functionality is needed → Prefer using Edit tool (80%)
```

### Gemini CLI Real-time Extraction

`src/gemini-session-extract.js` enables real-time fact extraction for Gemini CLI:

| Event | Trigger | Action |
|-------|---------|--------|
| **SessionEnd** | `/clear`, exit | Extract facts → commit to DB |
| **PreCompress** | Before context compression | Extract facts → commit to DB |

**Configuration** (`~/.gemini/settings.json`):

```json
{
  "hooks": {
    "SessionEnd": [{
      "hooks": [{
        "name": "extract-facts-on-end",
        "type": "command",
        "command": "node /path/to/src/gemini-session-extract.js",
        "timeout": 60000
      }]
    }],
    "PreCompress": [{
      "hooks": [{
        "name": "extract-facts-before-compress",
        "type": "command",
        "command": "node /path/to/src/gemini-session-extract.js",
        "timeout": 60000
      }]
    }]
  }
}
```

This removes dependency on cron-based sync for Gemini CLI sessions.

## Instincts

Instincts are behavioral rules derived from repeated observations (cases & patterns). They help agents avoid repeating past mistakes.

### Key Pattern

```
agent.instinct.<domain>.<id>
```

Domains: `error`, `workflow`, `tool`, `coding`, `testing`

### Extraction

```bash
# Extract from existing cases/patterns
node src/extract-instincts.js --store

# Or via CLI
node cli/instinct-cli.js extract --store
```

### Instinct CLI

```bash
# List all instincts
node cli/instinct-cli.js list

# Filter by domain
node cli/instinct-cli.js list --domain error

# Show details
node cli/instinct-cli.js show agent.instinct.error.test_failure

# Statistics
node cli/instinct-cli.js stats

# Delete
node cli/instinct-cli.js delete <key>
```

### Confidence Scoring

| Count | Confidence |
|-------|------------|
| 2 | 50% |
| 3 | 60% |
| 5 | 70% |
| 7 | 80% |
| 10+ | 90% |

Only instincts with confidence ≥60% are injected at SessionStart.

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
│   ├── noise-filter.js          # Noise filter (boilerplate, denials, meta-questions)
│   ├── hybrid-search.js         # Hybrid search (Vector + BM25)
│   ├── convert-gemini-sessions.js  # Gemini CLI session converter
│   ├── query-memory.js          # SessionStart hook script
│   ├── gemini-session-extract.js # Gemini CLI SessionEnd/PreCompress hook
│   ├── extract-instincts.js     # Instinct extraction from cases/patterns
│   └── archive-daily-logs.js    # Log archival utility
├── mcp/
│   ├── server.mjs               # MCP server (stdio transport)
│   └── package.json
├── cli/
│   ├── memory-cli.js            # CLI for OpenClaw agents
│   └── instinct-cli.js          # Instinct management CLI
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

### v2.6.0 (2026-02-25)

- Added **Noise Filter**: `src/noise-filter.js`
  - Filters boilerplate (hi, ok, thanks), agent denials, meta-questions
  - Integrated into `1-extract-facts.js` before LLM call
  - Reduces LLM tokens by ~30-50%
- Added **Hybrid Search**: `src/hybrid-search.js`
  - Combines vector similarity + BM25 (FTS5)
  - Better exact keyword matching (variable names, API keys)
  - Weighted score fusion with BM25 bonus
  - Integrated into MCP server `memory_search`

### v2.5.0 (2026-02-25)

- Added **Gemini CLI real-time extraction**: `src/gemini-session-extract.js`
- SessionEnd hook: extract facts on `/clear` or exit
- PreCompress hook: extract facts before context compression
- Auto-finds latest session file as fallback
- Removes dependency on 6-hour cron for Gemini sessions

### v2.4.0 (2026-02-25)

- Added **Instincts**: behavioral rules derived from cases/patterns
- `src/extract-instincts.js`: aggregates cases/patterns into instincts
- `cli/instinct-cli.js`: CLI for list/show/stats/extract/delete
- `src/query-memory.js`: now injects instincts at SessionStart
- New key pattern: `agent.instinct.<domain>.<id>`
- Cron job: instinct extraction every 6 hours (+30min after sync)

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
