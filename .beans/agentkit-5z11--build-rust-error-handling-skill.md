---
# agentkit-5z11
title: Build rust-error-handling skill
status: completed
type: task
priority: normal
created_at: 2026-02-10T16:41:22Z
updated_at: 2026-02-10T16:45:25Z
---

Build the rust-error-handling skill — the 3rd skill in the Rust skills build order (Phase 2).

## Context
This is the error strategy and design skill. It triggers when users are designing error types, choosing thiserror vs anyhow, handling error propagation, or asking 'how should I handle errors in this project.'

The central axis is **library vs application** — different contexts demand different error strategies.

## Checklist

- [x] Create skills/rust-error-handling/ directory structure (SKILL.md, README.md, references/)
- [x] Write SKILL.md with prescriptive rules, decision framework, and review checklist
- [x] Write reference files for deep-dive content (thiserror patterns, anyhow patterns, combinators)
- [x] Write README.md with attribution and license notes
- [x] Mark skill as DONE in PLAN.md