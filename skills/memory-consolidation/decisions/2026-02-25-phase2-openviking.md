# Phase 2: OpenViking 概念整合決策報告

**日期**: 2026-02-25
**版本**: 2.4.0

## Tags
#memory-system #openviking #dedup #agent-learning #type-expansion

---

## 決策摘要

| 決策點 | 選擇 | 原因 |
|--------|------|------|
| 記憶分類數量 | 4 → 7 類 | 對齊 OpenViking 六類 + error |
| 去重實現位置 | `src/dedup-decision.js` | Step 3 之前調用，獨立模組 |
| 去重是否需 LLM | **是** | 語義判斷 merge/skip 需要理解 |
| Agent 記憶來源 | error→success 模式 | 從 session 自動提取學習案例 |

---

## 功能實現

### 5. 6 類記憶細分 #type-expansion

**OpenViking → Memory System 映射**

| OpenViking | 可合併 | 我們的前綴 |
|------------|--------|-----------|
| profile | ✅ | `user.*` |
| preferences | ✅ | `pref.*` |
| entities | ✅ | `entity.*` (新增) |
| events | ❌ | `event.*` (新增) |
| cases | ❌ | `agent.case.*` (新增) |
| patterns | ✅ | `agent.pattern.*` (新增) |

**配置變更** (`digest-config.json`):
```json
{
  "type_mappings": {
    "fact": ["fact.", "user.", "project.", "system.", "task."],
    "pref": ["pref.", "config.", "preference."],
    "entity": ["entity."],
    "event": ["event."],
    "agent": ["agent.case.", "agent.pattern."],
    "inferred": ["inferred."],
    "error": ["error.", "correction."]
  },
  "mergeable_types": ["fact", "pref", "entity"],
  "immutable_types": ["event", "agent.case"]
}
```

---

### 6. 智能去重 #dedup #vector-search

**決策流程**:
```
新 candidate → embed → 向量搜索 (cosine > 0.85)
    → 找到相似？
        → 是 → Gemini flash-lite 判斷:
            - skip: 完全重複
            - merge: 合併到現有
            - create: 創建新記憶
        → 否 → 直接 create
```

**新建文件**: `src/dedup-decision.js`
- `findSimilar()`: 向量相似度預過濾
- `dedupDecision()`: 完整決策邏輯
- `callGeminiForDedup()`: LLM 判斷

**配置**:
```json
{
  "dedup": {
    "enabled": true,
    "similarity_threshold": 0.85,
    "max_candidates": 5,
    "model": "gemini-2.0-flash-lite"
  }
}
```

---

### 7. Agent 記憶 #agent-learning #cases #patterns

**數據結構**:

```javascript
// Case: 問題 + 解決方案（不可修改）
{
  key: "agent.case.test_failure.bc154ab5",
  value: {
    problem: "Exit code 1: test failed",
    solution: { tools: ["Edit", "Bash"], description: "..." },
    outcome: "success",
    session: "abc123"
  }
}

// Pattern: 可重用模式（可合併）
{
  key: "agent.pattern.frequent_bash",
  value: "Tool Bash used 68 times - indicates primary workflow"
}
```

**新建文件**: `src/extract-agent-learnings.js`
- `findErrorRecoveryCases()`: error→success 模式提取
- `findToolPatterns()`: 頻繁工具識別
- `findSuccessfulWorkflows()`: 多步驟工作流

**SessionStart 注入** (`src/query-memory.js`):
```
[Agent Cases — learned problem solutions]
bc154ab5: Exit code 1 → 找到根本問題...
[Agent Patterns — effective workflows]
frequent_bash: Tool Bash used 68 times
```

---

## 文件變更總覽

| 文件 | 動作 | 描述 |
|------|------|------|
| `digest-config.json` | 修改 | type_mappings + dedup 配置 |
| `src/1-extract-facts.js` | 修改 | PROMPT 加入新分類 |
| `mcp/server.mjs` | 修改 | type enum 擴展 |
| `src/dedup-decision.js` | **新建** | 智能去重模組 |
| `src/extract-agent-learnings.js` | **新建** | Agent 學習提取 |
| `src/query-memory.js` | 修改 | Agent memory 注入 |

---

## 驗證結果

```bash
✅ dedup-decision.js loaded
✅ extract-agent-learnings.js loaded
✅ 7 type mappings: fact, pref, entity, event, agent, inferred, error
✅ Dedup enabled: true, threshold: 0.85
✅ Agent cases/patterns 提取正常
```

---

## 後續工作

- [ ] 整合 dedup-decision 到 `3-commit-to-db.js`
- [ ] 整合 extract-agent-learnings 到 cron pipeline
- [ ] 測試語義搜索 agent memory
