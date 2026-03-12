#!/bin/bash
# periodic-memory-sync.sh - Extract facts from OpenClaw sessions to memory DB
# Run via cron every 6 hours: 0 */6 * * * ~/.openclaw/workspace/skills/memory-consolidation/src/periodic-memory-sync.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MEMORY_DIR="$(dirname "$SCRIPT_DIR")"
LOG_FILE="$MEMORY_DIR/pipeline_cron.log"

echo "[$(date -Iseconds)] Starting periodic OpenClaw memory sync..." >> "$LOG_FILE"

cd "$MEMORY_DIR"

if ./run_pipeline.sh --backfill-all-openclaw-agents >> "$LOG_FILE" 2>&1; then
    echo "[$(date -Iseconds)] OpenClaw pipeline completed successfully" >> "$LOG_FILE"
else
    echo "[$(date -Iseconds)] OpenClaw pipeline failed with exit code $?" >> "$LOG_FILE"
fi
