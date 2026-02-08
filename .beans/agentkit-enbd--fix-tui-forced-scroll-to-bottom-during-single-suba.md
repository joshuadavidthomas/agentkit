---
# agentkit-enbd
title: Fix TUI forced scroll-to-bottom during single subagent execution
status: completed
type: bug
priority: normal
created_at: 2026-02-08T09:08:59Z
updated_at: 2026-02-08T09:15:48Z
---

When a single subagent is launched in pi-subagents extension, the TUI forces scroll to bottom every time a new tool call or message comes in. This prevents the user from scrolling up to review earlier content while the subagent is still running.