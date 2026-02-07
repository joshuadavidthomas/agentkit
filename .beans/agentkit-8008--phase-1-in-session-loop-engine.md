---
# agentkit-8008
title: 'Phase 1: In-Session Loop Engine'
status: in-progress
type: feature
priority: high
created_at: 2026-02-07T04:18:20Z
updated_at: 2026-02-07T04:29:14Z
parent: agentkit-y69o
---

Implement the core loop engine running inside the extension process. Merges loop-runner logic with direct TUI rendering.

## Architecture

- LoopEngine class that spawns pi --mode rpc --no-session as a child process
- Drives iteration loop directly (no detached process)
- Events rendered live in TUI via pi.sendMessage() + registered renderers
- State/events/iterations written to filesystem for observability

## Checklist

- [x] Create LoopEngine class in loop-engine.ts
  - Spawn RPC process, manage lifecycle
  - Iteration loop: read task.md → prompt → await agent_end → new_session → repeat
  - Methods: start(), stop(), steer(msg), followUp(msg), kill(), getState()
  - Event callbacks (onEvent, onIterationStart, onIterationEnd, onStatusChange)
  - Telemetry extraction from message_end events
  - Per-iteration stats → iterations/NNN.json
  - Cumulative stats → state.json (atomic write)
  - Config written to config.json on start
  - Events appended to events.jsonl
  - Graceful stop between iterations
  - RPC crash detection and error reporting
- [x] Refactor index.ts to use LoopEngine
  - /ralph start creates LoopEngine (not detached process)
  - /ralph stop signals engine to stop
  - /ralph kill force-kills the RPC process
  - /ralph status reads from engine state or state.json on disk
  - /ralph list merges active loop with disk loops
  - /ralph clean removes completed/stopped loop dirs
  - Event rendering via onEvent callback (reuses Phase 0 renderers)
  - Widget: name, iteration/max, status, duration, cost (event-driven, not polling)
  - Status bar: compact summary
  - Command argument completion for loop names
- [x] Simplify types.ts (remove registry, inbox, slug helpers)
- [x] Retire standalone loop-runner.ts (moved to .bak)
- [ ] Test: start a loop, watch it iterate, stop it, check state.json
