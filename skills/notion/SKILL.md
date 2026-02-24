---
name: notion
description: Advanced Notion integration for OpenClaw. Synchronizes usage reports and creates project tasks using standardized schemas.
metadata:
  {
    "openclaw": { "emoji": "📝" },
  }
---

# Notion Skill (OpenClaw Edition)

This skill provides a standardized bridge between OpenClaw and the **ErXia Hub 2.0** Dashboard in Notion.

## 🔧 Automation Tools

| Tool | Language | Purpose | Usage |
|------|----------|---------|-------|
| `notion-sync.js` | Node.js | Syncs reports and tasks to the central database. | `node scripts/notion-sync.js <type> <title> <agent>` |

## 🚀 Common Tasks

### 1. Query Tasks
List all tasks or filter by status:
```bash
node scripts/notion-sync.js query                           # 列出所有項目
node scripts/notion-sync.js query "⏳ 進行中 (In Progress)" # 篩選進行中
node scripts/notion-sync.js query "未開始" "Task"           # 篩選特定狀態+類型
```

### 2. Create a Development Task
Quickly log a task for an agent:
```bash
node scripts/notion-sync.js task "Refactor auth logic" "貳俠" "High" "進行中"
```

### 3. Sync a Usage Report
After running a monitor, push the results to Notion:
```bash
node scripts/notion-sync.js report "[AUTO] Weekly Stats" "Gemini"
```

## 📋 Database Standards (ErXia Hub 2.0)

When using this skill, the following fields are automatically managed:
- **`Name`**: Title of the entry.
- **`Type`**: Automatically set based on the action (`Task` or `Report`).
- **`Agent`**: Mapped to `貳俠`, `小序`, `Gemini`, or `Claude`.
- **`Priority`**: (For tasks) `High`, `Medium`, or `Low`.
- **`Status`**: Task status (e.g., `進行中`, `已完成`, `未開始`).

## 🔐 Setup
API key is automatically fetched from GCP Secret Manager (`NOTION_OPENCLAW_KEY`).
Falls back to `NOTION_API_KEY` environment variable if set.

---
*Maintained by the OpenClaw Engineering Team.*
