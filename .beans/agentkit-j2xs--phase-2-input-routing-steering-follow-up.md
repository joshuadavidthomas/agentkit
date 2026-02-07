---
# agentkit-j2xs
title: 'Phase 2: Input Routing (Steering + Follow-up)'
status: todo
type: feature
created_at: 2026-02-07T15:38:57Z
updated_at: 2026-02-07T15:38:57Z
parent: agentkit-y69o
---

Wire up input interception so typed messages route to the RPC loop process.

## Architecture

Two distinct paths using pi's existing Enter/Alt+Enter keybinding UX:

**Enter (steer)** — interrupts RPC agent after current tool:
1. User presses Enter → pi's onSubmit fires → prompt() → input event
2. Our `pi.on("input", ...)` handler intercepts → returns `{ action: "handled" }`
3. Forward text to RPC as `{ type: "steer", message: text }`

**Alt+Enter (follow-up)** — queued for next iteration:
1. User presses Alt+Enter → our `registerShortcut("alt+enter")` fires FIRST
2. Handler calls `ctx.ui.getEditorText()` to read text
3. Handler calls `ctx.ui.setEditorText("")` to clear editor
4. Queue text via `activeLoop.engine.followUp(text)`
5. Pi's built-in handleFollowUp never runs (shortcut consumed it)

**When no loop is active** — both paths fall through to normal pi behavior:
- input handler returns `{ action: "continue" }`
- alt+enter shortcut handler returns without doing anything (but NOTE: this means pi's built-in followUp won't fire — need to handle this case by manually triggering submission)

## Checklist

- [ ] Register `pi.on("input", ...)` — when loop active, return handled + forward as RPC steer
- [ ] Register `pi.registerShortcut("alt+enter", ...)` — when loop active, read editor text, clear, queue as follow-up
- [ ] Handle alt+enter when NO loop is active (must not break normal pi follow-up behavior)
- [ ] Show visual feedback for queued steer/follow-up messages (echo in TUI via sendMessage)
- [ ] Test: steer mid-iteration interrupts agent after current tool
- [ ] Test: follow-up queues and becomes next iteration prompt
