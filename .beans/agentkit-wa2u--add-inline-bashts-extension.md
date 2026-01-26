---
# agentkit-wa2u
title: Add inline-bash.ts extension
status: todo
type: task
priority: normal
tags:
    - pi-extension
created_at: 2026-01-26T22:18:13Z
updated_at: 2026-01-26T22:24:18Z
---

Expands !\{command\} patterns in user prompts before sending to agent. Example: 'What is in !\{pwd\}?' becomes 'What is in /home/user/project?'. Preserves existing !command whole-line bash behavior.

## Tasks
- [ ] Copy/adapt inline-bash.ts from pi examples
- [ ] Update README.md to document the extension