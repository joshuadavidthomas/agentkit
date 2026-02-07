---
# agentkit-kav7
title: 'Rework implementation plan: in-session loop first, detach/attach later'
status: completed
type: task
priority: normal
created_at: 2026-02-07T04:15:55Z
updated_at: 2026-02-07T04:17:50Z
---

Refocus the ralph implementation plan. The core loop should work fully within a normal pi session first (spawn RPC as child, drive iterations inline, render events directly, handle input). Push detach/attach to a later phase. Update IMPLEMENTATION_PLAN.md and the epic bean.