# Coding Agent Skill (TG Bot)

Dispatch coding tasks to Claude Code and receive results in Telegram.

## When to Use

Use this skill when a task requires:
- Writing or modifying code across multiple files
- Git operations (commit, branch, PR)
- Complex refactoring or architecture changes
- Tasks that benefit from Claude Code's capabilities

## How to Use

Execute the dispatch script:

```bash
~/.openclaw/workspace/skills/coding-agent-tgbot/dispatch.sh \
  --prompt "任務描述，要具體說明需求" \
  --name "task-name-kebab-case"
```

## Parameters

| Parameter | Required | Description |
|-----------|----------|-------------|
| `--prompt` | Yes | Detailed task description |
| `--name` | Yes | Task identifier (kebab-case) |

## What Happens

1. Task notification sent to TG group
2. Claude Code executes in background
3. On completion:
   - Full report (≤500 words) stored in memory.db
   - Summary (≤50 words) sent to TG group
   - Code changes committed (if applicable)

## Example

User: "幫我在 memory-consolidation 加一個 /status command"

貳俠 response:
```
收到！這個任務需要 Claude Code 來處理。

正在派發任務...
```

Then execute:
```bash
~/.openclaw/workspace/skills/coding-agent-tgbot/dispatch.sh \
  --prompt "在 memory-consolidation repo 加一個 /status CLI command，顯示：1) memory.db 的 fact 數量 2) 最後更新時間 3) 各 category 的 fact 統計" \
  --name "add-status-command"
```

## Check Status

```bash
~/.openclaw/workspace/skills/coding-agent-tgbot/status.sh <task-name>
```

Output:
- Task status (started/completed/failed)
- Process state (running/finished)
- Log tail (last 10 lines)
- Report (if completed)

## Notes

- Claude Code runs autonomously (no mid-task questions in MVP)
- Results automatically saved to memory.db for future reference
- Check TG group for completion notification
