# jj-overview

The gateway skill for Jujutsu (jj), a Git-compatible version control system. Covers the mental model (working copy is a commit, change IDs vs commit IDs, mutable history), agent-specific rules for non-interactive operation, the core daily workflow, essential commands, and recovery patterns. Routes to specialized skills for revsets, sharing, history rewriting, workspaces, and configuration.

## References in this skill

- `references/git-to-jj.md` — Git-to-jj command mapping table for quick translation
- `references/git-experts.md` — Why jj improves on Git for power users (absorb, operation log, evolog, colocation)
- `references/command-gotchas.md` — Flag semantics (`-r`/`-s`/`-f`/`-o`/`-A`/`-B`), quoting rules, deprecated flags, version-specific breaking changes

## Attribution & License

This skill synthesizes guidance from:

- [Jujutsu](https://github.com/jj-vcs/jj) — the jj VCS itself. Official documentation used for reference material (working-copy.md, glossary.md, git-experts.md, cli-revision-options.md). Licensed under [Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0).
- [Steve Klabnik's Jujutsu Tutorial](https://github.com/steveklabnik/jujutsu-tutorial) — narrative tutorial providing mental model and conceptual grounding.
- [jujutsu-skill](https://github.com/danverbraganza/jujutsu-skill) by Dan Verbraganza — agent-specific workflow patterns and environment rules. Licensed under [MIT](https://opensource.org/licenses/MIT).
- [dot-claude jj-workflow](https://github.com/TrevorS/dot-claude) by TrevorS — concise AI-focused daily workflow patterns. Licensed under [ISC](https://opensource.org/licenses/ISC).
- [agent-skills working-with-jj](https://github.com/YPares/agent-skills) by Yves Parès — version-aware (0.36.x) command syntax, `JJ_CONFIG` agent configuration pattern. Licensed under [MIT](https://opensource.org/licenses/MIT).
- [jjtask](https://github.com/Coobaha/jjtask) by Alexander Ryzhikov — anti-patterns and gotchas for agent use. Licensed under [MIT](https://opensource.org/licenses/MIT).
- [sgai](https://github.com/sandgardenhq/sgai) by Sandgarden — Git-to-jj command mapping table (synthesized, not copied). Licensed under modified MIT.
