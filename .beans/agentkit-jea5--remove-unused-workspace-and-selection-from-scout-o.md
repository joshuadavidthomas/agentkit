---
# agentkit-jea5
title: Remove unused workspace and selection from scout output
status: completed
type: task
priority: normal
created_at: 2026-02-21T02:30:05Z
updated_at: 2026-02-21T02:32:57Z
---

The librarian scout creates a temp workspace dir (/tmp/pi-librarian/run-XXX) that nothing writes to — bash/read tools were removed, and all GitHub tools use gh API calls directly. The workspace path and model selection reason were displayed in the TUI footer, adding noise.

## Changes
- [x] Remove workspace and selection footer from renderScoutResult in scout-core.ts
- [x] Remove getWorkspace from librarian config in index.ts
- [x] Remove workspace-related code from scout-core.ts (getWorkspace calls, workspace tracking in ScoutDetails, SubagentSelectionInfo)