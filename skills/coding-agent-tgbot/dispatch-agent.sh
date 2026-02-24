#!/bin/bash
# coding-agent-tgbot/dispatch-agent.sh
# Dispatch coding tasks to multiple AI agents (Claude/Gemini) from TG bot
#
# Usage:
#   dispatch-agent.sh --agent claude --prompt "task description" --name "task-name"
#   dispatch-agent.sh --agent gemini --prompt "task description" --name "task-name"

set -euo pipefail

# ============== Agent Configuration ==============
declare -A AGENT_BINS=(
    ["claude"]="/home/jerryyrliu/.nvm/versions/node/v24.13.0/bin/claude"
    ["gemini"]="/home/jerryyrliu/.nvm/versions/node/v24.13.0/bin/gemini"
)

declare -A AGENT_TELEGRAM_GROUPS=(
    ["claude"]="-1003779524696"
    ["gemini"]="-1003585105126"
)

declare -A AGENT_DISPLAY_NAMES=(
    ["claude"]="Claude Code"
    ["gemini"]="Gemini CLI"
)

declare -A AGENT_RESULTS_DIRS=(
    ["claude"]="/home/jerryyrliu/claude-code-hooks/data/claude-code-results"
    ["gemini"]="/home/jerryyrliu/gemini-cli-hooks/data/gemini-cli-results"
)

# ============== Common Paths ==============
OPENCLAW_BIN="/home/jerryyrliu/.nvm/versions/node/v24.13.0/bin/openclaw"
MEMORY_CLI="/home/jerryyrliu/.openclaw/workspace/skills/memory-consolidation/cli/memory-cli.js"

# ============== Parse Arguments ==============
AGENT=""
PROMPT=""
TASK_NAME=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        -a|--agent) AGENT="$2"; shift 2;;
        -p|--prompt) PROMPT="$2"; shift 2;;
        -n|--name) TASK_NAME="$2"; shift 2;;
        -h|--help)
            echo "Usage: $0 --agent <claude|gemini> --prompt \"task\" [--name \"name\"]"
            echo ""
            echo "Options:"
            echo "  -a, --agent   Agent to use (required): claude or gemini"
            echo "  -p, --prompt  Task description (required)"
            echo "  -n, --name    Task name (optional, auto-generated if not provided)"
            exit 0
            ;;
        *) echo "Unknown option: $1" >&2; exit 1;;
    esac
done

# ============== Validate Arguments ==============
if [ -z "$AGENT" ]; then
    echo "Error: --agent is required (claude or gemini)" >&2
    exit 1
fi

# Normalize agent name to lowercase
AGENT=$(echo "$AGENT" | tr '[:upper:]' '[:lower:]')

if [[ ! -v AGENT_BINS[$AGENT] ]]; then
    echo "Error: Unknown agent '$AGENT'. Supported: ${!AGENT_BINS[*]}" >&2
    exit 1
fi

if [ -z "$PROMPT" ]; then
    echo "Error: --prompt is required" >&2
    exit 1
fi

if [ -z "$TASK_NAME" ]; then
    TASK_NAME="${AGENT}-$(date +%Y%m%d-%H%M%S)"
fi

# ============== Set Agent-Specific Variables ==============
AGENT_BIN="${AGENT_BINS[$AGENT]}"
TELEGRAM_GROUP="${AGENT_TELEGRAM_GROUPS[$AGENT]}"
AGENT_NAME="${AGENT_DISPLAY_NAMES[$AGENT]}"
RESULTS_DIR="${AGENT_RESULTS_DIRS[$AGENT]}"

# Verify agent binary exists
if [ ! -x "$AGENT_BIN" ]; then
    echo "Error: Agent binary not found or not executable: $AGENT_BIN" >&2
    exit 1
fi

# ============== Helper: Send Telegram Message ==============
send_telegram() {
    local message="$1"

    # Try openclaw first, fallback to curl if it fails
    if [ -x "$OPENCLAW_BIN" ] && "$OPENCLAW_BIN" message send \
        --channel telegram \
        --target "$TELEGRAM_GROUP" \
        --message "$message" 2>/dev/null; then
        return 0
    fi

    # Direct Telegram API fallback
    local TOKEN
    TOKEN=$(gcloud secrets versions access latest --secret=TELEGRAM_TOKEN_MAIN 2>/dev/null || echo "")
    if [ -n "$TOKEN" ]; then
        curl -s -X POST "https://api.telegram.org/bot${TOKEN}/sendMessage" \
            -d chat_id="$TELEGRAM_GROUP" \
            -d text="$message" \
            -d parse_mode="Markdown" >/dev/null 2>&1 || true
    fi
}

