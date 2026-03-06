---
# agentkit-71bb
title: Fix rule numbering and section placement in rust-error-handling SKILL.md
status: completed
type: task
priority: normal
created_at: 2026-03-06T16:53:10Z
updated_at: 2026-03-06T16:54:07Z
---

Restructure SKILL.md to fix rule numbering collision and section misplacement.

## Checklist

- [x] Move 'Define errors in terms of the problem' to Rule 7 under Library Errors
- [x] Move 'Shrink error types with parse-don't-validate' to Rule 8 under Library Errors
- [x] Renumber anyhow rules (current 7/8/9 → 9/10/11)
- [x] Remove rule numbers from boundary section items (Translate, Log once, Retryability all unnumbered)
- [x] Update the reference link framing after the library rules
- [x] Update review checklist if any numbers are referenced (checklist uses descriptive text, not numbers — no changes needed)