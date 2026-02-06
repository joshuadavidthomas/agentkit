---
# agentkit-3xmq
title: Fix single subagent result to show interleaved tools and text
status: completed
type: bug
priority: normal
created_at: 2026-02-06T17:01:51Z
updated_at: 2026-02-06T17:02:21Z
---

In single subagent results, all tool calls are grouped at the top and the text output is at the bottom. Instead, tool calls and text messages should be shown in chronological order, with the final output at the bottom.