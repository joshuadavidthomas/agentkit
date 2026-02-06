---
# agentkit-nj71
title: 'Update IMPLEMENTATION_PLAN.md: simplify Phase 4 using input event'
status: completed
type: task
priority: normal
created_at: 2026-02-06T21:15:53Z
updated_at: 2026-02-06T21:16:42Z
---

Replace the custom editor approach in Phase 4 with pi's input event hook. The input event supports action: 'handled' which lets us intercept user input and route it to the loop's inbox instead of the foreground agent. No setEditorComponent needed.