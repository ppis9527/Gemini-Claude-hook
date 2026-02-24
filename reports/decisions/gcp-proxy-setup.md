---
task: gcp-proxy-setup
agent: claude
status: completed
date: 2026-02-24
time: 14:05:00
tags:
  - decision-report
  - infrastructure
  - proxy
---

# GCP Proxy 設置

## 任務資訊
- **Agent**: Claude Code
- **日期**: 2026-02-24
- **狀態**: ✅ 完成

## 背景
smart-fetch skill 需要繞過某些網站的 IP 封鎖（如 Reddit）。原本 openclaw-server 在台灣（asia-east1），某些服務會封鎖亞洲 IP。

## 決策報告

### 方案選擇
選擇在 GCP 免費層創建美國 proxy VM：
- **區域**: us-west1-b (Oregon) — 離亞洲最近的美國區域
- **機型**: e2-micro — 免費層額度
- **軟體**: microsocks — 超輕量 SOCKS5 proxy (~50KB)

### 創建的資源

| 資源 | 詳情 |
|------|------|
| VM 名稱 | `proxy-us` |
| Zone | `us-west1-b` |
| 外部 IP | `34.11.202.94` |
| 端口 | `1080` (SOCKS5) |
| Secret | `SOCKS5_PROXY_US` |
| 防火牆 | `allow-proxy` (只允許 openclaw-server IP) |

### 使用方式

```bash
# 直接使用
smart-fetch https://example.com --proxy socks5://34.11.202.94:1080

# 從 secret 獲取
smart-fetch https://example.com --proxy $(gcloud secrets versions access latest --secret=SOCKS5_PROXY_US)

# curl 測試
curl -x socks5://34.11.202.94:1080 https://httpbin.org/ip
```

### 適用場景

| Proxy | 區域 | 適用 | 不適用 |
|-------|------|------|--------|
| 直連 | 台灣 | Web3、DeFi、亞洲服務 | 美國限定服務 |
| proxy-us | 美國 | 美國限定服務 | Web3（美國 IP 被封）、Reddit（封雲端 IP）|

### 限制
- Reddit 封鎖所有雲服務商 IP（GCP、AWS、Azure），需住宅 proxy 才能繞過
- Web3/DeFi 服務多數封鎖美國 IP，應使用直連

### 成本
- e2-micro 在 GCP 免費層內
- 預估月成本: $0（流量 <1GB/月到北美外）

## 摘要
在 us-west1-b 創建 e2-micro proxy VM，安裝 microsocks，用於需要美國 IP 的場景。Web3 相關仍用台灣直連。

---
#openclaw #2026-02-24 #infrastructure #proxy #gcp
