# jj-revsets

Jujutsu's three query languages: revsets for selecting commits, filesets for selecting files, and templates for formatting output. Covers syntax, operators, common patterns, string/date matching, built-in aliases, and practical recipes for daily use. Targets jj 0.36+.

## References in this skill

- `references/revsets.md` — Full revset language reference (symbols, operators, functions, string patterns, date patterns, aliases, examples)
- `references/templates.md` — Full template language reference (keywords, operators, functions, types, color labels, configuration)
- `references/filesets.md` — Fileset language reference (file patterns, operators, functions, quoting rules)

## Attribution & License

This skill synthesizes guidance from:

- [Jujutsu](https://github.com/jj-vcs/jj) — the jj VCS itself. Official documentation used for reference material (revsets.md, templates.md, filesets.md, revsets.toml). Licensed under [Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0).
- [agent-skills working-with-jj](https://github.com/YPares/agent-skills) by Yves Parès — revset quick reference, common pitfalls, useful aliases. Licensed under [MIT](https://opensource.org/licenses/MIT).
- [jjtask](https://github.com/Coobaha/jjtask) by Alexander Ryzhikov — anti-patterns including glob bracket pitfall in description(). Licensed under [MIT](https://opensource.org/licenses/MIT).
