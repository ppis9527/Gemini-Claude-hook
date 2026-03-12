#!/bin/bash
# process-staging.sh - Extract facts from PreCompress staged snapshots
# Processes one file at a time to avoid OOM on small VMs
# Run via cron: 0 */6 * * * /path/to/process-staging.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
STAGING_DIR="$(dirname "$SCRIPT_DIR")/staging"
LOG_FILE="$STAGING_DIR/process.log"

if [ ! -d "$STAGING_DIR" ]; then
    exit 0
fi

FILES=$(find "$STAGING_DIR" -name "precompress-*.json" -type f 2>/dev/null | sort | head -5)

if [ -z "$FILES" ]; then
    exit 0
fi

echo "[$(date -Iseconds)] Processing staged snapshots..." >> "$LOG_FILE"

for f in $FILES; do
    BASENAME=$(basename "$f")
    echo "[$(date -Iseconds)] Processing: $BASENAME" >> "$LOG_FILE"

    # Run extraction (single file, sequential)
    if echo "{\"session_path\": \"$f\"}" | node "$SCRIPT_DIR/gemini-session-extract.js" >> "$LOG_FILE" 2>&1; then
        # extract.js deletes the file on success via processStagedSnapshots
        # But if it was passed via stdin session_path, it won't auto-delete
        rm -f "$f" 2>/dev/null || true
        echo "[$(date -Iseconds)] Done: $BASENAME" >> "$LOG_FILE"
    else
        echo "[$(date -Iseconds)] Failed: $BASENAME (will retry next run)" >> "$LOG_FILE"
    fi

    # Brief pause between files to avoid memory spikes
    sleep 5
done

echo "[$(date -Iseconds)] Staging processing complete" >> "$LOG_FILE"
