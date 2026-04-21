# custom-provider-claude-agent-sdk

Pi custom provider that wraps Anthropic's Claude Agent SDK.

## What it does

- Registers a `claude-agent-sdk` provider in pi
- Uses the Claude Agent SDK as the backend runtime instead of a plain model API
- Persists the SDK `session_id` in the current pi session so later prompts resume the same Claude session
- Lets the SDK run its own built-in tools
- Shows recent SDK tool activity in a pi widget using `ToolExecutionComponent`
- Adds a `/claude` command with subcommands for runtime inspection and reloads

## Requirements

- `ANTHROPIC_API_KEY`

## Models

- `claude-agent-sdk/claude-sonnet-4-5`
- `claude-agent-sdk/claude-opus-4-7`

## Notes

This provider ignores pi's normal tool loop and uses the SDK's own tool/runtime stack instead. Pi is acting as the outer UI shell.

`/claude` subcommands:
- `/claude help`
- `/claude info`
- `/claude context`
- `/claude mcp`
- `/claude reload`
