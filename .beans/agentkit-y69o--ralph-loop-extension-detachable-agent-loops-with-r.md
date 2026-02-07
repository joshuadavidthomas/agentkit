---
# agentkit-y69o
title: Ralph Loop Extension — detachable agent loops with RPC backend
status: todo
type: epic
priority: normal
created_at: 2026-02-06T18:06:44Z
updated_at: 2026-02-07T04:17:47Z
---

A pi extension for long-running iterative agent loops with fresh context per iteration.

The loop runs within your pi session — you see everything happening live. The agent reads and updates a task file each iteration as its working memory. Steer the loop mid-iteration, reflect on progress, detect completion.

See IMPLEMENTATION_PLAN.md for the full architecture and phased plan.

## Checklist

- [x] Phase 0: Tracer Bullet (proved RPC loop, event rendering, telemetry)
- [x] Phase 1: In-Session Loop Engine (core loop, TUI rendering, widget, telemetry, commands)
- [x] Phase 2: Input Routing (steering mid-iteration, follow-up between iterations)
- [ ] Phase 3: Reflection + Task File Management (working memory, reflection scheduling, completion detection)
- [ ] Phase 4: SKILL.md + Agent Self-Start (ralph_start tool)
- [ ] Phase 5: Polish + Edge Cases (error recovery, log rotation, config)
- [ ] Phase 6: Detach/Attach — future (extract to detached process, filesystem IPC, global registry)
- [ ] Stretch: Worktree-based parallel loops
