---
# agentkit-tpd9
title: Add interactive-shell.ts extension
status: todo
type: task
priority: normal
tags:
    - pi-extension
created_at: 2026-01-26T22:18:13Z
updated_at: 2026-01-26T22:24:18Z
---

Enables running interactive commands (vim, htop, git rebase -i, etc.) with full terminal access. Use !i prefix to force interactive mode. Auto-detects common interactive commands. TUI suspends while they run.

## Tasks
- [ ] Copy/adapt interactive-shell.ts from pi examples
- [ ] Update README.md to document the extension