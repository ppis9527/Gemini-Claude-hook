---
task: smart-fetch-enhancement
agent: claude
status: completed
date: 2026-02-23
time: 18:00:35
tags:
  - decision-report
  - claude
---

# smart-fetch-enhancement

## 任務資訊
- **Agent**: Claude Code
- **日期**: 2026-02-23 18:00:35
- **狀態**: ✅ 完成

## 任務描述
繼續開發 smart-fetch skill，在 ~/.openclaw/workspace/skills/smart-fetch/ 目錄工作。

請加入以下功能：
1. **Proxy 支援**：--proxy socks5://host:port 或 http://host:port
2. **多 URL 批次處理**：支援從檔案讀取 URL 列表 (--urls file.txt)
3. **輸出格式選項**：--format text|markdown|json
4. **Reddit 特殊處理**：偵測 Reddit 時自動用 old.reddit.com + 建議用 proxy

完成後請 commit 並確保測試通過。

## 決策報告

**實作內容：**
為 smart-fetch 新增四項核心功能：
1. **Proxy 支援**：透過 `parseProxy()` 解析 socks5/http/https 格式，支援帶認證的 proxy
2. **批次處理**：`batchFetch()` 從檔案讀取 URL（支援註解行），可控制並行數
3. **輸出格式**：`formatOutput()` 和 `formatBatchOutput()` 支援 text/markdown/json 三種格式
4. **Reddit 處理**：`transformRedditUrl()` 自動轉換到 old.reddit.com，並在未使用 proxy 時顯示警告

**關鍵決策：**
- Proxy 直接傳入 Playwright launch options，而非 context，確保所有請求都走 proxy
- 批次處理採用分批並行（預設 concurrency=3），平衡效率與避免被封鎖
- Reddit 用 old.reddit.com 因為其 DOM 結構更穩定，新版 Reddit 大量使用 Web Components（shreddit-*）難以抓取
- 輸出格式設計為函數抽象，方便未來擴展（如 CSV、HTML）

**測試驗證：**
- `--help` 顯示正確
- JSON/Markdown 格式輸出正常
- 批次處理 2 URLs 成功
- Reddit URL 轉換和 proxy 解析驗證通過

## 摘要
smart-fetch 新增 proxy、批次 URL、多輸出格式、Reddit 自動轉換 old.reddit.com 功能

---
#openclaw #skill #claude
