---
# agentkit-9ajw
title: Build rust-async skill — Async Patterns and Tokio
status: completed
type: task
priority: normal
created_at: 2026-02-10T19:56:31Z
updated_at: 2026-02-10T20:00:52Z
---

Build the rust-async skill (skill #6 in the PLAN.md build order). This skill covers async/await, tokio, channels, spawning, Send/Sync errors, blocking in async context, graceful shutdown, cancellation, and CPU-bound vs I/O-bound decisions.

## Checklist
- [x] Write SKILL.md with frontmatter, core rules, decision frameworks, channel selection table, production patterns, and review checklist
- [x] Write references/channels-and-select.md — deep dive on channel types, select!, actor pattern
- [x] Write references/blocking-and-bridging.md — spawn_blocking, rayon, dedicated threads, sync↔async bridging
- [x] Write references/production-patterns.md — graceful shutdown, timeouts, backpressure, cancellation safety
- [x] Write README.md with scope and attribution
- [x] Mark skill as DONE in PLAN.md