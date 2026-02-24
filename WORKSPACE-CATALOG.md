# 工作區目錄 / Workspace Catalog

**最後更新 / Last Updated**: 2026/2/24 下午8:04:36

---

## 技能 Skills (25)

AI 代理可使用的技能模組。
Skill modules available to AI agents.

| 名稱 Name | 說明 Description |
|-----------|------------------|
| `architecture` | > "Requirements drive architecture. Trade-offs inform decisions. ADRs capture rationale." |
| `brainstorming` | Turn raw ideas into **clear, validated designs and specifications** |
| `coding-agent` | Use **bash** (with optional background mode) for all coding agent work. Simple and effective. |
| `coding-agent-tgbot` | Dispatch coding tasks to Claude Code and receive results in Telegram. |
| `concise-planning` | Turn a user request into a **single, actionable plan** with atomic steps. |
| `custom-model-manager` | This skill helps you add new AI models to OpenClaw's configuration. It supports any OpenAI-compatibl... |
| `daily_report_skill` | **Author:** 叩叩 (KouKou), Code Engineer |
| `email-report-tool` | This tool converts the daily `memory/YYYY-MM-DD.md` log into a readable HTML format and sends it to ... |
| `ethical-hacking-methodology` | Master the complete penetration testing lifecycle from reconnaissance through reporting. This skill ... |
| `git-pushing` | Stage all changes, create a conventional commit, and push to the remote branch. |
| `github` | Use the `gh` CLI to interact with GitHub. Always specify `--repo owner/repo` when not in a git direc... |
| `lint-and-validate` | > **MANDATORY:** Run appropriate validation tools after EVERY code change. Do not finish a task unti... |
| `memory-consolidation` | Memory consolidation system for OpenClaw - processes and digests memory entries. |
| `memory-control` | Standalone context compression skill for Gemini CLI. |
| `notion` | This skill provides a standardized bridge between OpenClaw and the **ErXia Hub 2.0** Dashboard in No... |
| `security-expert` | Expert security auditor and analyst specializing in modern DevSecOps, 2025 vulnerability landscape (... |
| `senior-engineer-workflow` | This workflow orchestrates four specialized skills to transform vague ideas into high-quality produc... |
| `skill-creator` | This skill provides guidance for creating effective skills. |
| `summarize` | Fast CLI to summarize URLs, local files, and YouTube links. |
| `system-monitor` | Daily system health monitoring with TG notifications. |
| `systematic-debugging` | Random fixes waste time and create new bugs. Quick patches mask underlying issues. |
| `test-driven-development` | Write the test first. Watch it fail. Write minimal code to pass. |
| `typescript-expert` | You are an advanced TypeScript expert with deep, practical knowledge of type-level programming, perf... |
| `usage-monitor` | This skill analyzes session logs to provide data-driven insights into your AI ecosystem's usage patt... |
| `vertex-proxy` | (no description) |

## 工具 Tools (5)

獨立腳本與工具程式。
Standalone scripts and utilities.

| 名稱 Name | 說明 Description |
|-----------|------------------|
| `daily-memory-digest.js` | Daily Memory Digest Generator |
| `generate-index.js` | Generate INDEX.md for OpenClaw Workspace |
| `github_trending_weekly.py` | GitHub Trending Weekly Report Generator (Robust Scraper Edition) |
| `load-secrets.sh` | Load all API keys and tokens from GCP Secret Manager into env vars. |
| `skill-usage-viz/` | Generates interactive HTML visualizations from usage-monitor Markdown reports. |

## 系統 System (3)

系統配置與管理腳本。
System configuration and management scripts.

| 名稱 Name | 說明 Description |
|-----------|------------------|
| `cron-list.txt` | Configuration file |
| `cron-manager.sh` | Cron Manager - 給 agents 用的 cron 管理工具 |
| `update-cron-list.sh` | Updates cron-list.txt from actual crontab |

## 報告 Reports (6)

自動產生的報告資料夾。
Auto-generated report directories.

| 名稱 Name | 說明 Description |
|-----------|------------------|
| `daily-digest/` | 每日摘要 / Daily digest (2 files) |
| `decisions/` | 決策紀錄 / Decision records (8 files) |
| `github_weekly/` | GitHub 每週趨勢 / GitHub weekly trends (1 files) |
| `openclaw-spec/` | OpenClaw 規格文件 / OpenClaw specifications (1 files) |
| `system-health/` | 系統健康報告 / System health reports (1 files) |
| `usage/` | Skill 使用統計報告 / Skill usage statistics (3 files) |

---

## 排程任務 Cron Jobs

定時執行的自動化任務。
Scheduled automation tasks.

```
TZ=Asia/Taipei

0 */6 * * * /home/jerryyrliu/.openclaw/workspace/skills/memory-consolidation/src/periodic-memory-sync.sh
0 */6 * * * /home/jerryyrliu/.openclaw/workspace/skills/memory-consolidation/src/daily-gemini-sync.sh
0 4 * * 0 /home/jerryyrliu/.openclaw/workspace/skills/memory-consolidation/src/weekly-consolidation.sh >> /home/jerryyrliu/.openclaw/workspace/skills/memory-consolidation/pipeline_weekly.log 2>&1
0 0 * * * ~/.openclaw/workspace/system/update-cron-list.sh
0 22 * * * TZ='Asia/Taipei' node /home/jerryyrliu/.openclaw/workspace/tools/daily-memory-digest.js >> /home/jerryyrliu/.openclaw/workspace/logs/daily-digest.log 2>&1
0 21 * * * TZ='Asia/Taipei' node /home/jerryyrliu/.openclaw/workspace/skills/system-monitor/system-health.js >> /home/jerryyrliu/.openclaw/workspace/logs/system-health.log 2>&1

```

---

## 雲端資料夾 Google Drive Folders

報告自動上傳的目標位置。
Destinations for automated report uploads.

| 報告類型 Report Type | Folder ID |
|---------------------|-----------|
| 每日摘要 Daily Digest | `1TFO2BI7HcZorHxze3PtaX5pJIfYWkIOW` |
| 決策紀錄 Decisions | `1kGbGb-OX_7Spms6dbRoSfYxL5AdImahK` |
| 系統健康 System Health | `103KLvYwFVcVCYYEeDyRsuT39nDj5ct8E` |
| 每週主題 Weekly Topics | `15AQdXxH1MxJHsGOWaowk-Flz8LiES22h` |
| 工作區目錄 Catalog | `1jw4yYI0P83FWZiF4_xBS1iGymNivO9EG` |

---
*由 generate-index.js 自動產生 / Auto-generated by generate-index.js*
