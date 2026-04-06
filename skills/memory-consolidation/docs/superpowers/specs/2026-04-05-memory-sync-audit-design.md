# Memory Consolidation — Sync Audit & Recovery Design

**Date:** 2026-04-05
**Status:** Partially Complete — Actions taken 2026-04-05
**Repo:** https://github.com/jerryyrliu-jpg/memory-consolidation (private)

---

## 1. Current State Summary

### Git Sync

| Metric | Value |
|--------|-------|
| Local branch | `master` |
| Unpushed commits | 7 (polybot digest, wl-candidate-weekly plan) |
| Core code drift (src/mcp/cli) | **0 files** — core is in sync |
| Non-core drift | `tools/polybot-daily-digest.sh`, `system/cron-list.txt`, `docs/` |
| Unstaged deletions | ~30 skill files (smart-fetch, youtube-summarize, brainstorming, TDD, debugging, etc.) |
| Unstaged modifications | `evolved-instructions.md` (0 → 65,219 lines), `evolved-inject.json`, `email_interactive.py` |

### Data Assets

| Asset | Size | Entries | Health |
|-------|------|---------|--------|
| memory.db | 360.6 MB → ~360 MB | 34,045 → 32,357 | ⚠️ Vacuum pending |
| staging/ | 208 MB → 113 MB | 2,253 → 365 files | ✅ Cleaned (>7d deleted) |
| topics/ | 3.1 MB | Stops at W09 (Mar 2) | ℹ️ Weekly consolidation cancelled |
| logs/ | 2.7 MB | Current (Apr 5) | ✅ OK |
| evolved-instructions.md | 2.2 MB → 0 | 65K → 0 lines | ✅ Cleared, cron stopped |

### Memory DB Breakdown

| Key Prefix | Count | % |
|------------|-------|---|
| agent.* | 21,708 | 63.8% |
| claude.* | 4,864 | 14.3% |
| task.* | 2,741 | 8.1% |
| entity.* | 961 | 2.8% |
| config.* | 705 | 2.1% |
| project.* | 704 | 2.1% |
| Other (event, system, error, correction, user, email, decision, pref, memory) | 2,362 | 6.9% |

**Embedding coverage:** 28,936 / 34,045 (85.0%) — 5,109 missing

### Pipeline Status

| Step | Status | Issue |
|------|--------|-------|
| 1. extract-facts | ✅ | PreCompact hook working |
| 1.5 extract-agent-learnings | ✅ | Weekly pruning added (30d cases, 60d patterns) |
| 1.6 extract-instincts | ✅ | 4,398 instincts, running every 6h |
| 2. align-temporally | ✅ | |
| 3. commit-to-db + dedup | ✅ | |
| 4. generate-digest | ✅ | |
| 5. embed-facts | ✅ | 100% coverage after backfill |
| 6. generate-daily-log | ❌ **Removed** | File deleted, no value |
| 7. consolidate-weekly | ❌ **Removed** | File deleted, cancelled by design |
| 8. update-rolling-topics | ❌ **Removed** | File deleted, cancelled by design |
| evolve-instructions | ❌ **Removed** | File deleted, cron stopped — instinct-cli covers this |

### Cron Status

| Cron | Status |
|------|--------|
| `0 */12 * * *` daily-gemini-sync.sh | ✅ Running (confirmed last run Apr 5 12:00) |
| `30 */6 * * *` instinct-cli.js extract | ✅ Running |
| `0 4 * * 0` weekly-consolidation | ❌ Cancelled (by design) |
| `45 */6 * * *` evolve-instructions.js | ✅ **Stopped 2026-04-05** |

---

## 2. Problems Identified

### ~~P1: Crons Not Running~~ — RESOLVED
Crons were already running (audit error). Confirmed:
- Gemini sync: last run Apr 5 12:00, pipeline successful
- Instinct extraction: running every 6h
- Weekly consolidation: **cancelled by design** (Apr 5)
- evolve-instructions: **stopped Apr 5**

### ~~P2: staging/ Never Cleaned~~ — RESOLVED
Cleaned Apr 5: 2,253 → 365 files, 208 MB → 113 MB. Files >7 days deleted.
Remaining 365 = last 7 days (normal). Consider adding to cron for auto-cleanup.

### ~~P3: evolved-instructions.md Runaway~~ — RESOLVED
Feature disabled Apr 5. Cron removed, file cleared (0 bytes).
Decision: instinct-cli.js already covers the same use case (behavioral rules → DB), evolve-instructions was redundant with no pruning.

### P4: Agent Entries Domination — PARTIAL
~~21,708~~ → ~19,900 agent entries after pruning 1,766 cases (>30 days, access_count < 2).
Still 63%+ of DB. Further reduction limited by young DB (only 40 days old — 60-day cutoff catches nothing yet).
Recommend re-running this pruning monthly as DB matures.

### P5: 5,109 Entries Missing Embeddings
15% of entries lack vector embeddings, reducing semantic search quality.

### P6: 7 Commits Unpushed
Low risk since core code is unchanged, but these should be pushed for backup.

### P7: Unstaged Skill Deletions
~30 skill files deleted locally but not committed. These deletions should either be committed (if intentional) or investigated.

---

## 3. Recovery Plan

### Phase 1: Immediate (Today)

