---
task: notion-skill-update-feature
agent: gemini
status: completed
date: 2026-02-24
time: 14:15:55
tags:
  - decision-report
  - gemini
---

# notion-skill-update-feature

## 任務資訊
- **Agent**: Gemini CLI
- **日期**: 2026-02-24 14:15:55
- **狀態**: ✅ 完成

## 任務描述
擴充 `skills/notion/scripts/notion-sync.js` 腳本，增加更新 Notion 任務狀態的功能。要求：1. 新增名為 'update' 的 action，接受 Notion 頁面 ID 和新狀態 (e.g., '已完成') 為參數。 2. 實作呼叫 Notion API `PATCH /v1/pages/{page_id}` 並更新 'Status' 屬性。 3. 更新 `skills/notion/SKILL.md` 文件，加入新命令的用法說明。

## 決策報告
1. **新增 `update` 動作**：在 `notion-sync.js` 中新增了 `update` 關鍵字處理，允許使用者透過 Page ID 快速變更現有任務的狀態。這填補了原本只能建立、查詢與刪除，卻無法直接更新進度的功能缺口。
2. **實作 API 調用**：採用 `PATCH /v1/pages/{page_id}` 端點，並針對 `Status` 屬性進行局部更新。由於 ErXia Hub 的數據庫規範中 `Status` 是 `select` 類型，因此 Payload 結構設為 `{ properties: { 'Status': { select: { name: status } } } }`。
3. **一致性維護**：同步更新了腳本內的 `Usage` 說明以及 `SKILL.md` 指南。在 `SKILL.md` 中，我將此命令列為第 5 項常用任務，與「刪除項目」並列，確保開發者在查閱手冊時能直觀地發現此新功能。
4. **決策點**：選擇將 `page_id` 作為第一個參數，`status` 作為第二個參數，是為了與 `delete` 命令的參數順序保持一致（皆以 ID 開頭），符合直覺。

## 摘要
已在 Notion Skill 中實作 `update` 功能，支援透過 Page ID 一鍵變更任務狀態並同步更新文件。

---
#openclaw #2026-02-24 #skill #gemini #notion
