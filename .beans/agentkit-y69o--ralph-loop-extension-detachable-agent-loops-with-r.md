---
# agentkit-y69o
title: Ralph Loop Extension — in-session iterative agent loops
status: in-progress
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
- [ ] Phase 3: SDK Migration (replace RPC subprocess with in-process AgentSession)
- [ ] Phase 4: Reflection + Task File Management (working memory, reflection scheduling, completion detection)
- [ ] Phase 5: SKILL.md + Agent Self-Start (ralph_start tool)
- [ ] Phase 6: Polish + Edge Cases (error recovery, config)
