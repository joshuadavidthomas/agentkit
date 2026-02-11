---
# agentkit-wily
title: Advise on mem::replace deadlock pattern placement
status: completed
type: task
priority: normal
created_at: 2026-02-11T04:29:41Z
updated_at: 2026-02-11T04:29:48Z
---

User asked for guidance on whether to capture deadlock + mem::replace ownership handoff pattern with Salsa as case study, without creating a Salsa-specific skill.

## Checklist
- [x] Evaluate fit with existing rust-atomics skill scope
- [x] Recommend where to place pattern guidance
- [x] Provide concise implementation suggestion