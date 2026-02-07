---
# agentkit-k5sr
title: 'Phase 3: SDK Migration — replace RPC subprocess with AgentSession'
status: todo
type: feature
created_at: 2026-02-07T17:06:16Z
updated_at: 2026-02-07T17:06:16Z
parent: agentkit-y69o
---

Replace the RPC subprocess (`pi --mode rpc --no-session`) in LoopEngine with the pi SDK (`createAgentSession`). This eliminates all process management complexity (spawn, detached, unref, process groups, SIGTERM, Ctrl+C handling) while keeping the same user-facing behavior.

The SDK provides everything the RPC mode did as typed method calls:
- `session.prompt()` → iteration prompts
- `session.steer()` → mid-iteration steering
- `session.followUp()` → queue for after
- `session.newSession()` → fresh context between iterations
- `session.subscribe()` → typed event stream
- `session.dispose()` → clean shutdown

## Checklist

- [ ] Replace RPC subprocess with `createAgentSession()` in LoopEngine
  - `SessionManager.inMemory()` for no persistence
  - Configure model/provider/thinking via session options
  - Share `AuthStorage` and `ModelRegistry` from parent pi
- [ ] Replace `rpcSend({ type: "prompt" })` with `await session.prompt()`
- [ ] Replace `rpcSend({ type: "new_session" })` with `await session.newSession()`
- [ ] Replace `rpcSend({ type: "steer" })` with `await session.steer()`
  - Remove the wrapper prompt — `session.steer()` handles delivery natively
- [ ] Replace JSON event parsing with `session.subscribe()`
  - Same event types, but typed — no more JSON.parse on stdout lines
  - Remove readline, events.jsonl writing (or keep for debugging)
- [ ] Replace process lifecycle management with `session.dispose()`
  - Remove spawn, detached, unref, process groups, SIGTERM
  - Remove session_shutdown handler (dispose is instant)
- [ ] Replace `agent_end` promise resolution with proper event handling
- [ ] Verify: steer user message timing still works (message_start with role user)
- [ ] Verify: telemetry extraction from message_end events still works
- [ ] Remove `/ralph kill` command (no process to kill, stop is sufficient)
- [ ] Update index.ts event rendering to use typed events instead of Record<string, unknown> casts