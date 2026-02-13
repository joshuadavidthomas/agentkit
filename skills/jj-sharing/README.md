# jj-sharing

Jujutsu (jj) sharing and collaboration: bookmarks (jj's branches), remotes, pushing and pulling, GitHub/GitLab PR workflows, stacked PRs, colocated repos, and working with multiple remotes. Covers the agent-safe patterns for all remote operations including the critical bookmark-before-push workflow, auto-tracking configuration, and force-push safety. Targets jj 0.36+.

## References in this skill

- `references/bookmarks.md` — Full bookmarks reference: creation, tracking, auto-advance rules, push safety checks, conflicts, and ease-of-use shortcuts
- `references/github.md` — GitHub/GitLab workflow details: named vs generated bookmarks, updating PRs, colocated workspaces, GitHub CLI workaround, useful revsets, multiple remotes
- `references/git-compatibility.md` — Git interop: supported features, colocated workspaces, colocation management, format mapping details

## Attribution & License

This skill synthesizes guidance from:

- [Jujutsu](https://github.com/jj-vcs/jj) — the jj VCS itself. Official documentation used for reference material (bookmarks.md, github.md, git-compatibility.md). Licensed under [Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0).
- [Steve Klabnik's Jujutsu Tutorial](https://github.com/steveklabnik/jujutsu-tutorial) — sharing-code chapters covering remotes, named branches, and updating PRs.
- [dot-claude jj-workflow](https://github.com/TrevorS/dot-claude) by TrevorS — push workflow patterns, auto-track configuration tip. Licensed under [ISC](https://opensource.org/licenses/ISC).
- [jujutsu-skill](https://github.com/danverbraganza/jujutsu-skill) by Dan Verbraganza — bookmark and push workflow patterns for agents. Licensed under [MIT](https://opensource.org/licenses/MIT).
