#!/bin/bash
# coding-agent-tgbot/dispatch.sh
# Dispatch coding tasks to Claude Code from TG Gemini bot
#
# Usage:
#   dispatch.sh --prompt "task description" --name "task-name"

set -euo pipefail

# Fixed TG group for results
TELEGRAM_GROUP="YOUR_CLAUDE_TG_GROUP_ID"

# Paths
DISPATCH_SCRIPT="$HOME/claude-code-hooks/scripts/dispatch-claude-code.sh"
OPENCLAW_BIN="$HOME/.nvm/versions/node/$(node --version)/bin/openclaw"
MEMORY_CLI="$HOME/.openclaw/workspace/skills/memory-consolidation/cli/memory-cli.js"

# Parse arguments
PROMPT=""
TASK_NAME=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        -p|--prompt) PROMPT="$2"; shift 2;;
        -n|--name) TASK_NAME="$2"; shift 2;;
        *) echo "Unknown option: $1" >&2; exit 1;;
    esac
done

if [ -z "$PROMPT" ]; then
    echo "Error: --prompt is required" >&2
    exit 1
fi

if [ -z "$TASK_NAME" ]; then
    TASK_NAME="coding-$(date +%Y%m%d-%H%M%S)"
fi

# ---- 1. Notify TG: Task Started ----
START_MSG="🚀 *Coding Agent 任務開始*

