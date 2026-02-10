---
# agentkit-bz7u
title: Extract extension traits into own reference file in rust-traits
status: completed
type: task
priority: normal
created_at: 2026-02-10T18:36:18Z
updated_at: 2026-02-10T18:41:30Z
---

The Ext pattern is common enough in Rust codebases (futures::StreamExt, tokio::AsyncReadExt, itertools::Itertools) that it warrants its own reference file with deeper coverage.

## Checklist

- [x] Create references/extension-traits.md with full coverage
- [x] Trim extension trait section in trait-patterns.md to summary + forward ref
- [x] Update SKILL.md pattern catalog entry
- [x] Update README.md
- [x] Commit