# ============== Helper: Store in Memory ==============
store_memory() {
    local key="$1"
    local value="$2"

    if [ -f "$MEMORY_CLI" ]; then
        node "$MEMORY_CLI" store "$key" "$value" 2>/dev/null || true
    fi
}

# ============== Helper: Generate Hashtags ==============
generate_hashtags() {
    # Date tag (Taiwan timezone)
    local date_tag="#$(TZ='Asia/Taipei' date +%Y-%m-%d)"
    local tags="#openclaw #${AGENT} ${date_tag}"

    # Detect skill vs tool based on task name or prompt
    local lower_task=$(echo "$TASK_NAME" | tr '[:upper:]' '[:lower:]')
    local lower_prompt=$(echo "$PROMPT" | tr '[:upper:]' '[:lower:]')
    local combined="$lower_task $lower_prompt"

    if [[ "$combined" == *"skill"* ]]; then
        tags="$tags #skill"
    elif [[ "$combined" == *"tool"* ]]; then
        tags="$tags #tool"
    fi

    # Topic keywords mapping (keyword:tag)
    local -a topic_map=(
        "notion:#notion"
        "cron:#cron"
        "proxy:#proxy"
        "fetch:#fetch"
        "memory:#memory"
        "telegram:#telegram"
        "tg bot:#telegram"
        "git:#git"
        "api:#api"
        "database:#database"
        "db:#database"
        "sqlite:#sqlite"
        "gcp:#gcp"
        "google:#google"
        "obsidian:#obsidian"
        "web3:#web3"
        "defi:#defi"
        "crypto:#crypto"
        "test:#testing"
        "debug:#debug"
        "refactor:#refactor"
        "security:#security"
        "auth:#auth"
        "deploy:#deploy"
        "ci:#ci"
        "docker:#docker"
        "hook:#hooks"
        "dispatch:#dispatch"
        "bot:#bot"
    )

    # Check each topic
    for mapping in "${topic_map[@]}"; do
        local keyword="${mapping%%:*}"
        local tag="${mapping#*:}"
        if [[ "$combined" == *"$keyword"* ]]; then
            # Avoid duplicate tags
            if [[ "$tags" != *"$tag"* ]]; then
                tags="$tags $tag"
            fi
        fi
    done

    echo "$tags"
}

# ============== 1. Notify TG: Task Started ==============
START_MSG="🚀 *${AGENT_NAME} 任務開始*

