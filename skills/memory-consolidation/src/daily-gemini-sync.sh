#!/bin/bash
# daily-gemini-sync.sh - Extract facts from Gemini sessions to memory DB
# Run via cron daily at 3am: 0 3 * * * ~/.openclaw/workspace/skills/memory-consolidation/src/daily-gemini-sync.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MEMORY_DIR="$(dirname "$SCRIPT_DIR")"
LOG_FILE="$MEMORY_DIR/pipeline_gemini_cron.log"

# Load API key for Gemma dedup + embedding
export GOOGLE_API_KEY2="${GOOGLE_API_KEY2:-$(gcloud secrets versions access latest --secret=OPENCLAW_API_GOOGLE2 2>/dev/null || true)}"

echo "[$(date -Iseconds)] Starting daily Gemini sync..." >> "$LOG_FILE"

cd "$MEMORY_DIR"

if ./run_pipeline.sh --gemini >> "$LOG_FILE" 2>&1; then
    echo "[$(date -Iseconds)] Gemini pipeline completed successfully" >> "$LOG_FILE"
else
    echo "[$(date -Iseconds)] Gemini pipeline failed with exit code $?" >> "$LOG_FILE"
fi
