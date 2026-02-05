---
# agentkit-gybz
title: Fix parallel subagent rendering to show all tasks
status: in-progress
type: bug
created_at: 2026-02-05T00:26:40Z
updated_at: 2026-02-05T00:26:40Z
---

## Problem

When running more than `MAX_CONCURRENCY` (4) parallel subagents, the TUI only shows 4 tasks instead of all submitted tasks (e.g., 7).

**Root cause:** The parallel execution's `onUpdate` filters out null results:
```typescript
results: completedResults.filter((r): r is SingleResult => r !== null),
```

Since `MAX_CONCURRENCY = 4`, only 4 tasks run at a time. The render uses `d.results.length` for both the count and loop, so it only shows 4.

## Solution

Set `totalSteps` in the Details object for parallel mode updates so the render knows the actual task count regardless of how many have started.

## Checklist

- [x] In `index.ts`, add `totalSteps: params.tasks.length` to the parallel onUpdate Details
- [x] In `render.ts`, update the totalCount calculation to prefer `totalSteps` for parallel mode
- [x] In `render.ts`, show pending tasks with agent name and task preview from progress array
- [x] Update README.md to document the parallel live progress feature (this fix improves our existing modification)
- [ ] Test with 7+ parallel tasks to verify all are shown