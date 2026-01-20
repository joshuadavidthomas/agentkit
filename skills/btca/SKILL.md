---
name: btca
description: Query codebases semantically using LLMs. Use when asking questions about libraries, frameworks, or source code — searches actual source, not outdated docs.
---

# btca (Better Context App)

Ask questions about libraries and frameworks by searching actual source code. Clones repos locally, searches semantically, answers with citations.

## Requirements

- **Bun 1.1.0+** — `curl -fsSL https://bun.sh/install | bash`
- **OpenCode** — for model access (configured via `opencode auth`)

## Installation

```bash
bun add -g btca opencode-ai
```

### Verify
```bash
btca --version
```

## Quick Start

```bash
# List available resources
btca config resources list

# Ask a question (uses pre-configured svelte resource)
btca ask -r svelte -q "How does the $state rune work?"
```

## Usage

### Ask questions
```bash
btca ask --resource <name> --question "Your question"
btca ask -r svelte -q "How do stores work?"

# Query multiple resources at once
btca ask -r svelte -r tailwindcss -q "How do I style components?"
```

### Manage resources
```bash
# List configured resources
btca config resources list

# Add a git resource
btca config resources add \
  --name django \
  --type git \
  --url https://github.com/django/django \
  --branch main \
  --search-path docs \
  --notes "Python web framework"

# Add a local codebase
btca config resources add \
  --name myproject \
  --type local \
  --path /home/user/projects/myproject \
  --search-path src \
  --search-path lib

# Remove a resource
btca config resources remove --name django
```

### Clear cloned repos
```bash
btca clear
```

## Configuration

### Config file locations
- Global: `~/.config/btca/btca.config.jsonc`
- Project: `./btca.config.jsonc` (overrides global)

btca creates a default config with starter resources (svelte, tailwind, nextjs docs) on first run.

### Set up model + auth
```bash
# Configure OpenCode credentials
opencode auth

# Set model (recommended: Claude Haiku 4.5)
btca config model --provider opencode --model claude-haiku-4-5
```

### Alternative models
```bash
btca config model --provider opencode --model big-pickle        # Free
btca config model --provider opencode --model minimax-m2.1-free # Fast + cheap
```

### Resource Schema

| Field | Required | Description |
|-------|----------|-------------|
| `type` | Yes | `"git"` or `"local"` |
| `name` | Yes | Short identifier for CLI |
| `url` | git only | Git repository URL |
| `branch` | git only | Branch to clone (default: main) |
| `path` | local only | Absolute path to local directory |
| `searchPath` | No | Subdirectory to search (repeatable in CLI) |
| `specialNotes` | No | Hints for the AI about this resource |

### Example Config

`~/.config/btca/btca.config.jsonc`:
```jsonc
{
  "$schema": "https://btca.dev/btca.schema.json",
  "model": "claude-haiku-4-5",
  "provider": "opencode",
  "providerTimeoutMs": 300000,
  "resources": [
    {
      "type": "git",
      "name": "django",
      "url": "https://github.com/django/django",
      "branch": "main",
      "searchPath": "docs",
      "specialNotes": "Python web framework"
    },
    {
      "type": "local",
      "name": "myproject",
      "path": "/home/user/projects/myproject",
      "searchPath": "src"
    }
  ]
}
```

## Tips & Gotchas

- First query for a git resource clones the repo (may take a moment)
- Default config includes svelte/tailwind/nextjs docs — remove if not needed
- Use `searchPath` to limit scope for large repos
- `specialNotes` helps the AI understand context
- Output shows full agent trace (tool calls, file reads, reasoning) — can be lengthy
- If the user has started `btca serve`, pass `--server` to `btca ask` to connect to it for faster queries
- `local` type is great for querying your own projects

### IMPORTANT: Avoid TUI or Server Mode

These commands launch an interactive TUI — **do not use them**:
```bash
btca                    # Bare command launches TUI
btca chat               # Interactive chat TUI
btca serve --port 8080  # Starts server in foreground
```

Always use `btca ask` for CLI usage.

## Uninstall

```bash
btca clear                        # Remove cloned repos first
bun remove -g btca opencode-ai
rm -rf ~/.config/btca
```

## References

- [Getting Started](https://btca.dev/getting-started)
- [Commands](https://btca.dev/commands)
- [Config](https://btca.dev/config)
- [GitHub](https://github.com/bmdavis419/better-context)
