#!/bin/bash
# coding-agent-tgbot/dispatch-agent.sh
# Dispatch coding tasks to multiple AI agents (Claude/Gemini) from TG bot
#
# Usage:
#   dispatch-agent.sh --agent claude --prompt "task description" --name "task-name"
#   dispatch-agent.sh --agent gemini --prompt "task description" --name "task-name"
#   dispatch-agent.sh --timeout 45 --agent claude --prompt "..."
#   dispatch-agent.sh --parallel --task "name1:claude:prompt1" --task "name2:gemini:prompt2"

set -euo pipefail

# ============== A4: Dispatch Depth Limit ==============
DISPATCH_DEPTH="${DISPATCH_DEPTH:-0}"
if [ "$DISPATCH_DEPTH" -ge 1 ]; then
    echo "Error: Recursive dispatch blocked (depth=${DISPATCH_DEPTH})" >&2
    exit 1
fi

# Load all secrets at the beginning to ensure they are available for gcloud and other tools
source /home/jerryyrliu/.openclaw/workspace/tools/load-secrets.sh

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

# ============== A5: Parallel mode constants ==============
MAX_PARALLEL=3

# ============== Parse Arguments ==============
AGENT=""
PROMPT=""
TASK_NAME=""
TIMEOUT_MIN=30          # A3: default 30 minutes
PARALLEL_MODE=false     # A5: parallel mode flag
declare -a PARALLEL_TASKS=()  # A5: array of "name:agent:prompt"

while [[ $# -gt 0 ]]; do
    case "$1" in
        -a|--agent) AGENT="$2"; shift 2;;
        -p|--prompt) PROMPT="$2"; shift 2;;
        -n|--name) TASK_NAME="$2"; shift 2;;
        --timeout) TIMEOUT_MIN="$2"; shift 2;;
        --parallel) PARALLEL_MODE=true; shift;;
        --task) PARALLEL_TASKS+=("$2"); shift 2;;
        -h|--help)
            echo "Usage: $0 --agent <claude|gemini> --prompt \"task\" [--name \"name\"] [--timeout <minutes>]"
            echo "       $0 --parallel --task \"name:agent:prompt\" [--task \"name:agent:prompt\" ...]"
            echo ""
            echo "Options:"
            echo "  -a, --agent    Agent to use (required for single mode): claude or gemini"
            echo "  -p, --prompt   Task description (required for single mode)"
            echo "  -n, --name     Task name (optional, auto-generated if not provided)"
            echo "  --timeout      Timeout in minutes (default: 30)"
            echo "  --parallel     Enable parallel dispatch mode"
            echo "  --task         Task spec for parallel mode: \"name:agent:prompt\""
            exit 0
            ;;
        *) echo "Unknown option: $1" >&2; exit 1;;
    esac
done

