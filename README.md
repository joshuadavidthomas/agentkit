# agentkit

A personal collection of commands, skills, subagents, and scripts for Claude Code, OpenCode, Codex, and other agentic-based LLM tools.

## Skills

### [btca](./skills/btca/SKILL.md)

Query codebases semantically using LLMs. Use when asking questions about libraries, frameworks, or source code — searches actual source, not outdated docs.

Wraps the [btca (Better Context App)](https://btca.dev) CLI tool. Covers installation, resource management (git repos and local codebases), model configuration via OpenCode, and includes example configs with common resources like Svelte and Tailwind.

### [frontend-design-principles](./skills/frontend-design-principles/SKILL.md)

Create polished, intentional frontend interfaces. Fights the tendency toward generic AI output by requiring domain exploration and self-checks before generating code.

Includes:

- Required pre-generation gates (intent questions, four outputs: domain, color world, signature, defaults to reject)
- Required pre-showing checks (swap test, squint test, signature test, token test)
- Principles for avoiding sameness and default thinking
- Specialized guidance for app interfaces (dashboards, tools) and marketing (landing pages, creative work)
- Technical foundations (spacing, oklch colors, depth strategies, dark mode)

### [writing-cli-skills](./skills/writing-cli-skills/SKILL.md)

Guide for writing skills that wrap CLI tools. Use when creating a new CLI skill or reviewing an existing one.

The key constraint: hands-on use over documentation. Install the tool, try it yourself, note what surprises you. Reading docs is no substitute for actually running commands. Provides section templates, organization patterns (group by task, progressive disclosure), and a complete starting template in `references/`.

## Acknowledgements

This repository includes and adapts work from several sources.

### frontend-design-principles

Cobbled together from:

- The [frontend-design](https://github.com/anthropics/skills/tree/main/frontend-design) skill in [anthropics/skills](https://github.com/anthropics/skills) (Apache 2.0)
- [Dammyjay93/interface-design](https://github.com/Dammyjay93/interface-design) (MIT, Damola Akinleye)
- [Teaching Claude to Design Better: Improving Anthropic's Frontend Design Skill](https://www.justinwetch.com/blog/improvingclaudefrontend) by Justin Wetch

## License

agentkit is licensed under the MIT license. See the [`LICENSE`](LICENSE) file for more information.
