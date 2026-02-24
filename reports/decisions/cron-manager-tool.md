---
task: cron-manager-tool
agent: claude
status: completed
date: 2026-02-24
time: 13:40:00
tags:
  - decision-report
  - tool
  - cron
  - agents
---

# Cron Manager Tool

## 任務資訊
- **Agent**: Claude Code
- **日期**: 2026-02-24 13:40:00
- **狀態**: ✅ 完成

## 問題描述
小序無法直接使用 `crontab -l` 查看 cron 任務，可能因為 Gemini CLI sandbox 限制。需要讓 agents（貳俠/小序）能夠管理 cron 任務。

## 決策報告

### 1. 問題分析

**限制**：
- Gemini CLI 可能限制某些系統指令（如 `crontab`）
- 直接執行 `crontab -e` 需要互動式編輯器

**需求**：
- Agents 需要能列出、新增、刪除 cron 任務
- 需透過 `run_shell_command` 執行

### 2. 解決方案

建立 `cron-manager.sh` wrapper script：

| 指令 | 功能 |
|------|------|
| `list` | 列出所有任務 |
| `add "schedule cmd"` | 新增任務 |
| `remove "pattern"` | 刪除符合 pattern 的任務 |
| `disable "pattern"` | 停用任務（加註解） |
| `enable "pattern"` | 啟用任務（移除註解） |

### 3. 實作細節

**路徑**: `~/.openclaw/workspace/system/cron-manager.sh`

**使用方式**:
```bash
# 列出
cron-manager.sh list

# 新增（每天早上 9:30 執行）
cron-manager.sh add "30 9 * * * /path/to/script.sh"

# 刪除
cron-manager.sh remove "script.sh"

# 停用（不刪除）
cron-manager.sh disable "script.sh"

# 啟用
cron-manager.sh enable "script.sh"
```

### 4. 附加功能

- 自動更新 `cron-list.txt` 供讀取
- 操作後顯示確認訊息
- 支援 pattern matching 批次操作

### 5. 相關設定

同時完成的設定：
- 時區設為 `Asia/Taipei`（台灣時間）
- `.bashrc`, `.profile`, PM2, crontab 都已更新

## 摘要
建立 cron-manager.sh 讓 agents 透過 shell 管理 cron 任務，繞過 Gemini CLI sandbox 限制。