# ============== Helper: Send Telegram Message ==============
send_telegram() {
    local message="$1"
    local target_group="${2:-}"

    # Get token from environment (should be loaded by load-secrets.sh)
    local TOKEN="${TELEGRAM_TOKEN_MAIN:-}"

    if [ -z "$TOKEN" ]; then
        echo "[dispatch] Warning: No Telegram token available in TELEGRAM_TOKEN_MAIN env var" >&2
        return 1
    fi

    # Use provided group or fallback
    local group="${target_group}"

    # Try openclaw first (needs TELEGRAM_BOT_TOKEN env var)
    if [ -x "$OPENCLAW_BIN" ]; then
        TELEGRAM_BOT_TOKEN="$TOKEN" "$OPENCLAW_BIN" message send \
            --channel telegram \
            --target "$group" \
            --message "$message" 2>/dev/null && return 0
    fi

    # Direct Telegram API fallback
    local result
    result=$(curl -s -X POST "https://api.telegram.org/bot${TOKEN}/sendMessage" \
        -d chat_id="$group" \
        -d text="$message" \
        -d parse_mode="Markdown" 2>&1)

    if echo "$result" | grep -q '"ok":true'; then
        return 0
    else
        echo "[dispatch] TG send failed: $result" >&2
        return 1
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
    local task_name="${1:-$TASK_NAME}"
    local prompt="${2:-$PROMPT}"

    # Date tag (Taiwan timezone)
    local date_tag="#$(TZ='Asia/Taipei' date +%Y-%m-%d)"
    local agent_for_tags="${3:-$AGENT}"
    local tags="#openclaw #${agent_for_tags} ${date_tag} #VM"

    # Detect skill vs tool based on task name or prompt
    local lower_task=$(echo "$task_name" | tr '[:upper:]' '[:lower:]')
    local lower_prompt=$(echo "$prompt" | tr '[:upper:]' '[:lower:]')
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

# ============== A1: Generate result.json ==============
generate_result_json() {
    local task_name="$1"
    local agent="$2"
    local exit_code="$3"
    local summary="$4"
    local decision_report="$5"
    local started_at="$6"
    local completed_at="$7"
    local hashtags="$8"
    local results_dir="$9"
    local task_output_file="${10}"

    # Determine status from exit code
    local status
    if [ "$exit_code" -eq 0 ]; then
        status="completed"
    elif [ "$exit_code" -eq 124 ]; then
        status="timeout"
    else
        status="failed"
    fi

    # Calculate duration
    local start_epoch end_epoch duration_seconds
    start_epoch=$(date -d "$started_at" +%s 2>/dev/null || echo 0)
    end_epoch=$(date -d "$completed_at" +%s 2>/dev/null || echo 0)
    duration_seconds=$(( end_epoch - start_epoch ))
    if [ "$duration_seconds" -lt 0 ]; then
        duration_seconds=0
    fi

    # Extract files_changed from task output (Edit/Write tool patterns)
    local files_changed="[]"
    if [ -f "$task_output_file" ] && [ -s "$task_output_file" ]; then
        # Look for file paths in Edit/Write tool invocations
        local changed_files
        changed_files=$(grep -oP '(?:file_path|file)["\s:=]+["'"'"']?\K[/][^\s"'"'"',}]+' "$task_output_file" 2>/dev/null | sort -u || true)
        if [ -n "$changed_files" ]; then
            files_changed=$(echo "$changed_files" | jq -R . 2>/dev/null | jq -s . 2>/dev/null || echo "[]")
        fi
    fi

    # Parse hashtags into JSON array
    local hashtags_json="[]"
    if [ -n "$hashtags" ]; then
        hashtags_json=$(echo "$hashtags" | tr ' ' '\n' | grep -E '^#' | jq -R . 2>/dev/null | jq -s . 2>/dev/null || echo "[]")
    fi

    # Generate result.json
    local result_dir="${results_dir}/${task_name}"
    mkdir -p "$result_dir"
    local result_file="${result_dir}/result.json"

    if command -v jq &>/dev/null; then
        jq -n \
            --arg task_name "$task_name" \
            --arg agent "$agent" \
            --arg status "$status" \
            --argjson exit_code "$exit_code" \
            --arg summary "$summary" \
            --arg decision_report "$decision_report" \
            --argjson duration_seconds "$duration_seconds" \
            --argjson files_changed "$files_changed" \
            --arg started_at "$started_at" \
            --arg completed_at "$completed_at" \
            --argjson hashtags "$hashtags_json" \
            '{
                task_name: $task_name,
                agent: $agent,
                status: $status,
                exit_code: $exit_code,
                summary: $summary,
                decision_report: $decision_report,
                duration_seconds: $duration_seconds,
                files_changed: $files_changed,
                started_at: $started_at,
                completed_at: $completed_at,
                hashtags: $hashtags
            }' > "$result_file"
    else
        # Sanitize task_name for JSON safety
        local safe_task_name=$(echo "$task_name" | tr -d '"\\')
        cat > "$result_file" <<RESULT_EOF
{
  "task_name": "${safe_task_name}",
  "agent": "${agent}",
  "status": "${status}",
  "exit_code": ${exit_code},
  "summary": $(printf '%s' "$summary" | python3 -c 'import sys,json; print(json.dumps(sys.stdin.read()))' 2>/dev/null || echo "\"${summary}\""),
  "decision_report": $(printf '%s' "$decision_report" | python3 -c 'import sys,json; print(json.dumps(sys.stdin.read()))' 2>/dev/null || echo "\"\""),
  "duration_seconds": ${duration_seconds},
  "files_changed": ${files_changed},
  "started_at": "${started_at}",
  "completed_at": "${completed_at}",
  "hashtags": ${hashtags_json}
}
RESULT_EOF
    fi

    echo "$result_file"
}

