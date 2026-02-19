---
# agentkit-66s9
title: Investigate incorrect skill symlink targets from install
status: completed
type: task
priority: normal
created_at: 2026-02-19T19:41:10Z
updated_at: 2026-02-19T19:43:00Z
---

User reported potentially incorrect links under ~/.agents/skills and asked whether install script is responsible.

Findings:
- The double trailing slash in some link targets is harmless path formatting.
- Actual broken links were stale symlinks to skills removed/renamed in this repo.
- install.sh recreated current links but did not prune stale repo-owned links.

## Checklist
- [x] Inspect install/linking scripts in this repo
- [x] Verify how symlink target paths are constructed
- [x] Confirm whether malformed links come from script logic
- [x] Report findings and recommended fix