---
# agentkit-cnio
title: Fix ralph extension timing issues
status: completed
type: bug
priority: normal
created_at: 2026-02-08T01:24:35Z
updated_at: 2026-02-08T01:32:19Z
---

Multiple timing bugs in the ralph loop extension causing out-of-order rendering, events leaking after abort, and lost text.

## Bugs

1. **Events continue after kill()** — `handleEvent()` forwards all events even after `stopRequested`, and `kill()` doesn't unsubscribe immediately
2. **currentAssistantText not flushed on message_start** — text from previous message bleeds into next when steers create new turns
3. **Accumulated text lost on abort** — mid-stream text never flushed when kill() is called (no message_end fires)
4. **pendingSteerText is a single value, not a queue** — rapid steers overwrite each other
5. **Alt+Enter (follow-up) and Esc overwritten by pi** — pi's `setEditorComponent()` post-processing copies all `defaultEditor.actionHandlers` onto the custom editor, silently overwriting any `onAction`/`onEscape` handlers the extension registered in the factory

## Checklist

- [x] Guard event forwarding with `stopRequested` in `handleEvent()` (loop-engine.ts)
- [x] Unsubscribe immediately in `kill()` (loop-engine.ts)
- [x] Flush `currentAssistantText` on `message_start` for any role (index.ts)
- [x] Flush accumulated text before `resetRenderingState()` clears it (index.ts)
- [x] Convert `pendingSteerText` from single value to a queue (index.ts)
- [x] Handle Alt+Enter and Esc directly in `RalphEditor.handleInput()` before `super.handleInput()` (index.ts)