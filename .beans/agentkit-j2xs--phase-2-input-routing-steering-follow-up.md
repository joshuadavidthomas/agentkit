---
# agentkit-j2xs
title: 'Phase 2: Input Routing (Steering + Follow-up)'
status: in-progress
type: feature
priority: normal
created_at: 2026-02-07T15:38:57Z
updated_at: 2026-02-07T16:20:21Z
parent: agentkit-y69o
---

Wire up input interception so typed messages route to the RPC loop process.

## Architecture

Two distinct paths:

**Enter (nudge)** — steer RPC agent mid-iteration (non-interrupting via continuation prompt):
- `pi.on("input")` intercepts → returns `{ action: "handled" }`
- Forwards text to RPC as `{ type: "steer", message: wrappedText }`
- Wrapped with "address this, then continue your original task"
- Agent finishes current tool, addresses nudge, resumes remaining work

**Alt+N (queue for next iteration)**:
- `pi.registerShortcut("alt+n")` fires
- Reads editor via `ctx.ui.getEditorText()`, clears via `ctx.ui.setEditorText("")`
- Queues via `engine.queueForNextIteration(text)` — becomes next iteration prompt

When no loop active, both fall through to normal pi behavior.

## Checklist

- [x] Register `pi.on("input", ...)` — when loop active, return handled + forward as RPC steer with continuation prompt
- [x] Register shortcut for queue-for-next-iteration (alt+n)
- [x] When no loop active: input returns continue, shortcut is no-op
- [x] Test: nudge mid-iteration — agent addresses message and continues task
- [x] Test: queue for next iteration
- [ ] Sticky pending message display — nudge/follow-up messages currently appear inline in chat scroll and disappear. Should be sticky above editor (like native pi's pending message display) until consumed. Replace inline sendMessage with widget-based display.
