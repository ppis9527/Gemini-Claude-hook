# TG Bot Context Injection — 6 Layers Architecture

**Date**: 2026-02-28
**Tags**: #telegram #gemini #context #token-optimization #memory #2026-02-28

---

## Context

TG Bot（貳俠/小序）每次新 session 第一則訊息時，透過 `buildContextPrefix()` (`~/Telegram-Gemini-Bot/src/memory.ts:325`) 注入多層 context。加上 Gemini 本身的內部 overhead，共 6 層。

小序單一 session 72 輪對話後 promptTokenCount 達 187K tokens，觸發調查。

## 6 Layers

| Layer | 來源 | 類型 | 大小 | 狀態 (2026-02-28) |
|-------|------|------|------|-------------------|
| 1 | Global `~/.gemini/GEMINI.md` | 我們加的 | ~4.8KB (~1.5K tokens) | ❌ 已移除 — 與 Layer 2 重複 |
| 2 | Persona `~/GeminiTGBot/<persona>/GEMINI.md` | 我們加的 | 小序 5.5KB / 貳俠 7.8KB | ✅ 保留 — 唯一身份定義 |
| 3 | `<personaDir>/session-recap.md` | 我們加的 | 0（檔案不存在） | ⏸ 保留邏輯，未啟用 |
| 4 | `<personaDir>/memory.md` | 我們加的 | 0（檔案不存在） | ❌ 已移除 — 改用 MCP memory_search |
| 5 | `~/.gemini/topics/*.md` 索引 | 我們加的 | 0（目錄不存在） | ⏸ 保留邏輯，未啟用 |
| 6 | Gemini 內部 overhead | Gemini 系統 | 固定（數千 tokens） | 不可控 |

## 各 Layer 詳細說明

### Layer 1: Global GEMINI.md — ❌ 已移除
- **用途**：全域 Gemini CLI 設定（語言、安全規則、MCP 用法、session 管理）
- **移除原因**：Persona GEMINI.md (Layer 2) 已包含所有必要規則（語言、安全、回覆格式）。注入 Global 等於重複 ~1.5K tokens/call
- **影響**：無。TG bot 不需要 CLI 專用的 session 管理規則

### Layer 2: Persona GEMINI.md — ✅ 保留
- **用途**：Bot 身份、角色、行為規則、回覆格式、工具使用權限、prompt injection 防禦
- **內容**：小序 = 助理（不可寫 code）、貳俠 = 首席架構師
- **大小**：小序 5.5KB / 貳俠 7.8KB
- **注意**：這是 bot 人格的唯一來源，不可移除

### Layer 3: Session Recap — ⏸ 未啟用
- **用途**：跨 session 的對話摘要（fallback，主要存 memory.db）
- **路徑**：`~/GeminiTGBot/<persona>/session-recap.md`
- **未來設計**：可在 session 結束時自動生成摘要寫入此檔案，下次開 session 時注入。但目前 MCP memory_search 已能達到類似效果
- **建議**：維持 fallback 角色，不主動啟用

### Layer 4: Memory.md — ❌ 已移除
- **用途**：靜態記憶檔案（舊設計，pre-MCP 時代）
- **移除原因**：memory.db + MCP `memory_search` 已完全取代。靜態檔案無法即時更新且浪費 tokens
- **影響**：無。bot 透過 MCP 查詢 memory 更精確

### Layer 5: Topics Index — ⏸ 未啟用
- **用途**：列出 `~/.gemini/topics/*.md` 可用主題，讓 Gemini 知道有哪些知識可讀
- **路徑**：`~/.gemini/topics/`
- **未來設計**：weekly consolidation 產出的主題摘要可放在此目錄。但目前 TG bot 不需要這些長期知識索引
- **建議**：CLI session 可啟用，TG bot 維持停用

### Layer 6: Gemini Internal Overhead — 不可控
- **組成**：
  - System prompt（Gemini 內建安全規則）
  - MCP tool definitions（memory_summary, memory_search, memory_store 的 JSON schema）
  - Google 內建工具（code execution, Google Search 等）
  - Safety settings
- **特性**：每次 API call 固定大小，不隨對話長度成長
- **token 主犯不是 Layer 6**：187K tokens 來自同一 session 內 72 輪對話累積（每次 call 帶上所有歷史訊息），不是 Layer 6 本身大

## Token 消耗分析

```
API Call #N 的 promptTokenCount =
    Layer 2 (固定 ~2K tokens)
  + Layer 6 (固定 ~數千 tokens)
  + 第 1~N 輪的所有歷史訊息 (累積成長)
```

**優化效果**：移除 Layer 1 + 4 省 ~1.5K tokens/call。72 輪 = 省 ~108K tokens total。

## 壓縮機制

- `memory-control.ts` 的 `COMPRESS_THRESHOLD = 0.55`：tokenCount/contextWindow > 55% 時壓縮
- 壓縮後歷史訊息被摘要，promptTokenCount 大幅下降
- 我們的 PreCompress hook 系統在壓縮前提取 facts → memory.db，確保細節不丟失

## 變更記錄

| 日期 | 變更 |
|------|------|
| 2026-02-28 | 移除 Layer 1 (Global GEMINI.md) — 與 Layer 2 重複 |
| 2026-02-28 | 移除 Layer 4 (memory.md) — 改用 MCP memory_search |
| 2026-02-28 | 記錄 6 層架構及各層用途 |
