---
# agentkit-asqa
title: Handle read tool EISDIR errors gracefully
status: completed
type: feature
priority: normal
created_at: 2026-02-08T20:41:17Z
updated_at: 2026-02-08T20:41:46Z
---

Agents constantly call the read tool on directories, causing EISDIR errors. Create a pi extension that intercepts this error via tool_result and instead returns: 1) An ls -la listing of the directory, 2) A hint telling the agent to use bash tools (ls, find, etc.) for directories.

## Checklist
- [x] Create extension at runtimes/pi/extensions/read-dir.ts
- [x] Intercept tool_result for read tool when EISDIR is detected
- [x] Run ls -la on the directory path and return listing
- [x] Include a hint message for the agent
- [x] Symlink to ~/.pi/agent/extensions/