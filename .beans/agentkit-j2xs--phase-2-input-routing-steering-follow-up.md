---
# agentkit-j2xs
title: 'Phase 2: Input Routing (Steering + Follow-up)'
status: in-progress
type: feature
priority: normal
created_at: 2026-02-07T15:38:57Z
updated_at: 2026-02-07T15:55:16Z
parent: agentkit-y69o
---

Wire up input interception so typed messages route to the RPC loop process.

## Architecture

Two distinct paths:

**Enter (steer)** — interrupts RPC agent after current tool:
- `pi.on("input")` intercepts → returns `{ action: "handled" }`
- Forwards text to RPC as `{ type: "steer", message }`
- Shows "Steer: ..." border in TUI

**Ctrl+Shift+Enter (follow-up)** — queued for next iteration:
- `pi.registerShortcut("ctrl+shift+enter")` fires
- Reads editor via `ctx.ui.getEditorText()`, clears via `ctx.ui.setEditorText("")`
- Queues via `engine.followUp(text)` — becomes next iteration prompt
- Shows "Queued for next iteration: ..." border in TUI

When no loop active, both fall through to normal pi behavior.

## Checklist

- [x] Register `pi.on("input", ...)` — when loop active, return handled + forward as RPC steer
- [x] Register `pi.registerShortcut("ctrl+shift+enter", ...)` — when loop active, read editor, clear, queue follow-up
- [x] When no loop active: input returns continue, shortcut is no-op
- [x] Visual feedback: ralph_steer and ralph_followup message renderers echo what was sent
- [ ] Test: steer mid-iteration interrupts agent after current tool
- [ ] Test: follow-up queues and becomes next iteration prompt
