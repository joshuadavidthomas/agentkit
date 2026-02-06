---
# agentkit-o8ah
title: 'Phase 1: Loop Runner (Core Engine)'
status: completed
type: feature
priority: normal
created_at: 2026-02-06T21:21:43Z
updated_at: 2026-02-06T21:27:48Z
parent: agentkit-y69o
---

Standalone Node.js script that manages the RPC process and iteration loop. Runs detached, survives the foreground pi session. Foundation for everything else.

## Checklist

- [x] Scaffold project structure (loop-runner.ts, types.ts, directory layout)
- [x] Loop runner process management
  - Spawn `pi --mode rpc --no-session` as child process
  - Handle process lifecycle (startup, crash detection)
  - Store PID to `.ralph/<name>/pid`
  - Graceful shutdown on SIGTERM
- [x] Iteration loop
  - Read task file fresh each iteration (agent may update it)
  - Send `prompt` RPC command
  - Parse event stream from RPC stdout
  - Detect `agent_end` -> send `new_session` -> start next iteration
  - Respect max iteration limit
- [x] Filesystem communication
  - Write all RPC events to `events.jsonl` (append-only)
  - Watch `inbox/` directory for command files (steer, followup, stop)
  - Forward inbox commands to RPC stdin
  - Consume (delete) command files after forwarding
- [x] State management
  - Write/update `state.json` after each iteration (atomic tmp+rename)
  - Track: iteration count, status, start time, config, telemetry
- [x] Per-iteration telemetry
  - Accumulate tokens/cost from message_end events
  - Write per-iteration stats to `iterations/NNN.json`
  - Aggregate cumulative stats in `state.json`
- [x] Global process registry (`~/.ralph/registry/`)
  - One file per loop: `--<cwd-slugified>--<name>.json`
  - Register on startup, deregister on clean shutdown
  - Periodic heartbeat (update `lastSeen`, `iteration`)
- [x] Edge cases
  - RPC process crashes mid-iteration (rejects agentEndPromise, writes error state)
  - Stale PID detection (registry kept on error for extension to detect)

## Notes

- Loop runner runs via `node --import @mariozechner/jiti/register loop-runner.ts <ralph-dir>`
- jiti is pi's own TS loader, already a dependency — no new deps needed
- Tested end-to-end: 2 iterations, state.json correct, iteration stats saved, registry lifecycle works, PID file cleaned up