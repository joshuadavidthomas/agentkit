---
# agentkit-qjk4
title: Add vibeusage support to pi statusline
status: completed
type: feature
priority: normal
created_at: 2026-03-02T15:18:17Z
updated_at: 2026-03-02T15:21:28Z
---

Integrate vibeusage CLI output into the pi statusline extension.

## Changes
- Map pi model providers to vibeusage provider names
- Call `vibeusage statusline --short --no-color -p <provider>` and display output on line 2
- Move cost/token stats (currently line 2) to line 1, right-aligned opposite the starship info
- Cache vibeusage output with TTL and refresh on turn boundaries

## Checklist
- [ ] Add vibeusage provider mapping (pi provider → vibeusage provider name)
- [ ] Add vibeusage CLI execution with caching
- [ ] Restructure line 1: starship info left, cost/tokens right-aligned
- [ ] Add line 2: vibeusage statusline output
- [ ] Invalidate vibeusage cache on turn end