# ============== A5: Single task dispatch function ==============
dispatch_single_task() {
    local task_name="$1"
    local agent="$2"
    local prompt="$3"
    local timeout_min="$4"
    local is_parallel="${5:-false}"

    # Validate agent
    if [[ ! -v AGENT_BINS[$agent] ]]; then
        echo "Error: Unknown agent '$agent'. Supported: ${!AGENT_BINS[*]}" >&2
        return 1
    fi

    local agent_bin="${AGENT_BINS[$agent]}"
    local telegram_group="${AGENT_TELEGRAM_GROUPS[$agent]}"
    local agent_name="${AGENT_DISPLAY_NAMES[$agent]}"
    local results_dir="${AGENT_RESULTS_DIRS[$agent]}"

    # Verify agent binary exists
    if [ ! -x "$agent_bin" ]; then
        echo "Error: Agent binary not found or not executable: $agent_bin" >&2
        return 1
    fi

    local success_notified=false
    local started_at
    started_at=$(date -Iseconds)

    # ---- Notify TG: Task Started ----
    if [ "$is_parallel" = "false" ]; then
        local START_MSG="🚀 *${agent_name} 任務開始*

📋 任務: \`${task_name}\`
📝 描述: ${prompt:0:200}...
⏱️ Timeout: ${timeout_min}m

⏳ ${agent_name} 執行中..."
        send_telegram "$START_MSG" "$telegram_group"
    fi

    # ---- Store Task Start in Memory ----
    store_memory "task.${task_name}.status" "started"
    store_memory "task.${task_name}.agent" "$agent"
    store_memory "task.${task_name}.prompt" "${prompt:0:500}"

    # ---- Prepare Workspace ----
    echo "📤 Dispatching to ${agent_name} (foreground)..."
    echo "   Agent: $agent"
    echo "   Task: $task_name"
    echo "   Group: $telegram_group"
    echo "   Timeout: ${timeout_min}m"

    # Create a temporary working directory
    local temp_workdir
    temp_workdir=$(mktemp -d)
    echo "Created temporary workdir: $temp_workdir"

    # Write task-meta.json for hooks
    local task_meta="${results_dir}/task-meta.json"
    mkdir -p "$(dirname "$task_meta")"
    jq -n \
      --arg task_name "$task_name" \
      --arg agent "$agent" \
      --arg telegram_group "$telegram_group" \
      --arg timestamp "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" \
      --arg prompt "${prompt:0:500}" \
      '{task_name: $task_name, agent: $agent, telegram_group: $telegram_group, timestamp: $timestamp, prompt: $prompt}' \
      > "$task_meta"

    # Task output file (per-task subdirectory to avoid collisions in parallel mode)
    mkdir -p "${results_dir}/${task_name}"
    local task_output="${results_dir}/${task_name}/task-output.txt"
    local task_stderr="${results_dir}/${task_name}/task-stderr.txt"

    # ---- Prepare Prompt with Report Format ----
    local tw_date
    tw_date=$(TZ='Asia/Taipei' date +%Y-%m-%d)

    local full_prompt="${prompt}

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
#openclaw #${tw_date} #${agent} [其他相關標籤，如 #skill #notion #api #debug 等]"

    # Write prompt to temp file to avoid shell escaping issues
    local prompt_file
    prompt_file=$(mktemp)
    printf '%s' "$full_prompt" > "$prompt_file"

    # ---- Execute Agent ----
    # A4: Export incremented dispatch depth
    export DISPATCH_DEPTH=$((DISPATCH_DEPTH + 1))

    cd "${temp_workdir}"

    local agent_pid=""

    # Cleanup function for graceful termination
    local_cleanup() {
        local exit_code=$?
        echo "[dispatch] Received signal, cleaning up task ${task_name}..."

        # Kill agent if still running
        if [ -n "${agent_pid:-}" ] && kill -0 "$agent_pid" 2>/dev/null; then
            kill "$agent_pid" 2>/dev/null || true
            wait "$agent_pid" 2>/dev/null || true
        fi

        # Update status to interrupted
        sed -i 's/"status": "running"/"status": "interrupted"/' "$task_meta" 2>/dev/null || true

        # Generate result.json for interrupted task
        local completed_at_int
        completed_at_int=$(date -Iseconds)
        generate_result_json "$task_name" "$agent" "130" \
            "任務被中斷" "" "$started_at" "$completed_at_int" \
            "" "$results_dir" "$task_output" >/dev/null 2>&1 || true

        # Send TG notification about interruption
        if [ "$success_notified" = "false" ]; then
            send_telegram "⚠️ *${agent_name} 任務中斷*

📋 任務: \`${task_name}\`
📝 原因: 進程被終止或接收到中斷訊號" "$telegram_group"
            success_notified=true
        fi

        return $exit_code
    }

    # Only set trap for non-parallel mode (parallel handles its own cleanup)
    if [ "$is_parallel" = "false" ]; then
        trap local_cleanup SIGTERM SIGINT SIGHUP
    fi

    # Agent-specific execution with timeout (A3)
    local agent_exit_code=0
    case "$agent" in
        claude)
            timeout "${timeout_min}m" "${agent_bin}" -p - --permission-mode bypassPermissions < "$prompt_file" > "$task_output" 2>"$task_stderr" &
            agent_pid=$!
            ;;
        gemini)
            export GOG_KEYRING_PASSWORD=$(gcloud secrets versions access latest --secret=GOG_KEYRING_PASSWORD 2>/dev/null || echo "")
            timeout "${timeout_min}m" "${agent_bin}" -p - -y \
                --include-directories "$HOME/.openclaw" \
                --include-directories "$HOME/.gemini" \
                --include-directories "$HOME/Telegram-Gemini-Bot" \
                --include-directories "/tmp" \
                < "$prompt_file" > "$task_output" 2>"$task_stderr" &
            agent_pid=$!
            ;;
        *)
            echo "Error: No execution handler for agent '$agent'" >&2
            rm -f "$prompt_file"
            return 1
            ;;
    esac

    echo "[dispatch] Agent PID: $agent_pid, output: $task_output"

    # Wait for agent to complete
    wait "$agent_pid" && agent_exit_code=0 || agent_exit_code=$?

    # Clear trap after successful completion
    if [ "$is_parallel" = "false" ]; then
        trap - SIGTERM SIGINT SIGHUP
    fi

    cd - >/dev/null

    # Cleanup prompt file
    rm -f "$prompt_file"

    # Read output from file for processing
    local agent_full_output
    agent_full_output=$(cat "$task_output" 2>/dev/null || echo "")

    # ---- Extract Summary, Decision Report, and Hashtags ----
    local summary decision_report agent_hashtags

    summary=$(echo "$agent_full_output" | sed -n '/^## 摘要/,/^---/p' | sed '1d;/^---/d' | head -c 100 | tr '\n' ' ')
    if [ -z "$summary" ]; then
        summary="任務已完成（無摘要）"
    fi

    decision_report=$(echo "$agent_full_output" | sed -n '/^## 決策報告/,/^## 摘要/p' | sed '1d;/^## 摘要/d')
    if [ -z "$decision_report" ]; then
        decision_report="（無決策報告）"
    fi

    agent_hashtags=$(echo "$agent_full_output" | grep -E "^#openclaw" | tail -1 || true)
    if [ -z "$agent_hashtags" ]; then
        agent_hashtags=$(generate_hashtags "$task_name" "$prompt" "$agent")
    fi

    # ---- A1: Generate result.json ----
    local completed_at
    completed_at=$(date -Iseconds)
    local result_json_path
    result_json_path=$(generate_result_json "$task_name" "$agent" "$agent_exit_code" \
        "$summary" "$decision_report" "$started_at" "$completed_at" \
        "$agent_hashtags" "$results_dir" "$task_output")
    echo "[dispatch] result.json saved: $result_json_path"

    # ---- Save Decision Report as Markdown ----
    local reports_dir="/home/jerryyrliu/.openclaw/workspace/reports/decisions"
    mkdir -p "$reports_dir"

    local report_date report_time report_file
    report_date=$(date +%Y-%m-%d)
    report_time=$(date +%H:%M:%S)
    report_file="${reports_dir}/${task_name}.md"

    local status_text_md
    if [ "$agent_exit_code" -eq 0 ]; then
        status_text_md="completed"
    elif [ "$agent_exit_code" -eq 124 ]; then
        status_text_md="timeout"
    else
        status_text_md="failed"
    fi

    cat > "$report_file" <<REPORT_EOF
---
task: ${task_name}
agent: ${agent}
status: ${status_text_md}
date: ${report_date}
time: ${report_time}
tags:
  - decision-report
  - ${agent}
---

# ${task_name}

## 任務資訊
- **Agent**: ${agent_name}
- **日期**: ${report_date} ${report_time}
- **狀態**: $([ "$agent_exit_code" -eq 0 ] && echo "✅ 完成" || ([ "$agent_exit_code" -eq 124 ] && echo "⏱️ 超時" || echo "❌ 失敗"))

## 任務描述
${prompt:0:1000}

## 決策報告
${decision_report}

## 摘要
${summary}

---
${agent_hashtags}
REPORT_EOF

    echo "[dispatch] Decision report saved: $report_file"

    # Copy to Google Drive (via rclone mount)
    local gdrive_dir="$HOME/gdrive/01_Obsidian/03_decisions"
    if [ -d "$gdrive_dir" ]; then
        cp "$report_file" "$gdrive_dir/" && \
            echo "[dispatch] Copied to ~/gdrive/: ${task_name}.md" || \
            echo "[dispatch] GDrive copy failed (non-critical)"
    fi

    # ---- Store Completion in Memory ----
    if [ "$agent_exit_code" -eq 0 ]; then
        store_memory "task.${task_name}.status" "completed"
    elif [ "$agent_exit_code" -eq 124 ]; then
        store_memory "task.${task_name}.status" "timeout"
    else
        store_memory "task.${task_name}.status" "failed"
    fi
    store_memory "task.${task_name}.summary" "$summary"
    store_memory "task.${task_name}.decision_report" "${decision_report:0:2000}"

    # ---- Notify TG: Task Completed (single mode only) ----
    if [ "$is_parallel" = "false" ]; then
        local status_emoji status_text
        if [ "$agent_exit_code" -eq 0 ]; then
            status_emoji="✅"
            status_text="完成"
        elif [ "$agent_exit_code" -eq 124 ]; then
            status_emoji="⏱️"
            status_text="超時 (timeout: ${timeout_min}m)"
        else
            status_emoji="❌"
            status_text="失敗 (exit code: $agent_exit_code)"
        fi

        local end_msg="${status_emoji} *${agent_name} 任務${status_text}*

📋 任務: \`${task_name}\`
📝 摘要: ${summary}"

        send_telegram "$end_msg" "$telegram_group" && success_notified=true

        # Update task-meta status
        sed -i 's/"status": "running"/"status": "done"/' "$task_meta" 2>/dev/null || true

        echo ""
        echo "${status_emoji} Task ${task_name} ${status_text}"
        echo "   Agent: ${agent_name}"
        echo "   Summary: $summary"
    fi

    # Cleanup temp workdir
    rm -rf "$temp_workdir" 2>/dev/null || true

    return $agent_exit_code
}

# ============== A5: Parallel Mode ==============
if [ "$PARALLEL_MODE" = "true" ]; then
    if [ ${#PARALLEL_TASKS[@]} -eq 0 ]; then
        echo "Error: --parallel requires at least one --task argument" >&2
        echo "Format: --task \"task-name:agent:prompt\"" >&2
        exit 1
    fi

    if [ ${#PARALLEL_TASKS[@]} -gt $MAX_PARALLEL ]; then
        echo "Error: Max $MAX_PARALLEL parallel tasks allowed, got ${#PARALLEL_TASKS[@]}" >&2
        exit 1
    fi

    echo "🚀 Parallel dispatch mode: ${#PARALLEL_TASKS[@]} tasks"

    # Send consolidated start notification
    PARALLEL_START_MSG="🚀 *並行任務開始* (${#PARALLEL_TASKS[@]} tasks)
"
    declare -a TASK_NAMES=()
    declare -a TASK_AGENTS=()
    declare -a TASK_PIDS=()

    for task_spec in "${PARALLEL_TASKS[@]}"; do
        # Parse "name:agent:prompt" format
        t_name=$(echo "$task_spec" | cut -d: -f1)
        t_agent=$(echo "$task_spec" | cut -d: -f2)
        t_prompt=$(echo "$task_spec" | cut -d: -f3-)

        if [ -z "$t_name" ] || [ -z "$t_agent" ] || [ -z "$t_prompt" ]; then
            echo "Error: Invalid task spec '$task_spec'. Format: 'name:agent:prompt'" >&2
            exit 1
        fi

        TASK_NAMES+=("$t_name")
        TASK_AGENTS+=("$t_agent")
        PARALLEL_START_MSG="${PARALLEL_START_MSG}
📋 \`${t_name}\` → ${t_agent}"
    done

    # Use claude telegram group as default for parallel notifications
    PARALLEL_TG_GROUP="${AGENT_TELEGRAM_GROUPS[claude]}"
    send_telegram "$PARALLEL_START_MSG" "$PARALLEL_TG_GROUP"

    # Launch tasks in parallel
    for i in "${!PARALLEL_TASKS[@]}"; do
        task_spec="${PARALLEL_TASKS[$i]}"
        t_name=$(echo "$task_spec" | cut -d: -f1)
        t_agent=$(echo "$task_spec" | cut -d: -f2)
        t_prompt=$(echo "$task_spec" | cut -d: -f3-)

        echo "[parallel] Starting task $t_name ($t_agent)..."
        dispatch_single_task "$t_name" "$t_agent" "$t_prompt" "$TIMEOUT_MIN" "true" &
        TASK_PIDS+=($!)
    done

    # Wait for all tasks
    declare -a TASK_EXIT_CODES=()
    for i in "${!TASK_PIDS[@]}"; do
        wait "${TASK_PIDS[$i]}" && _exit=0 || _exit=$?
        TASK_EXIT_CODES+=($_exit)
    done

    # Generate parallel-summary.json by reading all result.json files
    PARALLEL_SUMMARY_DIR="/home/jerryyrliu/claude-code-hooks/data/parallel-results"
    mkdir -p "$PARALLEL_SUMMARY_DIR"
    PARALLEL_ID="parallel-$(date +%Y%m%d-%H%M%S)"
    PARALLEL_SUMMARY_FILE="${PARALLEL_SUMMARY_DIR}/${PARALLEL_ID}.json"
    PARALLEL_RESULTS_DIR="$PARALLEL_SUMMARY_DIR"

    # Calculate total duration
    TOTAL_DURATION=0

    # Collect all result.json files
    local result_files=()
    for task_spec in "${PARALLEL_TASKS[@]}"; do
        local t_name=$(echo "$task_spec" | cut -d: -f1)
        local t_agent=$(echo "$task_spec" | cut -d: -f2)
        local t_results_dir="${AGENT_RESULTS_DIRS[$t_agent]}"
        local t_result="${t_results_dir}/${t_name}/result.json"
        if [ -f "$t_result" ]; then
            result_files+=("$t_result")
        fi
    done

    if [ ${#result_files[@]} -gt 0 ]; then
        jq -n \
          --argjson results "$(jq -s '.' "${result_files[@]}")" \
          --arg total_duration "$TOTAL_DURATION" \
          --arg completed "$(echo "${TASK_EXIT_CODES[@]}" | tr ' ' '\n' | grep -c '^0$')" \
          --arg total "${#PARALLEL_TASKS[@]}" \
          '{total_tasks: ($total|tonumber), completed: ($completed|tonumber), failed: (($total|tonumber) - ($completed|tonumber)), total_duration_seconds: ($total_duration|tonumber), results: $results}' \
          > "${PARALLEL_RESULTS_DIR}/parallel-summary.json"
        # Also save with the unique ID
        cp "${PARALLEL_RESULTS_DIR}/parallel-summary.json" "$PARALLEL_SUMMARY_FILE"
    fi

    echo "[parallel] Summary saved: $PARALLEL_SUMMARY_FILE"

    # Send consolidated TG notification
    PARALLEL_END_MSG="📊 *並行任務完成* (${#PARALLEL_TASKS[@]} tasks)
"
    ALL_OK=true
    for i in "${!TASK_NAMES[@]}"; do
        t_name="${TASK_NAMES[$i]}"
        t_agent="${TASK_AGENTS[$i]}"
        t_exit="${TASK_EXIT_CODES[$i]:-1}"
        t_results_dir="${AGENT_RESULTS_DIRS[$t_agent]}"
        t_result_file="${t_results_dir}/${t_name}/result.json"

        t_status=""
        t_summary_text=""
        if [ -f "$t_result_file" ] && command -v jq &>/dev/null; then
            t_status=$(jq -r '.status' "$t_result_file" 2>/dev/null || echo "unknown")
            t_summary_text=$(jq -r '.summary' "$t_result_file" 2>/dev/null || echo "")
        else
            if [ "$t_exit" -eq 0 ]; then t_status="completed"; else t_status="failed"; fi
            t_summary_text=""
        fi

        t_emoji=""
        case "$t_status" in
            completed) t_emoji="✅";;
            timeout)   t_emoji="⏱️"; ALL_OK=false;;
            *)         t_emoji="❌"; ALL_OK=false;;
        esac

        PARALLEL_END_MSG="${PARALLEL_END_MSG}
${t_emoji} \`${t_name}\` (${t_agent}): ${t_status}"
        if [ -n "$t_summary_text" ]; then
            PARALLEL_END_MSG="${PARALLEL_END_MSG}
   ${t_summary_text:0:80}"
        fi
    done

    send_telegram "$PARALLEL_END_MSG" "$PARALLEL_TG_GROUP"

    # Exit with non-zero if any task failed
    if [ "$ALL_OK" = "false" ]; then
        exit 1
    fi
    exit 0
fi

# ============== Single Task Mode (original flow) ==============

# ---- Validate Arguments ----
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

# ---- Internal State ----
SUCCESS_NOTIFIED=false

# Global exit handler for crashes/unexpected exits
exit_handler() {
    local exit_code=$?
    local agent_name="${AGENT_DISPLAY_NAMES[$AGENT]}"
    local telegram_group="${AGENT_TELEGRAM_GROUPS[$AGENT]}"
    if [ "$exit_code" -ne 0 ] && [ "$SUCCESS_NOTIFIED" = "false" ]; then
        send_telegram "❌ *${agent_name} 系統錯誤*

📋 任務: \`${TASK_NAME}\`
⚠️ 腳本異常退出 (Exit code: $exit_code)。請檢查日誌 \`~/.openclaw/workspace/logs/${AGENT}-bot-error.log\`" "$telegram_group"
        store_memory "task.${TASK_NAME}.status" "crashed"
    fi
}
trap exit_handler EXIT

# Dispatch the single task
dispatch_single_task "$TASK_NAME" "$AGENT" "$PROMPT" "$TIMEOUT_MIN" "false"
TASK_EXIT=$?

SUCCESS_NOTIFIED=true

exit $TASK_EXIT
