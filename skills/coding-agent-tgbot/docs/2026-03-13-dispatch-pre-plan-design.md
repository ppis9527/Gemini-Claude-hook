---
title: Dispatch Pre-Planning Design
date: 2026-03-13
tags: [dispatch, pre-plan, flash-lite, coding-agent]
status: approved
---

# Dispatch Pre-Planning (智能化 Phase 1)

## Problem

dispatch-agent.sh is fire-and-forget. When 貳俠 sends vague or ambiguous prompts, agents:
- **Go in wrong direction** (A-type failure) — misunderstand task intent
- **Get stuck** (B-type failure) — retry loops until timeout

## Solution

Add `pre_plan()` to dispatch-agent.sh. Before executing the agent, call Gemini flash-lite API to analyze the prompt and produce a structured plan. If the prompt is too vague, reject and notify via TG instead of wasting agent time.

## Flow

```
貳俠 prompt → pre_plan()
  ├─ feasible: false → TG: "⚠️ 任務不夠明確: {reason}" → exit 0
  └─ feasible: true  → append plan to prompt → agent executes → results
```

## Implementation

### pre_plan() function (~40 lines in dispatch-agent.sh)

**API**: Gemini REST API via `curl`
**Model**: `gemini-3.1-flash-lite-preview`
**API Key**: `GEMINI_API_KEY3` (from GCP Secret Manager, loaded by load-secrets.sh)
**RPD Budget**: 500/day (pre-planning uses ~10-30/day)

**System prompt for flash-lite**:
```
你是一個任務分析器。分析以下開發任務，輸出 JSON：
{
  "feasible": true/false,
  "reason": "如果不可行，說明缺少什麼資訊",
  "plan": {
    "goal": "一句話目標",
    "steps": ["步驟1", "步驟2", ...],
    "files_likely": ["可能需要改的檔案路徑"],
    "success_criteria": "怎樣算完成"
  }
}

規則：
- feasible=false 的情況：任務太模糊、缺少關鍵資訊（哪個檔案、什麼行為）、自相矛盾
- steps 最多 5 步，每步要具體可執行
- files_likely 填你能推測的路徑，不確定就留空陣列
```

**Input**: 貳俠的原始 prompt (via user message)

**Output handling**:
- Parse JSON from response
- If `feasible: false`: send TG notification with reason, exit 0 (no dispatch)
- If `feasible: true`: append plan to agent prompt as structured context

**Appended format to agent prompt**:
```
---
## Pre-Plan (由 AI 分析產生，僅供參考)
目標：{goal}
步驟：
1. {step1}
2. {step2}
...
可能涉及檔案：{files_likely}
完成標準：{success_criteria}
---
```

### Error handling

- flash-lite API failure (network, 429, etc.) → skip pre-planning, dispatch with original prompt (graceful degradation)
- JSON parse failure → skip pre-planning, dispatch with original prompt
- Timeout: 10 second curl timeout

## Files Changed

| File | Change |
|------|--------|
| `dispatch-agent.sh` | Add `pre_plan()` function + call before agent execution |

No other files modified. Existing result.json, TG notification, memory storage logic unchanged.

## Success Criteria

1. Vague prompts get rejected with helpful TG feedback
2. Clear prompts get a structured plan appended
3. API failure doesn't block dispatch (graceful degradation)
4. No fake Gemini CLI sessions created (direct API call)
