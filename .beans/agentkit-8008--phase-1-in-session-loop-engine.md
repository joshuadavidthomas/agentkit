---
# agentkit-8008
title: 'Phase 1: In-Session Loop Engine'
status: completed
type: feature
priority: high
created_at: 2026-02-07T04:18:20Z
updated_at: 2026-02-07T06:18:44Z
parent: agentkit-y69o
---

Implement the core loop engine running inside the extension process.

## Architecture (v3 — native pi agent loop)

No RPC process. The extension drives iterations using pi own APIs:
- ctx.newSession() for fresh context per iteration
- pi.sendUserMessage() triggers agent turns (native rendering)
- ctx.waitForIdle() waits for completion
- pi.on("turn_end") tracks telemetry

All rendering is native pi — tool calls, assistant text, streaming, thinking.
We just add iteration borders and telemetry.

## Checklist

- [x] Create LoopEngine class with RPC (v1 — superseded)
- [x] Refactor to use pi native APIs (v3 — no RPC)
  - newSession + sendUserMessage + waitForIdle iteration loop
  - turn_end event for telemetry tracking
  - Iteration header/footer as ralph_iteration custom messages
  - Widget + status bar (event-driven)
  - State/iterations written to filesystem
  - /ralph start, stop, kill, status, list, clean commands
- [x] Retire loop-engine.ts and loop-runner.ts (moved to .bak)
- [ ] Test: start a loop, watch it iterate, stop it, check state.json
