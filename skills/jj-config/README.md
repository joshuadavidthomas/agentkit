# jj-config

Configuration and customization skill for Jujutsu (jj). Covers config file locations and precedence, agent-specific setup using `JJ_CONFIG`, useful aliases (command and revset), diff/merge tool configuration, commit signing, auto-track settings for remotes, template customization, conditional config, and `jj fix` code formatting tools. Routes to **jj-revsets** for template language details and **jj-overview** for the core mental model.

## References in this skill

- `references/config.md` — Full configuration reference from the official jj documentation (~2100 lines covering all config options, TOML syntax, merge tools, signing, pager, filesystem monitor, and more)

## Attribution & License

This skill synthesizes guidance from:

- [Jujutsu](https://github.com/jj-vcs/jj) — the jj VCS itself. Official documentation used for reference material (config.md). Licensed under [Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0).
- [agent-skills working-with-jj](https://github.com/YPares/agent-skills) by Yves Parès — `JJ_CONFIG` agent configuration pattern. Licensed under [MIT](https://opensource.org/licenses/MIT).
- [dot-claude jj-workflow](https://github.com/TrevorS/dot-claude) by TrevorS — auto-track tip for push workflows. Licensed under [ISC](https://opensource.org/licenses/ISC).