📋 任務: \`${TASK_NAME}\`
📝 描述: ${PROMPT:0:200}...

⏳ Claude Code 執行中..."

# Try openclaw first, fallback to curl if it fails
if [ -x "$OPENCLAW_BIN" ] && "$OPENCLAW_BIN" message send \
    --channel telegram \
    --target "$TELEGRAM_GROUP" \
    --message "$START_MSG" 2>/dev/null; then
    : # success
else
    # Direct Telegram API fallback
    TOKEN=$(gcloud secrets versions access latest --secret=TELEGRAM_TOKEN_MAIN 2>/dev/null || echo "")
    if [ -n "$TOKEN" ]; then
        curl -s -X POST "https://api.telegram.org/bot${TOKEN}/sendMessage" \
            -d chat_id="$TELEGRAM_GROUP" \
            -d text="$START_MSG" \
            -d parse_mode="Markdown" >/dev/null 2>&1 || true
    fi
fi

# ---- 2. Store task start in memory ----
if [ -f "$MEMORY_CLI" ]; then
    node "$MEMORY_CLI" store "task.${TASK_NAME}.status" "started" 2>/dev/null || true
    node "$MEMORY_CLI" store "task.${TASK_NAME}.prompt" "${PROMPT:0:500}" 2>/dev/null || true
fi

# ---- 3. Dispatch to Claude Code ----
# Append instructions for report format
FULL_PROMPT="${PROMPT}

---
完成後請提供：
1. 決策報告 (≤500字)：說明做了什麼、為什麼這樣做、關鍵決策點
2. 一句話摘要 (≤50字)：給 Telegram 通知用

格式：
## 決策報告
[報告內容]

## 摘要
[一句話摘要]"

echo "📤 Dispatching to Claude Code (background)..."
echo "   Task: $TASK_NAME"
echo "   Group: $TELEGRAM_GROUP"

# ---- 3. Run Claude Code in background ----
# Use nohup to detach from current session
# IMPORTANT: Unset CLAUDECODE env var to allow nested launch
LOG_FILE="/tmp/claude-code-${TASK_NAME}.log"

unset CLAUDECODE
# Create a temporary working directory for Claude Code
TEMP_WORKDIR=$(mktemp -d)
echo "Created temporary workdir: $TEMP_WORKDIR"
cd "$TEMP_WORKDIR" && git init >/dev/null # Initialize git repo
cd - >/dev/null # Go back to original directory

# Write task-meta.json for hooks (after TEMP_WORKDIR is created)
TASK_META="$HOME/claude-code-hooks/data/claude-code-results/task-meta.json"
mkdir -p "$(dirname "$TASK_META")"
cat > "$TASK_META" <<EOF
{
  "task_name": "${TASK_NAME}",
  "telegram_group": "${TELEGRAM_GROUP}",
  "callback_session": "",
  "prompt": "${PROMPT:0:500}",
  "workdir": "${TEMP_WORKDIR}",
  "started_at": "$(date -Iseconds)",
  "agent_teams": false,
  "status": "running"
}
EOF

export CLAUDE_CODE_BIN="$HOME/.nvm/versions/node/$(node --version)/bin/claude"
# IMPORTANT: hooks read from this fixed path
TASK_OUTPUT="$HOME/claude-code-hooks/data/claude-code-results/task-output.txt"

# Write prompt to temp file to avoid shell escaping issues
PROMPT_FILE=$(mktemp)
printf '%s' "$FULL_PROMPT" > "$PROMPT_FILE"

# Execute Claude Code in the foreground and capture its output and exit code
cd "${TEMP_WORKDIR}"
CLAUDE_FULL_OUTPUT=$("${CLAUDE_CODE_BIN}" -p - --permission-mode bypassPermissions < "$PROMPT_FILE" 2>&1)
CLAUDE_EXIT_CODE=$?
cd - >/dev/null

# Cleanup
rm -f "$PROMPT_FILE"

# Write the captured output to TASK_OUTPUT
echo "$CLAUDE_FULL_OUTPUT" > "$TASK_OUTPUT"

# ---- 4. Extract summary from output ----
# Look for "## 摘要" section
SUMMARY=$(echo "$CLAUDE_FULL_OUTPUT" | sed -n '/^## 摘要/,/^##/p' | sed '1d;/^##/d' | head -c 100 | tr '\n' ' ')
if [ -z "$SUMMARY" ]; then
    SUMMARY="任務已完成（無摘要）"
fi

# ---- 5. Store completion in memory ----
if [ -f "$MEMORY_CLI" ]; then
    if [ "$CLAUDE_EXIT_CODE" -eq 0 ]; then
        node "$MEMORY_CLI" store "task.${TASK_NAME}.status" "completed" 2>/dev/null || true
    else
        node "$MEMORY_CLI" store "task.${TASK_NAME}.status" "failed" 2>/dev/null || true
    fi
    node "$MEMORY_CLI" store "task.${TASK_NAME}.summary" "$SUMMARY" 2>/dev/null || true
fi

# ---- 6. Notify TG: Task Completed ----
if [ "$CLAUDE_EXIT_CODE" -eq 0 ]; then
    STATUS_EMOJI="✅"
    STATUS_TEXT="完成"
else
    STATUS_EMOJI="❌"
    STATUS_TEXT="失敗 (exit code: $CLAUDE_EXIT_CODE)"
fi

END_MSG="${STATUS_EMOJI} *Coding Agent 任務${STATUS_TEXT}*

📋 任務: \`${TASK_NAME}\`
📝 摘要: ${SUMMARY}"

if [ -x "$OPENCLAW_BIN" ] && "$OPENCLAW_BIN" message send \
    --channel telegram \
    --target "$TELEGRAM_GROUP" \
    --message "$END_MSG" 2>/dev/null; then
    : # success
else
    TOKEN=$(gcloud secrets versions access latest --secret=TELEGRAM_TOKEN_MAIN 2>/dev/null || echo "")
    if [ -n "$TOKEN" ]; then
        curl -s -X POST "https://api.telegram.org/bot${TOKEN}/sendMessage" \
            -d chat_id="$TELEGRAM_GROUP" \
            -d text="$END_MSG" \
            -d parse_mode="Markdown" >/dev/null 2>&1 || true
    fi
fi

# Update task-meta status
sed -i 's/"status": "running"/"status": "done"/' "$TASK_META" 2>/dev/null || true

echo ""
echo "${STATUS_EMOJI} Task ${TASK_NAME} ${STATUS_TEXT}"
echo "   Summary: $SUMMARY"

exit $CLAUDE_EXIT_CODE
