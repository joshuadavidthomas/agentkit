---
# agentkit-6zip
title: Fix ralph steer short-circuit and Esc not working
status: completed
type: bug
priority: normal
created_at: 2026-02-07T17:59:39Z
updated_at: 2026-02-07T18:00:05Z
---

## Problems

1. **Steer causes loop to short-circuit**: Sending a steering message mid-iteration causes the agent to respond and then stop instead of continuing with the original task. Root cause: the wrapper prompt was removed during SDK migration. The old code wrapped steers with "(Respond naturally, do not narrate returning to your task.)" which told the agent to continue after addressing the user input.

2. **Esc does nothing**: In a normal pi session, Esc aborts the current operation. But when ralph is running, the parent pi agent is idle (ralph has its own AgentSession), so Esc has nothing to abort. Need to register an escape shortcut that aborts the ralph session.

## Checklist

- [x] Bring back wrapper prompt in nudge() for steer messages
- [x] Register escape shortcut that aborts the ralph loop when active
