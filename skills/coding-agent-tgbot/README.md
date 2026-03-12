# Coding Agent — Multi-Agent Dispatch with Telegram

Dispatch coding tasks to Claude Code or Gemini CLI agents, with structured output and Telegram notifications.

## Features

- **Multi-agent support** — dispatch to `claude` or `gemini`
- **Structured output** — `result.json` with status, summary, duration, files changed
- **Parallel mode** — run multiple tasks concurrently (max 3)
- **Timeout** — configurable per-task timeout (default 30 min)
- **Depth limit** — prevents recursive dispatch (`DISPATCH_DEPTH` env var)
- **TG notifications** — start/complete/fail alerts to Telegram groups

## Usage

### Single task

```bash
dispatch-agent.sh \
  --agent claude \
  --prompt "Refactor the auth module to use JWT" \
  --name "refactor-auth"
```

### With timeout

```bash
dispatch-agent.sh \
  --agent gemini \
  --prompt "Run full test suite and fix failures" \
  --name "fix-tests" \
  --timeout 60  # minutes
```

### Parallel tasks

```bash
dispatch-agent.sh --parallel \
  --task "lint:claude:Run eslint and fix all errors" \
  --task "tests:gemini:Run pytest and report coverage"
```

### Check status

```bash
status.sh <task-name>
```

## Parameters

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `--agent` | Yes* | — | Agent to use: `claude` or `gemini` |
| `--prompt` | Yes* | — | Task description |
| `--name` | Yes* | — | Task identifier (kebab-case) |
| `--timeout` | No | 30 | Timeout in minutes |
| `--parallel` | No | — | Enable parallel mode |
| `--task` | No | — | Parallel task: `"name:agent:prompt"` (repeatable) |

*Required for single-task mode. In parallel mode, use `--task` instead.

## Output

### result.json

Each task generates a structured `result.json`:

```json
{
  "task_name": "refactor-auth",
  "agent": "claude",
  "status": "completed",
  "exit_code": 0,
  "summary": "Refactored auth module to use JWT...",
  "duration_seconds": 342,
  "files_changed": ["src/auth.ts", "src/middleware.ts"],
  "hashtags": ["#refactor", "#auth"],
  "timestamp": "2026-03-12T10:30:00Z"
}
```

Status values: `completed`, `failed`, `timeout`

### Parallel summary

In parallel mode, a `parallel-summary.json` aggregates all task results.

## Architecture

```
dispatch-agent.sh
  ├── Single mode
  │     ├── Validate args + DISPATCH_DEPTH check
  │     ├── TG notification: "🚀 Task started"
  │     ├── Run agent (claude/gemini) with timeout
  │     ├── Generate result.json
  │     └── TG notification: "✅ Task completed"
  │
  └── Parallel mode
        ├── Parse --task args (max 3)
        ├── TG notification: "🚀 N tasks started"
        ├── Fork each task as background process
        ├── Wait for all + collect exit codes
        ├── Generate parallel-summary.json
        └── TG notification: summary of all tasks
```

## Safety

- **Depth limit**: `DISPATCH_DEPTH` env var prevents recursive dispatch. If ≥ 1, the script refuses to run.
- **Timeout**: Tasks are killed after the timeout period. Status is set to `timeout` in result.json.
- **Input sanitization**: Task names are sanitized to prevent path traversal. Prompts are passed via `jq` to prevent JSON injection.

## Files

| File | Description |
|------|-------------|
| `dispatch-agent.sh` | Main dispatch script (single + parallel mode) |
| `dispatch.sh` | Legacy script (Claude only, deprecated) |
| `status.sh` | Check task status |
| `SKILL.md` | OpenClaw skill manifest |

## Integration

### Telegram Groups

Notifications are sent to configurable TG groups (one per agent type). Set via environment or hardcoded in the script.

### Notify Hook

`~/.claude/hooks/notify-agi.sh` (Claude Code Stop hook) reads `result.json` for structured notifications, with fallback to legacy summary extraction.

### Memory

Task reports are stored in `memory.db` via the memory-consolidation system for cross-session retrieval.
