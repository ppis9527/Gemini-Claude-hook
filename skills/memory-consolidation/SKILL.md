---
name: memory-consolidation
description: Memory consolidation system for OpenClaw - processes and digests memory entries
version: 2.0.0
metadata:
  {
    "openclaw": { "emoji": "🧠", "requires": { "anyBins": ["node"] } },
  }
---

# Memory Consolidation Skill

Memory consolidation system for OpenClaw - processes and digests memory entries.

## Version

**Current Version:** 2.0.0

## Description

This skill handles Phase 4 of the memory pipeline, generating digests from consolidated memory entries.

## Usage

```bash
bash command:"run_pipeline.sh"
```

## Files

| File | Description |
|------|-------------|
| `run_pipeline.sh` | Main entry point |
| `src/4-generate-digest.js` | Digest generation logic |
| `src/query-memory.js` | Memory query interface |
| `tests/run-tests.sh` | Test runner |
| `tests/test-*.js` | Unit tests |

## Requirements

- Node.js
- Access to memory database

## Changelog

### v1.0.0 (2025-02-19)

- Initial release
- Digest generation (Phase 4)
- Memory query interface
- Test suite included
