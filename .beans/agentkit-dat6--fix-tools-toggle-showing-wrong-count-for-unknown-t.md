---
# agentkit-dat6
title: Fix tools toggle showing wrong count for unknown tools
status: in-progress
type: bug
created_at: 2026-02-06T16:46:55Z
updated_at: 2026-02-06T16:46:55Z
---

When an agent has tools not in the available tools list (e.g. 'glob'), they're counted in selectedTools but not shown in the checkbox list, causing a mismatch (shows '4 selected' but only 3 checkboxes visible). Fix by adding unknown tools to the display list with a warning indicator.