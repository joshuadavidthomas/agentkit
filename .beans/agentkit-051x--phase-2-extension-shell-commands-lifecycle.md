---
# agentkit-051x
title: 'Phase 2: Extension Shell (Commands + Lifecycle)'
status: completed
type: feature
priority: normal
created_at: 2026-02-06T22:19:06Z
updated_at: 2026-02-06T22:22:40Z
parent: agentkit-y69o
---

The pi extension that provides commands and manages loop lifecycle. No TUI rendering yet — just spawning, stopping, and basic status.

## Checklist

- [x] Extension skeleton: refactor index.ts to support subcommands while keeping Phase 0 demo
- [x] `/ralph start <name> [options]` command: create directory structure, write config/task, spawn detached loop runner, auto-attach
- [x] `/ralph stop [name]` command: write stop.json to inbox
- [x] `/ralph status [name]` command: read state.json, show iteration/status/cost summary
- [x] `/ralph list [--all]` command: enumerate local .ralph/*/state.json and global registry
- [x] `/ralph kill <name>` command: SIGTERM to loop runner PID
- [x] `/ralph clean` command: remove completed/stopped loop directories
- [x] Process health checking: on session_start, scan registry, verify PIDs, prune stale entries, notify user
- [x] Options passthrough: --model, --provider, --thinking, --max-iterations

## Implementation Notes

All commands implemented in `runtimes/pi/extensions/ralph/index.ts`.

### Key design decisions:
- Subcommand parsing via split on first token of args string
- `/ralph start` opens an editor for task content if no `--task` flag provided
- Name validation: alphanumeric, dots, hyphens, underscores only
- Existing running loops detected and rejected (no duplicate starts)
- Task file reuse: if a loop dir already has task.md, it's reused on restart
- Events file cleared on each new start for clean log
- jiti register resolved via `import.meta.resolve` with filesystem fallback
- Health check runs on `session_start`: prunes stale registry, notifies about running/orphaned loops
- Status/list commands render markdown tables via `ralph_assistant` message renderer
- Clean command confirms via `ctx.ui.confirm()` before deleting
