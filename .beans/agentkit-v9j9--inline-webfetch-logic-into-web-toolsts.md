---
# agentkit-v9j9
title: Inline webFetch logic into web-tools.ts
status: completed
type: task
priority: normal
created_at: 2026-02-23T09:40:26Z
updated_at: 2026-02-23T09:42:31Z
---

Instead of shelling out to skills/brave-search/content.js, the webFetch tool in pi-extensions/scouts/web-tools.ts should have the fetch+Readability+Turndown logic inline. This eliminates unnecessary child process overhead, enables direct AbortSignal usage, and removes the fragile path dependency on the skills directory.

## Checklist

- [ ] Add @mozilla/readability, jsdom, turndown, turndown-plugin-gfm as root dependencies
- [ ] Add type packages (@types/turndown, etc.) as devDependencies where available
- [ ] Inline htmlToMarkdown helper into web-tools.ts
- [ ] Inline fetchWebContent function (fetch + Readability + fallback) into web-tools.ts
- [ ] Rewrite createWebFetchTool to use the inline function with direct AbortSignal
- [ ] Keep webSearch shelling out to search.js (unchanged)
- [ ] Remove getBraveSearchDir and execScript if no longer needed by webSearch (they still are — keep for webSearch)
- [ ] Install dependencies and verify typecheck passes
- [ ] Test that the extension still loads