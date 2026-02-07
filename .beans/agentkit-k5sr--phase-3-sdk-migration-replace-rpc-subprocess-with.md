---
# agentkit-k5sr
title: 'Phase 3: SDK Migration — replace RPC subprocess with AgentSession'
status: in-progress
type: feature
priority: normal
created_at: 2026-02-07T17:06:16Z
updated_at: 2026-02-07T17:51:42Z
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

- [x] Replace RPC subprocess with `createAgentSession()` in LoopEngine
  - `SessionManager.inMemory()` for no persistence
  - Configure model/provider/thinking via session options
  - Share `AuthStorage` and `ModelRegistry` from parent pi
- [x] Replace `rpcSend({ type: "prompt" })` with `await session.prompt()`
- [x] Replace `rpcSend({ type: "new_session" })` with `await session.newSession()`
- [x] Replace `rpcSend({ type: "steer" })` with `await session.steer()`
  - Removed the wrapper prompt — `session.steer()` handles delivery natively
- [x] Replace JSON event parsing with `session.subscribe()`
  - Same event types, but typed — no more JSON.parse on stdout lines
  - Kept events.jsonl writing (JSON.stringify of typed events) for debugging
- [x] Replace process lifecycle management with `session.dispose()`
  - Removed spawn, detached, unref, process groups, SIGTERM
  - session_shutdown now calls engine.kill() which does abort + dispose
- [x] Replace `agent_end` promise resolution with proper event handling
  - No longer needed — `await session.prompt()` resolves when agent finishes
- [x] Verify: steer user message timing still works (message_start with role user)
  - Uses typed events, message_start still fires with user role for steers
- [x] Verify: telemetry extraction from message_end events still works
  - Uses typed AgentMessage with proper Usage interface
- [x] Remove `/ralph kill` command (no process to kill, stop is sufficient)
- [x] Update index.ts event rendering to use typed events instead of Record<string, unknown> casts

## Notes

- Removed `pid` from `LoopState` type (no subprocess = no PID)
- `kill()` method retained on engine but now calls `session.abort()` + `dispose()` instead of process signals
- Engine constructor now takes `LoopEngineSessionDeps` with modelRegistry, model, and thinkingLevel from parent pi
- Model resolution (string → Model object) happens in index.ts before engine creation
- Events log still written to events.jsonl via JSON.stringify of typed events
