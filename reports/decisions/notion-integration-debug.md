---
task: notion-integration-debug
agent: claude
status: completed
date: 2026-02-24
time: 05:30:00
tags:
  - decision-report
  - debug
  - notion
---

# Notion Integration Debug

## 任務資訊
- **Agent**: Claude Code
- **日期**: 2026-02-24 05:30:00
- **狀態**: ✅ 完成

## 問題描述
貳俠嘗試使用 Notion skill 時失敗，顯示 "API token is invalid"。

## 決策報告

### 1. 問題診斷

**發現的問題**：
1. **API 版本錯誤**：`notion-sync.js` 使用 `2025-09-03`（未來版本），應為 `2022-06-28`
2. **環境變數衝突**：`.bashrc` 有舊的 `NOTION_API_KEY`，與 gcloud secret 不同
3. **Skill 未連結**：Notion skill 在 `~/.openclaw/workspace/skills/` 但未連結到 Gemini CLI

**Token 比對**：
```
ENV (舊):    ntn_489829705899FMQ... (無效)
gcloud (新): ntn_48982970589C7ab... (有效)
```

### 2. 修復方案

| 步驟 | 操作 |
|------|------|
| 1 | 修改 `notion-sync.js` 加入 gcloud fallback |
| 2 | 更新 API 版本為 `2022-06-28` |
| 3 | 刪除 `.bashrc` 中的舊 `NOTION_API_KEY` |
| 4 | 執行 `gemini skills link ~/.openclaw/workspace/skills` |
| 5 | 新增 `query` 功能供讀取任務 |

### 3. 程式碼變更

**notion-sync.js v2.1**：
```javascript
function getApiKey() {
    if (process.env.NOTION_API_KEY) {
        return process.env.NOTION_API_KEY;
    }
    try {
        return execSync('gcloud secrets versions access latest --secret=NOTION_OPENCLAW_KEY', {
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe']
        }).trim();
    } catch (e) {
        return null;
    }
}
```

### 4. 新增功能

**Query 指令**：
```bash
node notion-sync.js query                           # 列出所有
node notion-sync.js query "⏳ 進行中 (In Progress)" # 篩選狀態
```

### 5. Gemini CLI Skills 連結

執行 `gemini skills link ~/.openclaw/workspace/skills` 連結 27 個 skills：
- notion, memory-consolidation, architecture, systematic-debugging...

## 摘要
修復 Notion API 版本與 token 衝突，新增 query 功能，連結所有 skills 到 Gemini CLI。

---
#openclaw #2026-02-24 #skill #gemini #notion
