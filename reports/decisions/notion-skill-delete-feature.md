---
task: notion-skill-delete-feature
agent: gemini
status: completed
date: 2026-02-24
time: 13:57:00
tags:
  - decision-report
  - gemini
---

# notion-skill-delete-feature

## 任務資訊
- **Agent**: Gemini CLI
- **日期**: 2026-02-24 13:57:00
- **狀態**: ✅ 完成

## 任務描述
擴充 `skills/notion/scripts/notion-sync.js` 腳本，增加刪除 Notion 頁面的功能。要求：1. 新增名為 'delete' 的 action，接受 Notion 頁面 ID 為參數。 2. 實作呼叫 Notion API `PATCH /v1/pages/{page_id}` 並將頁面封存 (`{ "archived": true }`)。 3. 更新 `skills/notion/SKILL.md` 文件，加入新命令的用法說明。

## 決策報告
在本次擴充中，我針對 `skills/notion/scripts/notion-sync.js` 進行了功能更新，新增了 `delete` 動作。這項功能的實作是基於 Notion API 的 `PATCH /v1/pages/{page_id}` 節點，並將 `archived` 屬性設為 `true`，以符合 Notion 封存頁面的標準流程。

關鍵決策點如下：
1. **動作命名**：遵循使用者要求命名為 `delete`，儘管在 API 層面是執行封存（archive），但在 CLI 介面使用 `delete` 對使用者來說更直觀。
2. **參數處理**：該動作接受 Notion 頁面 ID 作為唯一必要參數，並在缺少參數時提供錯誤提示。
3. **文件同步**：同步更新了 `SKILL.md`，新增了「Delete (Archive) an Item」章節，並提供範例命令，確保開發者能快速掌握新功能。
4. **介面一致性**：更新了腳本內部的 Usage 說明，維持 CLI 互動的完整性。

## 摘要
已在 Notion Skill 中新增 `delete` 功能，支援透過頁面 ID 封存 Notion 項目並同步更新文件。

---
#openclaw #skill #gemini #notion