📋 任務: \`${TASK_NAME}\`
📝 描述: ${PROMPT:0:200}...

⏳ ${AGENT_NAME} 執行中..."

send_telegram "$START_MSG"

# ============== 2. Store Task Start in Memory ==============
store_memory "task.${TASK_NAME}.status" "started"
store_memory "task.${TASK_NAME}.agent" "$AGENT"
store_memory "task.${TASK_NAME}.prompt" "${PROMPT:0:500}"

# ============== 3. Prepare Workspace ==============
echo "📤 Dispatching to ${AGENT_NAME} (foreground)..."
echo "   Agent: $AGENT"
echo "   Task: $TASK_NAME"
echo "   Group: $TELEGRAM_GROUP"

# Create a temporary working directory
TEMP_WORKDIR=$(mktemp -d)
echo "Created temporary workdir: $TEMP_WORKDIR"
# Note: Skipping git init to avoid sandbox restrictions

# Write task-meta.json for hooks
TASK_META="${RESULTS_DIR}/task-meta.json"
mkdir -p "$(dirname "$TASK_META")"
cat > "$TASK_META" <<EOF
{
  "task_name": "${TASK_NAME}",
  "agent": "${AGENT}",
  "telegram_group": "${TELEGRAM_GROUP}",
  "callback_session": "",
  "prompt": "${PROMPT:0:500}",
  "workdir": "${TEMP_WORKDIR}",
  "started_at": "$(date -Iseconds)",
  "agent_teams": false,
  "status": "running"
}
EOF

# Task output file
TASK_OUTPUT="${RESULTS_DIR}/task-output.txt"

# ============== 4. Prepare Prompt with Report Format ==============
# Get Taiwan date for prompt
TW_DATE=$(TZ='Asia/Taipei' date +%Y-%m-%d)

FULL_PROMPT="${PROMPT}

---
完成後請提供：
1. 決策報告 (≤500字)：說明做了什麼、為什麼這樣做、關鍵決策點
2. 一句話摘要 (≤50字)：給 Telegram 通知用
3. Hashtags：用於 Obsidian 搜索，格式如下

格式：
## 決策報告
[報告內容]

## 摘要
[一句話摘要]

---
#openclaw #${TW_DATE} #${AGENT} [其他相關標籤，如 #skill #notion #api #debug 等]"

# Write prompt to temp file to avoid shell escaping issues
PROMPT_FILE=$(mktemp)
printf '%s' "$FULL_PROMPT" > "$PROMPT_FILE"

# ============== 5. Execute Agent ==============
# IMPORTANT: Unset env vars to allow nested launch
unset CLAUDECODE
unset GEMINI_CLI

cd "${TEMP_WORKDIR}"

# Cleanup function for graceful termination
cleanup() {
    local exit_code=$?
    echo "[dispatch] Received signal, cleaning up..."

    # Kill agent if still running
    if [ -n "${AGENT_PID:-}" ] && kill -0 "$AGENT_PID" 2>/dev/null; then
        kill "$AGENT_PID" 2>/dev/null || true
        wait "$AGENT_PID" 2>/dev/null || true
    fi

    # Update status to interrupted
    sed -i 's/"status": "running"/"status": "interrupted"/' "$TASK_META" 2>/dev/null || true

    # Send TG notification about interruption
    send_telegram "⚠️ *${AGENT_NAME} 任務中斷*

📋 任務: \`${TASK_NAME}\`
📝 原因: 進程被終止"

    rm -f "$PROMPT_FILE"
    exit $exit_code
}

trap cleanup SIGTERM SIGINT SIGHUP

# Agent-specific execution - output directly to file (survives parent termination)
case "$AGENT" in
    claude)
        "${AGENT_BIN}" -p - --permission-mode bypassPermissions < "$PROMPT_FILE" > "$TASK_OUTPUT" 2>&1 &
        AGENT_PID=$!
        ;;
    gemini)
        # Gemini CLI - use -y for auto-accept, no sandbox to allow file/shell tools
        # Set GOG_KEYRING_PASSWORD for gog CLI access
        export GOG_KEYRING_PASSWORD=$(gcloud secrets versions access latest --secret=GOG_KEYRING_PASSWORD 2>/dev/null || echo "")
        # Include common directories for file access
        "${AGENT_BIN}" -p - -y \
            --include-directories "$HOME/.openclaw" \
            --include-directories "$HOME/.gemini" \
            --include-directories "$HOME/Telegram-Gemini-Bot" \
            --include-directories "/tmp" \
            < "$PROMPT_FILE" > "$TASK_OUTPUT" 2>&1 &
        AGENT_PID=$!
        ;;
    *)
        echo "Error: No execution handler for agent '$AGENT'" >&2
        exit 1
        ;;
esac

echo "[dispatch] Agent PID: $AGENT_PID, output: $TASK_OUTPUT"

# Wait for agent to complete
wait "$AGENT_PID"
AGENT_EXIT_CODE=$?

# Clear trap after successful completion
trap - SIGTERM SIGINT SIGHUP

cd - >/dev/null

# Cleanup prompt file
rm -f "$PROMPT_FILE"

# Read output from file for processing
AGENT_FULL_OUTPUT=$(cat "$TASK_OUTPUT" 2>/dev/null || echo "")

# ============== 6. Extract Summary, Decision Report, and Hashtags ==============
# Look for "## 摘要" section
SUMMARY=$(echo "$AGENT_FULL_OUTPUT" | sed -n '/^## 摘要/,/^---/p' | sed '1d;/^---/d' | head -c 100 | tr '\n' ' ')
if [ -z "$SUMMARY" ]; then
    SUMMARY="任務已完成（無摘要）"
fi

# Extract decision report (between "## 決策報告" and "## 摘要")
DECISION_REPORT=$(echo "$AGENT_FULL_OUTPUT" | sed -n '/^## 決策報告/,/^## 摘要/p' | sed '1d;/^## 摘要/d')
if [ -z "$DECISION_REPORT" ]; then
    DECISION_REPORT="（無決策報告）"
fi

# Extract hashtags from agent output (lines starting with #openclaw)
AGENT_HASHTAGS=$(echo "$AGENT_FULL_OUTPUT" | grep -E "^#openclaw" | tail -1)
if [ -z "$AGENT_HASHTAGS" ]; then
    # Fallback to auto-generated hashtags
    AGENT_HASHTAGS=$(generate_hashtags)
fi

# ============== 7. Save Decision Report as Markdown ==============
REPORTS_DIR="/home/jerryyrliu/.openclaw/workspace/reports/decisions"
mkdir -p "$REPORTS_DIR"

REPORT_DATE=$(date +%Y-%m-%d)
REPORT_TIME=$(date +%H:%M:%S)
REPORT_FILE="${REPORTS_DIR}/${TASK_NAME}.md"

cat > "$REPORT_FILE" <<REPORT_EOF
---
task: ${TASK_NAME}
agent: ${AGENT}
status: $([ "$AGENT_EXIT_CODE" -eq 0 ] && echo "completed" || echo "failed")
date: ${REPORT_DATE}
time: ${REPORT_TIME}
tags:
  - decision-report
  - ${AGENT}
---

# ${TASK_NAME}

## 任務資訊
- **Agent**: ${AGENT_NAME}
- **日期**: ${REPORT_DATE} ${REPORT_TIME}
- **狀態**: $([ "$AGENT_EXIT_CODE" -eq 0 ] && echo "✅ 完成" || echo "❌ 失敗")

## 任務描述
${PROMPT:0:1000}

## 決策報告
${DECISION_REPORT}

## 摘要
${SUMMARY}

---
${AGENT_HASHTAGS}
REPORT_EOF

echo "[dispatch] Decision report saved: $REPORT_FILE"

# Upload to Google Drive (Obsidian sync)
GDRIVE_FOLDER_ID="1kGbGb-OX_7Spms6dbRoSfYxL5AdImahK"
GOG_ACCOUNT="jerryyrliu@gmail.com"
if command -v gog &>/dev/null; then
    export GOG_KEYRING_PASSWORD=${GOG_KEYRING_PASSWORD:-$(gcloud secrets versions access latest --secret=GOG_KEYRING_PASSWORD 2>/dev/null || echo "")}
    gog drive upload "$REPORT_FILE" --parent "$GDRIVE_FOLDER_ID" --account "$GOG_ACCOUNT" 2>/dev/null && \
        echo "[dispatch] Uploaded to Google Drive: ${TASK_NAME}.md" || \
        echo "[dispatch] Google Drive upload failed (non-critical)"
fi

# ============== 8. Store Completion in Memory ==============
if [ "$AGENT_EXIT_CODE" -eq 0 ]; then
    store_memory "task.${TASK_NAME}.status" "completed"
else
    store_memory "task.${TASK_NAME}.status" "failed"
fi
store_memory "task.${TASK_NAME}.summary" "$SUMMARY"
store_memory "task.${TASK_NAME}.decision_report" "${DECISION_REPORT:0:2000}"

# ============== 9. Notify TG: Task Completed ==============
if [ "$AGENT_EXIT_CODE" -eq 0 ]; then
    STATUS_EMOJI="✅"
    STATUS_TEXT="完成"
else
    STATUS_EMOJI="❌"
    STATUS_TEXT="失敗 (exit code: $AGENT_EXIT_CODE)"
fi

END_MSG="${STATUS_EMOJI} *${AGENT_NAME} 任務${STATUS_TEXT}*

📋 任務: \`${TASK_NAME}\`
📝 摘要: ${SUMMARY}"

send_telegram "$END_MSG"

# Update task-meta status
sed -i 's/"status": "running"/"status": "done"/' "$TASK_META" 2>/dev/null || true

echo ""
echo "${STATUS_EMOJI} Task ${TASK_NAME} ${STATUS_TEXT}"
echo "   Agent: ${AGENT_NAME}"
echo "   Summary: $SUMMARY"

exit $AGENT_EXIT_CODE
