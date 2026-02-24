# Skill Usage Visualization Tool

Generates interactive HTML visualizations from usage-monitor Markdown reports.

## Features

- **Usage Distribution Chart** - Pie/doughnut chart showing skill usage proportions
- **Usage Comparison** - Stacked bar chart comparing OpenClaw vs Gemini CLI calls
- **Daily Trends** - Line chart showing usage over time (selectable skills)
- **Daily Breakdown** - Horizontal bar chart for specific date analysis
- **Skill Rankings** - Complete ranked list with call counts

## Usage

```bash
# Basic usage (uses default paths)
node generate.js

# Custom paths
node generate.js --reports /path/to/reports --output /path/to/output.html

# Help
node generate.js --help
```

## Default Paths

- **Reports Directory**: `~/.openclaw/workspace/reports/usage/`
- **Output File**: `~/.openclaw/workspace/reports/usage/skill-usage-viz.html`

## Report Format

The tool parses `USAGE_REPORT_YYYY-MM-DD.md` files and extracts data from the "Internal Skill Usage" table:

```markdown
## Internal Skill Usage (~/.openclaw/workspace/skills)

| Skill Name | Total | OpenClaw | Gemini CLI |
| :--- | ---: | ---: | ---: |
| **skill-name** | 10 | 3 | 7 |
```

## Output

A self-contained HTML file with embedded data and Chart.js visualizations. Open directly in any browser.
