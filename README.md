# agentkit

A personal collection of commands, skills, subagents, and scripts for Claude Code, OpenCode, Codex, and other agentic-based LLM tools.

## Skills

### playwriter

Browser automation via the [Playwriter](https://github.com/remorses/playwriter) Chrome extension. Control user's Chrome browser with full Playwright API access and zero MCP tool context pollution.

The standard Playwriter MCP injects ~400 lines of prompt into every conversation. This skill splits the architecture: MCP manages relay lifecycle (no tools exposed), CLI binary executes Playwright code on-demand. The agent loads the skill only when browser work is needed.

Includes:

- Bun-compiled standalone binaries (no npm install required)
- Full Playwright API via CLI
- Collaborative browsing (user can help with captchas, logins)
- Network interception for API scraping

See the skill's [README](skills/playwriter/README.md) for setup and usage.

## Acknowledgements

This repository includes and adapts work from several sources:

### playwriter

[remorses/playwriter](https://github.com/remorses/playwriter) for the Chrome extension, CDP relay server, and MCP server example.

Minimal CLI approach influenced by the web-browser skill from [mitsuhiko/agent-stuff](https://github.com/mitsuhiko/agent-stuff) and [lackeyjb/playwright-skill](https://github.com/lackeyjb/playwright-skill).

## License

agentkit is licensed under the MIT license. See the [`LICENSE`](LICENSE) file for more information.
