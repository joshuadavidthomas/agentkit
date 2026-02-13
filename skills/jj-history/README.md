# jj-history

Jujutsu (jj) history rewriting and investigation: squashing, absorbing, rebasing, splitting commits (agent-safe approaches), resolving merge conflicts, handling divergent changes, investigating past changes (annotate, evolog, diff), abandoning and cleaning up commits, and verifying history after major rewrites. Targets jj 0.36+.

## References in this skill

- `references/conflicts.md` — Conflict handling details: first-class conflict model, conflict marker formats (diff-based, snapshot, git-compatible), marker semantics, and resolution approach
- `references/divergence.md` — Divergent changes guide: what causes divergence, how to identify it, and resolution strategies (abandon, new change ID, squash)

## Attribution & License

This skill synthesizes guidance from:

- [Jujutsu](https://github.com/jj-vcs/jj) — the jj VCS itself. Official documentation used for reference material (conflicts.md, guides/divergence.md, git-experts.md). Licensed under [Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0).
- [Steve Klabnik's Jujutsu Tutorial](https://github.com/steveklabnik/jujutsu-tutorial) — conflict resolution walkthrough and the new+squash resolution pattern.
- [dotfiles jj-history-investigation](https://github.com/edmundmiller/dotfiles) by Edmund Miller — history investigation techniques, commit splitting patterns, immutability override workflow. Licensed under [MIT](https://opensource.org/licenses/MIT).
- [agent-skills working-with-jj](https://github.com/YPares/agent-skills) by Yves Parès — rebase flag semantics, split command syntax. Licensed under [MIT](https://opensource.org/licenses/MIT).
- [jujutsu-skill](https://github.com/danverbraganza/jujutsu-skill) by Dan Verbraganza — squash workflow, split interactivity warning. Licensed under [MIT](https://opensource.org/licenses/MIT).
