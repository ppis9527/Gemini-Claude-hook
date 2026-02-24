#!/bin/bash
# Weekly memory consolidation - run every Sunday
# Consolidates facts from the past week into topic files
# Uploads to Google Drive
#
# Cron: 0 4 * * 0 /path/to/weekly-consolidation.sh >> /path/to/pipeline_weekly.log 2>&1

set -euo pipefail

SCRIPT_DIR=$(dirname "$0")
cd "$SCRIPT_DIR/.."

# Google Drive config
GDRIVE_TOPICS_FOLDER="1YD9gcsjespruhqli5Sk-DdRYne9TDrNu"
GOG_ACCOUNT="jerryyrliu@gmail.com"
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

# Step 9: Upload topics to Google Drive
echo "Step 9: Uploading topics to Google Drive..."
if [ -d "$TOPICS_DIR" ]; then
    # Get GOG password
    GOG_PASSWORD=$(gcloud secrets versions access latest --secret=GOG_KEYRING_PASSWORD 2>/dev/null || echo "")

    if [ -n "$GOG_PASSWORD" ]; then
        # Upload each .md file in topics/
        for file in "$TOPICS_DIR"/*.md; do
            [ -f "$file" ] || continue
            filename=$(basename "$file")
            echo "  Uploading: $filename"
            GOG_KEYRING_PASSWORD="$GOG_PASSWORD" gog drive upload "$file" \
                --parent "$GDRIVE_TOPICS_FOLDER" \
                --account "$GOG_ACCOUNT" \
                --name "$filename" 2>/dev/null && echo "    ✓ uploaded" || echo "    ✗ failed"
        done
    else
        echo "  Warning: No GOG password, skipping upload"
    fi
else
    echo "  No topics directory yet"
fi

echo "--- Done at $(date) ---"
