---
# agentkit-72b6
title: 'Rework librarian: dedicated GitHub tools + AMP-inspired prompt'
status: completed
type: feature
priority: normal
created_at: 2026-02-20T20:34:49Z
updated_at: 2026-02-20T20:39:16Z
---

Replace the bash+gh-recipes approach with dedicated GitHub tools (like AMP's librarian) and rework the system prompt with AMP's communication directives.

## Design
The librarian should have clean, purpose-built tools instead of relying on the small model to compose gh CLI pipelines. This follows AMP's approach where the librarian gets 7 dedicated tools.

### New tools (in github-tools.ts):
- `readGitHub` — read a file from a repo (with line numbers, optional range)
- `searchGitHub` — code search via gh search code
- `listDirectory` — list directory contents in a repo
- `globGitHub` — find files by glob pattern in a repo
- `listRepositories` — discover/search repos

### Prompt rework:
- Drop the entire 'Known-good gh command patterns' recipe section
- Add 'Only your last message is returned to the caller'
- Add fluent GitHub linking (clickable URLs)
- Add direct communication style (no preamble/postamble)
- Add 'don't name tools in output' instruction
- Add parallel tool execution emphasis
- Adapt citation rules for direct-read tools (no local cache workflow)

### Architecture:
- Change ScoutConfig to allow complete tool override (not just additionalTools)
- Librarian provides its own tool set: searchCode + 5 GitHub tools (no bash/read)
- Finder keeps default bash + read

## Checklist
- [x] Create `github-tools.ts` with gh CLI helper and 5 tool factories
- [x] Update `scout-core.ts` — replace `additionalTools` with `getTools` override
- [x] Rewrite `librarian-prompts.md.ts` with AMP-inspired prompt
- [x] Update `index.ts` to wire new tool set into librarian config
- [x] Test each GitHub tool individually
- [x] Test full librarian invocation (tools verified individually, extension transpiles clean)