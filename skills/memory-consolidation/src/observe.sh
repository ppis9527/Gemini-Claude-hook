#!/bin/bash
# Memory Consolidation - Tool Use Observation Hook
#
# Captures tool use events for pattern analysis.
# Zero token cost - just writes to JSONL.
#
# Hook config (in ~/.claude/settings.json):
# {
#   "hooks": {
#     "PreToolUse": [{
#       "matcher": "*",
#       "hooks": [{ "type": "command", "command": "/path/to/observe.sh pre", "timeout": 3000 }]
#     }],
#     "PostToolUse": [{
#       "matcher": "*",
#       "hooks": [{ "type": "command", "command": "/path/to/observe.sh post", "timeout": 3000 }]
#     }]
#   }
# }

set -e

# Hook phase: "pre" or "post"
HOOK_PHASE="${1:-post}"

# Output directory
MEMORY_ROOT="${HOME}/.openclaw/workspace/skills/memory-consolidation"
OBSERVATIONS_FILE="${MEMORY_ROOT}/observations.jsonl"
MAX_FILE_SIZE_MB=10

# Read JSON from stdin
INPUT_JSON=$(cat)

# Exit if no input
if [ -z "$INPUT_JSON" ]; then
  exit 0
fi

# Parse and write observation
timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

echo "$INPUT_JSON" | HOOK_PHASE="$HOOK_PHASE" TIMESTAMP="$timestamp" python3 -c '
import json
import sys
import os

try:
    data = json.load(sys.stdin)
    hook_phase = os.environ.get("HOOK_PHASE", "post")
    timestamp = os.environ.get("TIMESTAMP", "")

    event = "tool_start" if hook_phase == "pre" else "tool_complete"

    # Extract fields from Claude Code hook format
    tool_name = data.get("tool_name", data.get("tool", "unknown"))
    tool_input = data.get("tool_input", data.get("input", {}))
    tool_output = data.get("tool_output", data.get("tool_response", data.get("output", "")))
    session_id = data.get("session_id", "unknown")

    # Truncate large values
    if isinstance(tool_input, dict):
        tool_input_str = json.dumps(tool_input)[:3000]
    else:
        tool_input_str = str(tool_input)[:3000]

    if isinstance(tool_output, dict):
        tool_output_str = json.dumps(tool_output)[:3000]
    else:
        tool_output_str = str(tool_output)[:3000]

    observation = {
        "timestamp": timestamp,
        "event": event,
        "tool": tool_name,
        "session": session_id
    }

    if event == "tool_start" and tool_input_str:
        observation["input"] = tool_input_str
    if event == "tool_complete" and tool_output_str:
        observation["output"] = tool_output_str

    print(json.dumps(observation))
except Exception as e:
    # Silent fail - do not block Claude
    pass
' >> "$OBSERVATIONS_FILE" 2>/dev/null || true

# Archive if file too large
if [ -f "$OBSERVATIONS_FILE" ]; then
  file_size_mb=$(du -m "$OBSERVATIONS_FILE" 2>/dev/null | cut -f1 || echo "0")
  if [ "${file_size_mb:-0}" -ge "$MAX_FILE_SIZE_MB" ]; then
    archive_dir="${MEMORY_ROOT}/observations.archive"
    mkdir -p "$archive_dir"
    mv "$OBSERVATIONS_FILE" "$archive_dir/observations-$(date +%Y%m%d-%H%M%S).jsonl"
  fi
fi

exit 0
