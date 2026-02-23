---
# agentkit-6xhd
title: Remove oracle from parallel scouts tool
status: completed
type: task
priority: normal
created_at: 2026-02-23T09:42:37Z
updated_at: 2026-02-23T09:43:36Z
---

The oracle scout should not be callable via the parallel 'scouts' tool. Remove it from the scouts config map, parameter validation, and description.

## Checklist

- [ ] Remove oracle from ScoutsParams scout type description
- [ ] Remove oracle config injection in scouts execute handler
- [ ] Add validation to reject oracle tasks with a clear error message
- [ ] Update scouts tool description to only mention finder and librarian