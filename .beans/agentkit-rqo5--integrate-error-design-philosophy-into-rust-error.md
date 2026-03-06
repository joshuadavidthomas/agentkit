---
# agentkit-rqo5
title: Integrate error design philosophy into rust-error-handling SKILL.md
status: completed
type: task
priority: normal
created_at: 2026-03-06T16:50:24Z
updated_at: 2026-03-06T16:52:29Z
---

Integrate three key philosophical ideas from the designing-error-types reference into the main SKILL.md:

## Checklist

- [x] Add empathy as the governing principle (the 'why' behind every rule)
- [x] Add 'Define errors in terms of the problem, not the solution' + 'embed, don't wrap' as a named rule
- [x] Acknowledge the tension between chain preservation (Rule 3) and dependency hiding, with guidance on when each applies
- [x] Show how parse-don't-validate removes error variants (connecting to rust-type-design)
- [x] Expand the Box<dyn Error> anti-pattern explanation