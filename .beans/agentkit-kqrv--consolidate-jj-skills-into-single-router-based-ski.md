---
# agentkit-kqrv
title: Consolidate jj skills into single router-based skill
status: completed
type: task
created_at: 2026-02-18T22:08:59Z
updated_at: 2026-02-18T22:08:59Z
---

Consolidate 6 jj-* skills (jj-overview, jj-config, jj-history, jj-revsets, jj-sharing, jj-workspaces) into a single `jj` skill using the router pattern established in the Svelte5/SvelteKit consolidations.

## Plan

Follow the architecture from SKILL_CONSOLIDATION_PLAN.md:
- Absorb jj-overview teaching content into router SKILL.md
- Create 5 topic files from the other skills' SKILL.md bodies
- Flatten all references (one rename: config.md → config-reference.md)
- Update install script / README

## Checklist

- [x] Study all 6 existing jj skills (SKILL.md + references)
- [x] Create jj/ directory structure
- [x] Write router SKILL.md (~200 lines, teaches + routes)
- [x] Create topic files (config.md, history.md, revsets.md, sharing.md, workspaces.md)
- [x] Move/flatten reference files
- [x] Update README.md install script to register new skill and remove old ones
- [x] Remove old jj-* skill directories
- [x] Test: verify symlinks work with install script
- [x] Update SKILL_CONSOLIDATION_PLAN.md with completed status