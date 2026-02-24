---
name: usage-monitor
description: Scans Gemini and OpenClaw session logs to generate reports on token usage, costs, model frequency, and skill usage. Use when asked "how many tokens did we use?" or "what's our API cost?".
metadata:
  {
    "openclaw": { "emoji": "📈" },
  }
---

# Usage Monitor

This skill analyzes session logs to provide data-driven insights into your AI ecosystem's usage patterns, including **token consumption and API costs**.

## 🔧 Tools

### `usage_report`
Generates a comprehensive usage report.
- **Action**: Runs `node src/usage-reporter.js`.
- **Parameters**:
  - `--since <days>`: Analyze data from the last N days (default: 7).

## 🚀 How to Trigger
> "Show me the token usage for the last 7 days."
> "How much did we spend on API calls this week?"
> "Which models have we been using the most?"
> "What skills are being used?"

## 📊 Report Contents

### 💰 Token Usage & Cost (OpenClaw)
| Model | Calls | Input | Output | Cache Read | Cost |
|-------|-------|-------|--------|------------|------|
Per-model breakdown of token consumption and estimated cost.

### 🤖 Model Call Counts
Number of API calls per model (OpenClaw + Gemini CLI).

### 🛠️ Internal Skill Usage
Which skills from `~/.openclaw/workspace/skills/` are being called.

## 📁 Output
Reports are saved to: `~/.openclaw/workspace/reports/usage/USAGE_REPORT_YYYY-MM-DD.md`

## ⚠️ Notes
- Token/cost data is only available for **OpenClaw agents** (extracted from `usage` field in session JSONL).
- Gemini CLI sessions don't include token counts in their logs.
