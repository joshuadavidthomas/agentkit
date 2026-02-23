---
# agentkit-dtvf
title: 'Pi extension: skill usage tracker'
status: completed
type: feature
priority: normal
created_at: 2026-02-23T23:01:55Z
updated_at: 2026-02-23T23:02:41Z
---

Create a pi extension that tracks how many times skills are used. Skills in pi are loaded via the `read` tool when the agent reads a SKILL.md file.

## Design

- **Detection**: Listen to `tool_result` events for the `read` tool and check if the path matches a SKILL.md file
- **Persistent storage**: Write cumulative stats to `~/.pi/agent/skill-usage.json` (survives across sessions)
- **Session state**: Track per-session counts via `appendEntry` (supports branching/forking)
- **Display**: `/skills` command shows all-time and per-session usage stats
- **Path handling**: Normalize `@` prefix, `~` expansion, relative paths

## Checklist

- [ ] Create `pi-extensions/skill-usage.ts` with the extension
- [ ] Test that it loads without errors
- [ ] Run the install script to symlink it