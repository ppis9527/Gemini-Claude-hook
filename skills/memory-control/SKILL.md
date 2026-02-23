# memory-control

Standalone context compression skill for Gemini CLI.

## Features

- **Auto-compress at 55%**: Automatically triggers when context reaches 55% capacity
- **3-step compression**: Generate recap → Save to file → Run /compress
- **Session recap injection**: Loads previous recap on new sessions
- **Model-aware**: Knows context window sizes for Gemini models

## Installation

```bash
# 1. Clone or copy this skill
cp -r ~/.openclaw/workspace/skills/memory-control ~/.gemini/skills/

# 2. Add hooks to ~/.gemini/settings.json
```

Add to `~/.gemini/settings.json`:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup",
        "hooks": [
          {
            "name": "memory-control-inject",
            "type": "command",
            "command": "node ~/.gemini/skills/memory-control/src/inject-recap-hook.mjs",
            "timeout": 5000
          }
        ]
      }
    ],
    "PostResponse": [
      {
        "matcher": ".*",
        "hooks": [
          {
            "name": "memory-control-compress",
            "type": "command",
            "command": "node ~/.gemini/skills/memory-control/src/auto-compress-hook.mjs",
            "timeout": 120000
          }
        ]
      }
    ]
  }
}
```

## How It Works

### Compression Flow (at 55% context)

```
PostResponse hook triggered
    ↓
Check: input_tokens / context_window >= 0.55?
    ↓ Yes
Step 1: Generate recap summary via Gemini
    ↓
Step 2: Save to <workDir>/session-recap.md
    ↓
Step 3: Run `gemini /compress` to truncate context
    ↓
Next session: SessionStart hook injects recap
```

### Files Created

| File | Purpose |
|------|---------|
| `session-recap.md` | Compressed context summary (in project dir) |

## Configuration

Edit `src/auto-compress-hook.mjs`:

```javascript
const COMPRESS_THRESHOLD = 0.55;  // Change threshold here

const MODEL_CONTEXT_WINDOWS = {
  "gemini-2.5-flash": 1_048_576,
  // Add new models here
};
```

## Manual Usage

```bash
# Manually compress a session
node ~/.gemini/skills/memory-control/src/compress.mjs <sessionId> <workDir>
```

## Supported Models

| Model | Context Window |
|-------|----------------|
| gemini-2.5-flash-lite | 1M tokens |
| gemini-2.5-flash | 1M tokens |
| gemini-2.5-pro | 1M tokens |
| gemini-3-flash-preview | 1M tokens |
| gemini-3-pro-preview | 1M tokens |

## Troubleshooting

**Compression not triggering?**
- Check if model is in `MODEL_CONTEXT_WINDOWS`
- Verify hooks are configured in settings.json
- Check `~/.gemini/history/` for session logs

**Recap not injecting?**
- Ensure `session-recap.md` exists in project directory
- Check SessionStart hook is configured

## Related

- [Telegram-Gemini-Bot](https://github.com/jerryyrliu-jpg/Telegram-Gemini-Bot) - Original implementation
- `memory-consolidation` skill - Cross-session persistent memory (MCP)
