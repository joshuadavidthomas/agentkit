---
# agentkit-ht0s
title: 'Fix Phase 0 ralph demo: remove bun wrapper, spawn pi RPC directly'
status: completed
type: bug
priority: normal
created_at: 2026-02-06T19:49:51Z
updated_at: 2026-02-06T20:03:59Z
---

The /ralph demo command fails because it tries to spawn `bun run loop-runner.ts` but bun isn't available at the expected path. Fix: remove the bun intermediate and have the extension spawn `pi --mode rpc --no-session` directly, managing the RPC communication inline. The loop-runner.ts was for standalone Part A testing; for the Part B extension demo, we can do it all in-process.