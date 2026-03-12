#!/bin/bash
# Weekly memory consolidation - run every Sunday
# Consolidates facts from the past week into topic files
# Uploads to Google Drive
#
# Cron: 0 4 * * 0 /path/to/weekly-consolidation.sh >> /path/to/pipeline_weekly.log 2>&1

set -euo pipefail

SCRIPT_DIR=$(dirname "$0")
cd "$SCRIPT_DIR/.."

# Google Drive config (via rclone mount)
GDRIVE_TOPICS_DIR="$HOME/gdrive/01_Obsidian/09_weekly-topics"
TOPICS_DIR="$SCRIPT_DIR/../topics"

echo "--- Weekly consolidation at $(date) ---"

# Step 7: Consolidate current week snapshot
echo "Step 7: Weekly snapshot..."
node src/7-consolidate-weekly.js

# Also consolidate previous week if we're early in the week (Mon-Wed)
DOW=$(date +%u)
if [ "$DOW" -le 3 ]; then
    LAST_WEEK=$(date -d "last week" +%Y-W%V)
    echo "Also consolidating previous week: $LAST_WEEK"
    node src/7-consolidate-weekly.js --week "$LAST_WEEK"
fi

# Step 8: Update rolling topic files (cross-week view)
echo "Step 8: Rolling topics..."
node src/8-update-rolling-topics.js

# Step 9: Copy topics to Google Drive (via rclone mount)
echo "Step 9: Syncing topics to Google Drive..."
if [ -d "$TOPICS_DIR" ] && [ -d "$GDRIVE_TOPICS_DIR" ]; then
    for file in "$TOPICS_DIR"/*.md; do
        [ -f "$file" ] || continue
        filename=$(basename "$file")
        echo "  Copying: $filename"
        cp "$file" "$GDRIVE_TOPICS_DIR/$filename" && echo "    ✓ copied" || echo "    ✗ failed"
    done
else
    echo "  Topics or GDrive mount not available"
fi

echo "--- Done at $(date) ---"
