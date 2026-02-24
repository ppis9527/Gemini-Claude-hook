#!/bin/bash
# Updates cron-list.txt from actual crontab
CRON_FILE=~/.openclaw/workspace/system/cron-list.txt

echo "# Cron Jobs for $(whoami)" > $CRON_FILE
echo "# Last updated: $(date '+%Y-%m-%d %H:%M:%S')" >> $CRON_FILE
echo "" >> $CRON_FILE
crontab -l >> $CRON_FILE 2>/dev/null
