---
# agentkit-7kf3
title: Build rust-type-design skill
status: completed
type: task
priority: normal
created_at: 2026-02-10T14:06:38Z
updated_at: 2026-02-10T14:11:08Z
---

Create the rust-type-design skill for AI agents. This is skill #2 in the build order per PLAN.md. The skill covers newtype patterns, typestate, phantom types, builder pattern, and domain modeling techniques.

Key references:
- The Typestate Pattern in Rust (Cliffle)
- Make Illegal States Unrepresentable (corrode)
- Rust API Guidelines (C-NEWTYPE, C-CUSTOM-TYPE, C-BUILDER)
- Rust Design Patterns (newtype, builder)
- Effective Rust ch 1 (types)

Structure:
- SKILL.md (<500 lines) - patterns + decision framework + checklist
- README.md - attribution
- references/ - deep-dive content for each pattern