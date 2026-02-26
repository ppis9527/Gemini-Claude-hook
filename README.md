# Gemini-Claude-hook

A collection of hooks and skills for Gemini CLI and Claude Code integration.

## Structure

```
hooks/
└── gemini/
    ├── token-monitor.js          # AfterModel hook — token usage monitor
    └── token-monitor-worker.js   # Background extraction worker

skills/
├── coding-agent/                 # Multi-agent dispatch (Claude/Gemini)
└── memory-consolidation/         # Persistent memory system (facts → DB)
```

## Hooks

### Token Monitor (`hooks/gemini/token-monitor.js`)

AfterModel hook for Gemini CLI that monitors `promptTokenCount` and triggers background fact extraction when context usage exceeds 65%. Prevents memory loss during context compression.

**Flow:**
```
AfterModel event
  → Parse promptTokenCount from stdin
  → < 65% of 128K window → exit (no-op)
  → ≥ 65%:
    → Check RAM ≥ 500MB free
    → Check lock file (singleton)
    → Snapshot session JSON
    → Fork detached worker → exit immediately
```

**Anti-OOM design (3 layers):**

| Layer | Mechanism | Description |
|-------|-----------|-------------|
| 1 | RAM check | `os.freemem() >= 500MB` before fork and at worker startup |
| 2 | Lock file | `/tmp/gemini-extract.lock` with PID + timestamp, stale detection (>10 min) |
| 3 | Heap cap | `--max-old-space-size=200` on child processes |

**Worker pipeline:**
1. Convert session JSON → JSONL
2. Extract facts via `1-extract-facts.js` (Gemini flash-lite)
3. Align temporally + commit to `memory.db`
4. Extract agent learnings
5. Write summary to `GEMINI.md` `## Session Context`

**Configuration** (`~/.gemini/settings.json`):
```json
{
  "hooks": {
    "AfterModel": [{
      "hooks": [{
        "name": "token-monitor",
        "type": "command",
        "command": "node ~/.gemini/hooks/token-monitor.js",
        "timeout": 3000
      }]
    }]
  }
}
```

## Skills

### Memory Consolidation

See [skills/memory-consolidation/README.md](skills/memory-consolidation/README.md) for full documentation.

### Coding Agent

Multi-agent dispatch system for Claude Code and Gemini CLI. See [skills/coding-agent/README.md](skills/coding-agent/README.md).

## Related Repos

- [memory-consolidation](https://github.com/jerryyrliu-jpg/memory-consolidation) (private, latest)
- [claude-code-hooks](https://github.com/ppis9527/claude-code-hooks) — Claude Code specific hooks
