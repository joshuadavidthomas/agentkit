---
# agentkit-l5oq
title: Add /agents settings widget to pi-subagents extension
status: in-progress
type: feature
created_at: 2026-02-06T15:42:29Z
updated_at: 2026-02-06T15:42:29Z
---

Add a /agents command that opens a settings widget showing all available subagents in the session. When selecting an agent, it shows a detail view with all frontmatter config values editable. The model setting should use a filterable model picker from available pi models. Should also support opening the agent file in $EDITOR.

## Checklist

- [x] Create agent-settings.ts with the AgentSettingsComponent
- [x] Implement agent list view (browse all discovered agents)
- [x] Implement agent detail view (show/edit frontmatter config)
- [x] Implement model picker (filterable list of available pi models)
- [x] Implement text input submenu for string fields
- [x] Implement save-back to agent .md files (re-serialize frontmatter)
- [x] Add 'open in $EDITOR' action
- [x] Register /agents command in index.ts
- [ ] Test the widget works end-to-end