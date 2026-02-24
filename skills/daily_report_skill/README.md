# Nightly Build Daily Report System

**Author:** 叩叩 (KouKou), Code Engineer  
**Architecture:** 駕駕 (The Architect)

## Overview

This is a production-ready **Nightly Build Daily Report System** designed to automate nightly tasks, generate comprehensive audit reports, and provide full reversibility for any write operations.

## System Architecture

```
┌─────────────────────────────────────────────────────┐
│                 Scheduler (Cron)                    │
│              Triggers @ 03:00 Daily                 │
└─────────────────────┬───────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────┐
│          Orchestrator (nightly_orchestrator.js)     │
│  • Loads configuration                              │
│  • Runs pre-flight checks                           │
│  • Executes task modules                            │
│  • Creates snapshots for write operations           │
│  • Generates Markdown report                        │
│  • Performs cleanup                                 │
└─────────────────────┬───────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────┐
│            Task Modules (tasks/*.js)                │
│  • Isolated, modular workers                        │
│  • Return standardized results                      │
│  • Provide rollback commands                        │
└─────────────────────┬───────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────┐
│         Output (workspace/briefings/*.md)           │
│  • Daily Markdown reports                           │
│  • Audit trails                                     │
│  • Rollback instructions                            │
│  • Diff outputs                                     │
└─────────────────────────────────────────────────────┘
```

## Directory Structure

```
daily_report_skill/
├── nightly_orchestrator.js   # Main orchestrator script
├── nightly_config.json        # Configuration file
├── tasks/                     # Task modules directory
│   └── system-health.js       # Example: System health check module
├── workspace/                 # Generated at runtime
│   ├── briefings/             # Daily Markdown reports
│   │   └── YYYY-MM-DD.md
│   └── snapshots/             # Backups before write operations
│       └── taskname_timestamp/
└── README.md                  # This file
```

## Quick Start

### 1. Installation

```bash
# No dependencies required - uses Node.js built-in modules only
node --version  # Ensure Node.js is installed (v12+)
```

### 2. Configuration

Edit `nightly_config.json` to enable/disable tasks:

```json
{
  "abort_on_preflight_failure": false,
  "enabled_tasks": [
    {
      "name": "system-health",
      "description": "Check system disk space and health metrics",
      "is_write_operation": false,
      "params": {}
    }
  ]
}
```

### 3. Run Manually

```bash
node nightly_orchestrator.js
```

### 4. Schedule with Cron

Add to your crontab (`crontab -e`):

```cron
# Run nightly build at 3:00 AM every day
0 3 * * * cd /path/to/daily_report_skill && /usr/bin/node nightly_orchestrator.js >> logs/nightly.log 2>&1
```

### 5. Review Reports

Reports are saved to `workspace/briefings/YYYY-MM-DD.md`

```bash
cat workspace/briefings/$(date +%Y-%m-%d).md
```

## Features

### ✅ Core Features

- **Modular Architecture**: Easy to add new task modules
- **Pre-Flight Checks**: System health validation before execution
- **Snapshot System**: Automatic backups before write operations
- **Audit Trails**: Complete logging of all operations
- **Rollback Commands**: Every write operation includes undo instructions
- **Diff Reporting**: Visual display of file changes
- **Error Handling**: Graceful failure with detailed error logs
- **Automatic Cleanup**: Old snapshots are pruned automatically (7-day retention)

### 📋 Report Sections

Each daily report includes:

1. **Pre-Flight Checks**: System health status
2. **Execution Summary**: Task statistics
3. **Audit Trail Table**: Module, Action, Outcome, Impact
4. **Detailed Results**: Logs, diffs, and rollback commands for each task

## Creating New Task Modules

Task modules are simple JavaScript files that export an `execute` function.

### Template

Create a new file in `tasks/your-task-name.js`:

