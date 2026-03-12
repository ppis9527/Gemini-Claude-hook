#!/bin/bash
# coding-agent-tgbot/status.sh
# Check status of a dispatched Claude Code task
#
# Usage: status.sh <task-name>

TASK_NAME="${1:-}"
MEMORY_CLI="/home/jerryyrliu/.openclaw/workspace/skills/memory-consolidation/cli/memory-cli.js"

if [ -z "$TASK_NAME" ]; then
    echo "Usage: status.sh <task-name>"
    echo ""
    echo "Recent tasks:"
    node "$MEMORY_CLI" search --prefix "task." 2>/dev/null | grep "\.status" | tail -5
    exit 1
fi

echo "📋 Task: $TASK_NAME"
echo ""

# Get status from memory
STATUS=$(node "$MEMORY_CLI" search --key "task.${TASK_NAME}.status" 2>/dev/null | grep -oP '(?<=: ).*' || echo "unknown")
echo "Status: $STATUS"

# Get PID
PID=$(node "$MEMORY_CLI" search --key "task.${TASK_NAME}.pid" 2>/dev/null | grep -oP '(?<=: ).*' || echo "")
if [ -n "$PID" ]; then
    if ps -p "$PID" > /dev/null 2>&1; then
        echo "Process: Running (PID $PID)"
    else
        echo "Process: Finished (was PID $PID)"
    fi
fi

# Check log file
LOG_FILE="/tmp/claude-code-${TASK_NAME}.log"
if [ -f "$LOG_FILE" ]; then
    echo ""
    echo "📄 Log (last 10 lines):"
    tail -10 "$LOG_FILE"
fi

# Get report if completed
if [ "$STATUS" = "completed" ]; then
    echo ""
    echo "📝 Report:"
    node "$MEMORY_CLI" search --key "task.${TASK_NAME}.report" 2>/dev/null
fi
