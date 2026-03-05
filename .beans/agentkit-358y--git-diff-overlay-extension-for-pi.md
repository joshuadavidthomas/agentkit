---
# agentkit-358y
title: Git diff overlay extension for pi
status: completed
type: feature
priority: normal
created_at: 2026-03-05T21:41:21Z
updated_at: 2026-03-05T22:29:46Z
---

A pi extension that shows git diff output in a scrollable overlay.

## Design
- Run `git diff --color=always` (respects user's git config)
- Render ANSI-styled output in a scrollable pi overlay
- Keyboard: up/down/j/k, page up/page down, home/end/g/G, q/escape to close
- Tab to toggle between unstaged and staged diffs
- Shortcut: ctrl+shift+g, Command: /diff (supports extra args like `/diff --cached HEAD~3`)

## Checklist
- [x] Build scrollable diff overlay component
- [x] Run git diff with color, split into lines
- [x] Support staged/unstaged toggle
- [x] Register shortcut and command
- [x] Handle edge cases (no changes, not a git repo)
- [ ] Test it works