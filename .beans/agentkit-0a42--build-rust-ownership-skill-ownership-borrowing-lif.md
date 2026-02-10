---
# agentkit-0a42
title: Build rust-ownership skill — Ownership, Borrowing, Lifetimes
status: completed
type: task
priority: normal
created_at: 2026-02-10T17:15:27Z
updated_at: 2026-02-10T17:19:46Z
---

Build the rust-ownership skill following PLAN.md specification. This is skill #4 in the build order (Phase 2: Core Language).

## Scope
Covers: E0382, E0505, E0597, E0106, E0507, E0716, choosing smart pointers, function signature design, fighting the borrow checker.

Shape: Error-code-to-design-question table at top. Pointer type decision tree. Function signature rules with quantified impact. 'When clone is fine' section. Review checklist.

## Checklist
- [x] Read skill-authoring skill for format guidance
- [x] Read PLAN.md for full context
- [x] Study existing rust-* skills for patterns (rust-idiomatic, rust-error-handling, rust-type-design)
- [x] Read reference material (pretzelhammer lifetime misconceptions, pretzelhammer std traits, dot-skills own-* rules, rust-skills m01-ownership, Rust Reference lifetime elision, Rust Book ch4/10/15)
- [x] Write SKILL.md (under 500 lines)
- [x] Write references/smart-pointers.md (Box/Rc/Arc/Weak/Cell/RefCell decision framework)
- [x] Write references/lifetime-patterns.md (elision rules, struct lifetimes, common misconceptions, HRTB)
- [x] Write references/function-signatures.md (&str vs &String, &[T] vs &Vec<T>, Into<T>, AsRef<T>, Cow)
- [x] Write README.md (catalog entry + attribution)
- [x] Mark skill as DONE in PLAN.md