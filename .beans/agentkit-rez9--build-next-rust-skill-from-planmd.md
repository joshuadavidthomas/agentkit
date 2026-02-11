---
# agentkit-rez9
title: Build next Rust skill from PLAN.md
status: completed
type: task
priority: normal
created_at: 2026-02-11T00:19:37Z
updated_at: 2026-02-11T00:29:35Z
---

Follow PLAN.md build order. Load skill-authoring guidance, identify the next skill with Status != DONE, read the listed reference material, implement the skill under skills/, and update PLAN.md marking it DONE.

## Checklist

- [x] Read PLAN.md and pick the next TODO skill in build order
- [x] Read relevant reference material for that skill from reference/
- [x] Implement skill: skills/rust-interop/SKILL.md
- [x] Implement skill: skills/rust-interop/references/*.md
- [x] Implement skill: skills/rust-interop/README.md
- [x] Move C-level FFI guidance from rust-unsafe to rust-interop (update rust-unsafe SKILL.md + references)
- [x] Update PLAN.md marking rust-interop as DONE
- [x] Run a quick repo-wide check for broken links/paths (rg)
