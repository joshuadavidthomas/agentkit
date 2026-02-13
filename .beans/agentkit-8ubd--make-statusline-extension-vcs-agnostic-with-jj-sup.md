---
# agentkit-8ubd
title: Make statusline extension VCS-agnostic with jj support
status: completed
type: feature
priority: normal
created_at: 2026-02-13T21:16:25Z
updated_at: 2026-02-13T21:18:15Z
---

Refactor the statusline.ts pi extension to support both git and jj (Jujutsu) version control systems. Abstract VCS detection and status into a provider pattern, add jj provider using template-based single-command status extraction, and update rendering for jj-specific display.

## Checklist

- [x] Extract VcsProvider interface and VcsStatus type
- [x] Refactor existing git code into a git provider function
- [x] Add jj provider using jj log template + jj diff --summary
- [x] Add VCS detection (prefer .jj/ over .git/ for colocated repos)
- [x] Update renderer to vary icon/format by VCS type
- [x] Rename git-specific cache/comments to VCS-generic
- [x] Test that extension still compiles/loads