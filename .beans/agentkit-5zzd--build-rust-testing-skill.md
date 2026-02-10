---
# agentkit-5zzd
title: Build rust-testing skill
status: completed
type: task
priority: normal
created_at: 2026-02-10T20:47:43Z
updated_at: 2026-02-10T20:52:57Z
---

Build the rust-testing skill (skill #7 in the build order). This is an ecosystem-survey skill covering the Rust testing landscape: built-in testing, property testing (proptest), snapshot testing (insta), benchmarking (criterion), fixtures/parameterization (rstest), mocking (mockall), fuzzing (cargo-fuzz), and test runner (nextest).

Shape: Ecosystem survey — what tools exist, when to use each, how to set up. Testing pyramid for Rust. Organization conventions. Quick-start for each tool.

## Checklist
- [x] Create SKILL.md with frontmatter, core rules, tool selection table, organization patterns, review checklist
- [x] Create references/property-testing.md (proptest deep dive)
- [x] Create references/snapshot-testing.md (insta deep dive)  
- [x] Create references/benchmarking-and-fuzzing.md (criterion + cargo-fuzz)
- [x] Create README.md with scope and attribution
- [x] Mark skill as DONE in PLAN.md