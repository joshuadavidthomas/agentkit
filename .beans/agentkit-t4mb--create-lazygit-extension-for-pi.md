---
# agentkit-t4mb
title: Create lazygit extension for pi
status: scrapped
type: feature
priority: normal
created_at: 2026-03-05T21:11:03Z
updated_at: 2026-03-05T21:39:54Z
---

Create a pi extension that launches lazygit inside pi's TUI, similar to neovim's <leader>gg keybinding.

## Architecture

- **Overlay mode** (primary): Uses `node-pty` to spawn lazygit in a PTY and `@xterm/headless` to parse terminal output into a virtual screen buffer, then renders as ANSI lines in pi's overlay system
- **Full-screen fallback**: If deps aren't installed, suspends pi's TUI (`tui.stop()`), spawns lazygit with `stdio: inherit`, restores TUI on exit

## Keybinding
- `ctrl+shift+g` (same as joelazar's implementation — `ctrl+g` conflicts with built-in `externalEditor`)
- `/lazygit` command

## Notes
- Neovim can do this trivially because it has a built-in terminal emulator (libvterm). Pi's overlay system renders components, not terminal apps, so we built a terminal emulation layer.
- No existing pi extensions use this overlay-with-PTY approach — this is novel.
- May have edge cases with key encoding (Kitty protocol), cursor rendering, or terminal capability queries.

## Checklist
- [x] Create directory extension structure with package.json
- [x] Implement terminal buffer to ANSI line converter
- [x] Implement overlay mode with node-pty + @xterm/headless
- [x] Implement full-screen fallback
- [x] Register shortcut (ctrl+shift+g) and command (/lazygit)
- [x] Install npm dependencies
- [ ] Test overlay mode works correctly
- [ ] Test full-screen fallback works