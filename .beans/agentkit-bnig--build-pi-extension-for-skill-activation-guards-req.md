---
# agentkit-bnig
title: Build pi extension for skill activation guards (requires-path)
status: completed
type: feature
priority: normal
created_at: 2026-02-18T22:30:16Z
updated_at: 2026-02-18T22:32:21Z
---

Create a pi extension that reads `metadata.requires-path` from skill frontmatter and strips skills from the system prompt when the required path doesn't exist in the project.

## Design

- Skills declare path requirements via frontmatter metadata:
  ```yaml
  metadata:
    requires-path: ".jj/"
  ```
- Extension scans skill directories on session_start, parses frontmatter
- On before_agent_start, checks if required paths exist relative to ctx.cwd
- Strips `<skill>` entries from system prompt XML when paths are missing

## Checklist

- [ ] Write the extension (pi-extensions/skill-activation-guard.ts)
- [ ] Add metadata.requires-path to jj skill
- [ ] Test: verify skill is stripped in non-jj repos
- [ ] Commit