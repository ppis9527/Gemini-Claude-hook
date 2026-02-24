# Usage Monitor

Tracks token consumption, API costs, and skill usage across OpenClaw and Gemini CLI sessions.

## Installation

```bash
cp -r usage-monitor ~/.openclaw/workspace/skills/
```

## Usage

```bash
node ~/.openclaw/workspace/skills/usage-monitor/src/usage-reporter.js --since 7
```

**Parameters:**
- `--since <days>`: Analyze data from the last N days (default: 7)

## Report Contents

### 💰 Token Usage & Cost (OpenClaw)

| Model | Calls | Input | Output | Cache Read | Cost |
|-------|-------|-------|--------|------------|------|

Per-model breakdown of token consumption and estimated cost (extracted from `usage.cost` in session JSONL).

### 🤖 Model Call Counts

Number of API calls per model for both OpenClaw and Gemini CLI.

### 🛠️ Internal Skill Usage

Which skills from `~/.openclaw/workspace/skills/` are being called.

## Output

Reports are saved to: `~/.openclaw/workspace/reports/usage/USAGE_REPORT_YYYY-MM-DD.md`

## Notes

- Token/cost data is only available for **OpenClaw agents** (extracted from `usage` field in session JSONL)
- Gemini CLI sessions don't include token counts in their logs
- Cost accuracy depends on OpenClaw's built-in pricing tables
