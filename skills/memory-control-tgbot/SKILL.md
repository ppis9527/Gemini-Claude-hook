# memory-control-tgbot

TG Gemini Bot 內建的 context 管理 skill。

## 位置

**注意：** 這不是獨立 skill，代碼在 Telegram-Gemini-Bot 內：
- `~/Telegram-Gemini-Bot/src/skills/memory-control.ts`
- `~/Telegram-Gemini-Bot/src/memory.ts`

此文檔僅作記錄用途。

## 功能

### Auto-Compress (55% threshold)

當 session context 使用超過 55% 時自動觸發壓縮：

```
55% context 使用
    ↓
Step 1: generateRecap() - 讓 Gemini 生成對話摘要
    ↓
Step 2: 存到 <personaDir>/session-recap.md
    ↓
Step 3: runCompress() - 執行 gemini /compress 真正截斷
    ↓
下次對話: buildContextPrefix() 注入 session-recap.md
```

### Context Layers

`buildContextPrefix()` 注入順序：
1. `~/.gemini/GEMINI.md` (Global)
2. `<personaDir>/GEMINI.md` (Persona)
3. `<personaDir>/session-recap.md` (Compressed context)
4. `<personaDir>/memory.md` (Previous session memory)
5. `~/.gemini/topics/*.md` index (Available topics)

### Commands

| 指令 | 說明 |
|------|------|
| `/memory` | 查看 memory 摘要 |
| `/snapshot` | 手動觸發壓縮 |
| `/topic <name>` | 提取主題摘要到 ~/.gemini/topics/ |

## 配置

```typescript
// memory-control.ts
const COMPRESS_THRESHOLD = 0.55; // 55%
```

## 相關

- `memory-consolidation` skill: 跨 session 持久記憶 (MCP + memory.db)
- `coding-agent-tgbot` skill: 派發任務給 Claude/Gemini
