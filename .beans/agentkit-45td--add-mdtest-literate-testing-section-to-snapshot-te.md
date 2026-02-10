---
# agentkit-45td
title: Add mdtest literate testing section to snapshot-testing reference
status: completed
type: task
priority: normal
created_at: 2026-02-10T21:07:00Z
updated_at: 2026-02-10T21:08:15Z
---

Add a section covering ruff/ty's mdtest approach to the rust-testing snapshot-testing reference. mdtest is a literate testing framework where Markdown files are executable test suites with inline comment assertions, representing a fundamentally different approach to snapshot testing that's especially powerful for compiler/analyzer testing.

## Checklist
- [ ] Add mdtest section to references/snapshot-testing.md
- [ ] Cover: architecture, inline assertions, multi-file tests, config cascading, dual snapshot model
- [ ] Show how it contrasts with traditional insta approach
- [ ] Keep prescriptive tone — when to use this pattern
- [ ] Update SKILL.md if needed to reference the new content