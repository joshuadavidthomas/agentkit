---
# agentkit-ar75
title: Pi extension for peon-ping
status: completed
type: feature
priority: normal
created_at: 2026-02-13T17:56:30Z
updated_at: 2026-02-13T18:03:05Z
---

Build a pi extension that integrates peon-ping sound packs natively with pi lifecycle events, replacing the shell-hook approach.

## Design

- Reuses existing peon-ping installation at `~/.claude/hooks/peon-ping/` (packs, config)
- Maps pi events to peon-ping sound categories
- Single `/peon` command with subcommands: toggle, pack, status, volume, preview
- Cross-platform audio via shelling out (afplay, pw-play, paplay, etc.)

## Event mapping

| pi event | peon-ping category |
|----------|-------------------|
| `session_start` | `session.start` |
| `agent_start` | `task.acknowledge` + `user.spam` detection |
| `agent_end` | `task.complete` |
| `tool_call` (blocked) | `input.required` |

## Checklist

- [x] Core extension scaffold with config/pack loading
- [x] Platform-aware audio playback (mac/linux/wsl)
- [x] Event handlers: session_start, agent_start, agent_end
- [x] Sound category routing + random selection with no-repeat
- [x] User spam detection (rapid prompt tracking)
- [x] `/peon` command with subcommands (toggle, status, pack list, pack use, volume, preview, install)
- [x] Pause/resume state persistence
- [x] Desktop notifications on task complete (OSC 777)
- [x] Debounce rapid stop events