# System Monitor

Daily system health monitoring with TG notifications.

## Features

- **Disk Space**: Warning at 75%, critical at 90%
- **Memory**: Usage monitoring
- **PM2 Services**: erxia-bot, xiaoxu-bot status
- **Memory DB**: Size and fact count
- **Cron Jobs**: Last run time check (stale if >24h)

## Outputs

- Local report: `~/.openclaw/workspace/reports/system-health/YYYY-MM-DD.md`
- Google Drive: `system-health-YYYY-MM-DD.md`
- TG notification: Only on issues (or with `--notify-always`)

## Usage

```bash
# Run manually
node system-health.js

# Force TG notification even if OK
node system-health.js --notify-always
```

## Cron Schedule

```
0 21 * * * TZ='Asia/Taipei' node ~/.openclaw/workspace/skills/system-monitor/system-health.js
```
(Runs at 5:00 AM Taiwan time / 21:00 UTC)

## Configuration

- TG Group: `-1003738302620`
- Google Drive Folder: `103KLvYwFVcVCYYEeDyRsuT39nDj5ct8E`
- TG Token: TELEGRAM_TOKEN_MAIN (gcloud secret)
