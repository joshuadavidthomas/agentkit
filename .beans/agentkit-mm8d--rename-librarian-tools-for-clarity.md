---
# agentkit-mm8d
title: Rename librarian tools for clarity
status: completed
type: task
priority: normal
created_at: 2026-02-21T01:10:01Z
updated_at: 2026-02-21T01:11:19Z
---

Rename the librarian's tools for a consistent, clear naming scheme.

## Renames
- searchCode -> grepGitHub
- searchGitHub -> (no change)
- readGitHub -> readRepoFile
- listDirectory -> listRepoDirectory
- globGitHub -> findRepoFiles
- listRepositories -> searchRepos

## Files to update
- grep-app-tool.ts (name + label)
- github-tools.ts (all 5 tools: name + label + factory function names)
- librarian-prompts.md.ts (tool references in system prompt)
- scout-core.ts (renderScoutResult tool name formatting if any)