#### 1a. Restore Crons
```cron
# Memory consolidation — Gemini CLI session sync (every 12h)
0 */12 * * * cd ~/.openclaw/workspace/skills/memory-consolidation && bash scripts/daily-gemini-sync.sh >> ~/.openclaw/workspace/logs/gemini-sync.log 2>&1

# Instinct extraction (every 6h)
30 */6 * * * cd ~/.openclaw/workspace/skills/memory-consolidation && node cli/instinct-cli.js extract --store >> ~/.openclaw/workspace/logs/instinct-extract.log 2>&1

# Weekly consolidation (Sunday 4am Taipei = Sat 20:00 UTC)
0 20 * * 6 cd ~/.openclaw/workspace/skills/memory-consolidation && bash scripts/weekly-consolidation.sh >> ~/.openclaw/workspace/logs/weekly-consolidation.log 2>&1
```

#### 1b. Clean staging/
```bash
# Archive processed staging files older than 7 days, then delete
find staging/ -name "precompress-*" -mtime +7 -delete
```
Expected savings: ~200 MB

#### 1c. Push 7 Commits
```bash
git push origin master
```

### Phase 2: Pruning (This Week)

#### 2a. evolved-instructions.md
Options:
- **A) Truncate to last 500 lines** — keep recent, discard ancient
- **B) Disable evolve-instructions entirely** — if the feature isn't providing value
- **C) Add max-lines cap** to `evolve-instructions.js` (e.g., keep last 1000 lines)

**Recommendation:** Option C — cap at 1000 lines with FIFO rotation

#### 2b. Agent Entry Pruning
```sql
-- Remove agent.case entries older than 60 days with access_count < 2
DELETE FROM memories
WHERE key LIKE 'agent.case.%'
AND last_accessed < datetime('now', '-60 days')
AND access_count < 2;
```
Expected reduction: ~10,000-15,000 entries

#### 2c. Backfill Missing Embeddings
```bash
node src/embed.js --backfill
```
Target: 5,109 entries → 0 missing

### Phase 3: Structural (Next Week)

#### 3a. Run Backlogged Weekly Consolidation
Generate missing weekly topics for W10-W14:
```bash
for week in W10 W11 W12 W13 W14; do
  node src/7-consolidate-weekly.js --week "2026-$week"
done
node src/8-update-rolling-topics.js
```

#### 3b. Commit or Revert Unstaged Deletions
Decide: are the ~30 deleted skill files intentional?
- If yes → `git add -u` and commit
- If no → `git restore` the needed ones

#### 3c. DB Vacuum
After pruning agent entries:
```bash
node -e "require('better-sqlite3')('memory.db').exec('VACUUM')"
```
Expected: 360 MB → ~200-250 MB

### Phase 4: Git Hygiene

#### 4a. Resolve branch naming
Local uses `master`, GitHub has both `master` and `main`. Standardize:
- Set default branch to `main` on GitHub
- Rename local: `git branch -m master main && git push -u origin main`

#### 4b. .gitignore Updates
Add to .gitignore:
```
memory.db
staging/
logs/
topics/
evolved-instructions.md
.processed_sessions
.processed_sessions.bak
```
These are local data files that shouldn't be in the repo.

---

## 4. Monitoring Going Forward

### Health Check Script
Create `scripts/health-check.sh`:
```bash
#!/bin/bash
echo "=== Memory Consolidation Health ==="
echo "DB entries: $(node -e "console.log(require('better-sqlite3')('memory.db').prepare('SELECT COUNT(*) as c FROM memories').get().c)")"
echo "DB size: $(du -sh memory.db | cut -f1)"
echo "Staging: $(ls staging/ | wc -l) files ($(du -sh staging/ | cut -f1))"
echo "Unembedded: $(node -e "console.log(require('better-sqlite3')('memory.db').prepare('SELECT COUNT(*) as c FROM memories WHERE embedding IS NULL').get().c)")"
echo "Latest topic: $(ls topics/ | tail -1)"
echo "Latest log: $(ls logs/ | tail -1)"
echo "evolved-instructions: $(wc -l evolved-instructions.md | cut -d' ' -f1) lines"
```

### Alerts (in daily digest)
- DB > 500 MB → vacuum needed
- staging > 100 files → cleanup needed
- evolved-instructions > 2000 lines → prune needed
- Weekly topics gap > 2 weeks → consolidation broken

---

## 5. Summary

| Priority | Action | Status | Notes |
|----------|--------|--------|-------|
| P1 | Restore crons | ✅ Were already running | Audit error |
| P2 | Clean staging/ | ✅ Done | 208 MB → 113 MB |
| P3 | Stop evolve-instructions | ✅ Done | Cron removed, file cleared |
| P4 | Prune agent entries | ⚠️ Partial | -1,766 entries; re-run monthly |
| P5 | Backfill embeddings | ✅ Done | 100% coverage |
| P6 | Push 7 commits | ⏳ Pending | Non-urgent |
| P7 | Resolve unstaged deletions | ⏳ Pending | ~30 skill files |
| P8 | DB vacuum | ✅ Done | 361 MB → 345 MB |
| P9 | Weekly consolidation | ❌ Removed | Files deleted |
| P10 | Branch standardization | ⏳ Pending | master → main |
| P11 | Remove steps 6/7/8 + evolve-instructions | ✅ Done | 5 files deleted |