```javascript
/**
 * Task Module: Your Task Name
 * Description: What this task does
 */

const { execSync } = require('child_process');

function execute(params = {}) {
    const logs = [];
    let status = 'success';
    
    try {
        logs.push('Starting task...');
        
        // Your task logic here
        
        logs.push('Task completed successfully');
        
    } catch (error) {
        status = 'error';
        logs.push(`Error: ${error.message}`);
    }
    
    return {
        status: status,              // 'success', 'error', or 'skipped'
        logs: logs,                  // Array of log messages
        diffs: null,                 // Array of diff strings (or null)
        rollback_command: null       // Shell command to reverse changes (or null)
    };
}

module.exports = { execute };
```

### Return Object Structure

All task modules MUST return an object with these fields:

| Field | Type | Description |
|-------|------|-------------|
| `status` | string | `'success'`, `'error'`, or `'skipped'` |
| `logs` | array | Array of log message strings |
| `diffs` | array or null | Array of diff output strings (for file changes) |
| `rollback_command` | string or null | Shell command to reverse the operation |

## Configuration Reference

### Main Config (`nightly_config.json`)

```json
{
  "abort_on_preflight_failure": false,
  "enabled_tasks": [...]
}
```

- **`abort_on_preflight_failure`**: If `true`, stop execution if pre-flight checks fail

### Task Configuration

```json
{
  "name": "task-module-name",
  "description": "Human-readable description",
  "is_write_operation": false,
  "target_resources": ["/path/to/file"],
  "params": {
    "key": "value"
  }
}
```

- **`name`**: Name of the task module file (without `.js`)
- **`description`**: Appears in audit trail
- **`is_write_operation`**: If `true`, creates snapshots before execution
- **`target_resources`**: Array of file/directory paths to snapshot
- **`params`**: Parameters passed to the task module's `execute()` function

## Included Example: System Health Check

The `system-health` module demonstrates best practices:

- Executes read-only operations (`df -h`, `uptime`, `free -h`)
- Provides detailed logging
- Analyzes disk usage and warns if >90% full
- Returns standardized result object

## Maintenance

### Snapshot Retention

Snapshots older than 7 days are automatically pruned during each run. To adjust:

Edit `nightly_orchestrator.js`:
```javascript
const SNAPSHOT_RETENTION_DAYS = 7;  // Change this value
```

### Log Rotation

The orchestrator outputs to stdout/stderr. Recommended to pipe to a log file and use `logrotate`:

```
/var/log/nightly_build.log {
    daily
    rotate 30
    compress
    missingok
    notifempty
}
```

## Troubleshooting

### Issue: Module not found error

**Symptom:** `Module not found: /path/to/tasks/taskname.js`

**Solution:** 
- Verify the task file exists in the `tasks/` directory
- Ensure the filename matches the `name` in `nightly_config.json` exactly
- File should be named `taskname.js` (not `taskname`)

### Issue: Invalid module response

**Symptom:** `Invalid module response: missing required fields`

**Solution:** 
- Ensure your task module returns an object with `status` and `logs` fields
- Use the template provided in this README

### Issue: Snapshots not created

**Symptom:** No snapshots in `workspace/snapshots/`

**Solution:**
- Set `is_write_operation: true` in task config
- Provide `target_resources` array with file paths
- Ensure paths exist and are readable

## Security Considerations

- **Snapshot Storage**: Snapshots may contain sensitive data. Ensure proper file permissions.
- **Rollback Commands**: Review before executing - they run with the orchestrator's permissions.
- **Task Modules**: Validate any external input to prevent command injection.
- **Report Storage**: Briefing reports may contain system information. Protect appropriately.

## Future Enhancements

Potential additions (not yet implemented):

- Email notifications on task failures
- Slack/webhook integrations for alerts
- Task dependencies (run task B only if task A succeeds)
- Parallel task execution
- Web dashboard for viewing reports
- Database logging in addition to Markdown reports

## License

This code is provided as-is for educational and production use.

## Credits

- **Architect:** 駕駕 (The Architect)
- **Engineer:** 叩叩 (KouKou), Code Engineer
- **Project:** Nightly Build Daily Report System

---

**Generated:** 2026-02-12  
**Version:** 1.0.0
