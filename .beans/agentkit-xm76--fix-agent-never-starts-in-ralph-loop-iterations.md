---
# agentkit-xm76
title: 'Fix: agent never starts in ralph loop iterations'
status: completed
type: bug
priority: normal
created_at: 2026-02-07T14:23:29Z
updated_at: 2026-02-07T14:23:53Z
---

After the architecture pivot to native pi APIs, the loop runs through all iterations but the agent never processes the task. Root cause: sm.appendMessage() in newSession setup callback only writes to session — it doesn't trigger agent.prompt(). Fix: use pi.sendUserMessage() after newSession() to trigger the agent.