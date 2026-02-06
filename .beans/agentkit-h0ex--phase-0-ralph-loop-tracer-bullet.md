---
# agentkit-h0ex
title: 'Phase 0: Ralph Loop Tracer Bullet'
status: in-progress
type: task
created_at: 2026-02-06T19:30:48Z
updated_at: 2026-02-06T19:30:48Z
parent: agentkit-y69o
---

Tracer bullet to prove the two core bets: (1) the RPC iteration loop works with fresh context per iteration, and (2) we can watch a background loop's output from a foreground pi session with native TUI rendering.

## Part A — Loop Runner script (loop-runner.ts)
Standalone script, run with bun:
- [x] Spawn `pi --mode rpc --no-session` as a child process
- [x] Send a prompt via RPC stdin
- [x] Read RPC stdout line by line, write each event to `.ralph/test/events.jsonl`
- [x] On `agent_end` event → send `{"type": "new_session"}`
- [x] Send prompt #2
- [x] On second `agent_end` → exit

## Part B — Minimal viewer extension (index.ts)
A pi extension with one command:
- [x] `/ralph demo` command that spawns loop-runner.ts as a detached process
- [x] Tails `.ralph/test/events.jsonl`
- [x] On tool_execution_end events → pi.sendMessage() with custom renderer
- [x] On message_end events → pi.sendMessage() with custom renderer

## Success Criteria
Run `/ralph demo`, watch two iterations stream through the TUI with proper tool call rendering and assistant message formatting, then the loop exits.