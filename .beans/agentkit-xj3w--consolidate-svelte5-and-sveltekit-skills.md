---
# agentkit-xj3w
title: Consolidate Svelte5 and SvelteKit skills
status: completed
type: task
priority: normal
created_at: 2026-02-13T19:43:53Z
updated_at: 2026-02-13T19:48:59Z
---

Consolidate separate Svelte5 (2 skills) and SvelteKit (5 skills) into 2 consolidated router-based skills.

## Design
- Each consolidated skill has a lean SKILL.md router (~40-48 lines) that links directly to ALL topic files and reference files (1 hop max)
- Former SKILL.md bodies become topic files at root level
- Reference files use subdirectories where naming conflicts exist (svelte5) or stay flat (sveltekit)
- Old skill directories removed after consolidation

## Checklist

- [x] Create svelte5/ consolidated skill (SKILL.md router + 2 topic files + 9 reference files in subdirs)
- [x] Create sveltekit/ consolidated skill (SKILL.md router + 5 topic files + 11 reference files flat)
- [x] Remove old svelte5-runes/ and svelte5-class-state/ directories
- [x] Remove old sveltekit-structure/, sveltekit-data-flow/, sveltekit-auth/, sveltekit-forms-validation/, sveltekit-remote-functions/ directories
- [x] Verify all links resolve correctly

## Results
- 7 skills → 2 skills
- 1,465 → 1,010 description chars (31% reduction)
- All 27 markdown links verified ✅
- Zero content lost — all topic content and reference files preserved