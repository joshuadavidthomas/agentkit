---
# agentkit-y69o
title: Ralph Loop Extension — detachable agent loops with RPC backend
status: todo
type: feature
priority: normal
created_at: 2026-02-06T18:06:44Z
updated_at: 2026-02-06T19:02:44Z
---

A pi extension for long-running iterative agent loops with detach/attach semantics.

Background loop runner uses pi --mode rpc, communicates via filesystem. Fresh context per iteration via new_session RPC command. Full TUI integration when attached. Global process registry at ~/.ralph/registry.json for cross-project loop discovery.

See IMPLEMENTATION_PLAN.md for the full architecture and phased implementation plan.

## Checklist

- [ ] Phase 1: Loop Runner (core engine — RPC process management, iteration loop, filesystem IPC, global registry, telemetry)
- [ ] Phase 2: Extension Shell (commands, lifecycle, process spawning, list --all via registry)
- [ ] Phase 3: TUI Event Rendering (attached mode — tailing events, rendering in TUI, widget, status bar, cross-project attach)
- [ ] Phase 4: Custom Editor (steering — Enter/Alt+Enter routing, abort)
- [ ] Phase 5: Reflection + Task File Management
- [ ] Phase 6: SKILL.md + Agent Self-Start (ralph_start tool)
- [ ] Phase 7: Polish + Edge Cases (error recovery, log rotation, multi-loop)
- [ ] Stretch: Worktree-based parallel loops (git worktree per loop, isolated branches)