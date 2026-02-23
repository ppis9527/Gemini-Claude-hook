#!/bin/bash
# Weekly memory consolidation - run every Sunday
# Consolidates facts from the past week into topic files
#
# Cron: 0 4 * * 0 /path/to/weekly-consolidation.sh >> /path/to/pipeline_weekly.log 2>&1

set -euo pipefail

SCRIPT_DIR=$(dirname "$0")
cd "$SCRIPT_DIR/.."

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

echo "--- Done at $(date) ---"
