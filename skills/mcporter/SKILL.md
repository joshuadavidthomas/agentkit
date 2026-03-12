---
name: mcporter
description: Call MCP servers from bash via MCPorter CLI. Use when you need to discover or invoke tools on configured MCP servers without a browser or GUI.
---

# MCPorter

CLI for calling MCP (Model Context Protocol) servers from bash. Discovers servers from local config and editor imports (Cursor, Claude, Codex, VS Code, etc.), handles OAuth, and supports both HTTP and stdio transports.

Runs via npx — no global installation needed. Requires Node.js 18+.

## Config

MCPorter looks for config in this order:

1. `--config <path>` flag (explicit)
2. `./config/mcporter.json` (project-local)
3. `~/.mcporter/mcporter.json` (system)

It also auto-imports servers from editor configs (Cursor, Claude Desktop, Codex, OpenCode, VS Code).

Config format:

```jsonc
{
  "mcpServers": {
    "my-server": {
      // HTTP/SSE transport
      "baseUrl": "https://api.example.com/mcp",
      "headers": { "Authorization": "Bearer $env:API_TOKEN" }
    },
    "local-server": {
      // stdio transport
      "command": "npx",
      "args": ["-y", "some-mcp-server"],
      "env": { "KEY": "value" }
    }
  }
}
```

Use `$env:VAR_NAME` for environment variable references.

## Discover Servers and Tools

```bash
# List all configured servers (includes auto-imported)
npx mcporter list
# → mcporter 0.7.3 — Listing 2 server(s) (per-server timeout: 30s)
# → - svelte (4 tools, 1.0s) [source: ~/.codex/config.toml]
# → - my-api (12 tools, 0.8s) [source: ~/.mcporter/mcporter.json]
# → ✔ Listed 2 servers (2 healthy).

# List tools on a specific server (human-readable signatures)
npx mcporter list my-server

# Full tool schemas
npx mcporter list my-server --schema

# JSON output for parsing
npx mcporter list my-server --json

# Include optional parameters in tool docs
npx mcporter list my-server --all-parameters

# List tools from an ad-hoc HTTP server (no config needed)
npx mcporter list https://mcp.example.com/mcp
```

## Call a Tool

```bash
# key=value arguments (most common)
npx mcporter call my-server.search query="example" limit=5

# JSON arguments
npx mcporter call my-server.search --args '{"query": "example"}'

# Function-call syntax
npx mcporter call 'my-server.search(query: "example", limit: 5)'

# Explicit server and tool flags
npx mcporter call --server my-server --tool search query="example"

# Control output format: text (default), markdown, json, raw
npx mcporter call my-server.search query="example" --output json

# Call an ad-hoc server by URL
npx mcporter call https://mcp.example.com/mcp.search query="example"

# Call a stdio server without config
npx mcporter call --stdio "npx -y some-mcp-server" tool_name arg=value
```

## Manage Config

```bash
# Show configured servers and import sources
npx mcporter config list

# Inspect one server's config
npx mcporter config get my-server
npx mcporter config get my-server --json

# Add an HTTP server
npx mcporter config add my-server https://mcp.example.com/mcp

# Add a stdio server
npx mcporter config add my-server --command "npx -y some-mcp-server" --arg --flag

# Add with headers, env, description
npx mcporter config add my-server https://api.example.com/mcp \
  --header "Authorization=Bearer $env:TOKEN" \
  --description "My API server"

# Write to system config instead of project config
npx mcporter config add my-server https://example.com/mcp --scope home

# Remove a server
npx mcporter config remove my-server

# Import servers from editors
npx mcporter config import cursor          # list what Cursor has
npx mcporter config import cursor --copy   # copy to local config
npx mcporter config import claude --filter notion --copy

# Validate config
npx mcporter config doctor
```

## Auth

```bash
# Run OAuth flow for a server
npx mcporter auth my-server

# Re-auth (clear cached credentials first)
npx mcporter auth my-server --reset

# Auth an ad-hoc server
npx mcporter auth https://mcp.example.com/mcp

# Clear credentials
npx mcporter config logout my-server
```

## Troubleshooting

```bash
# Verbose logging
npx mcporter list --log-level debug

# Validate config files
npx mcporter config doctor

# Check what servers are visible and where they come from
npx mcporter config list
```

- **"Server not found"**: Run `npx mcporter list` to see all available servers including editor imports.
- **OAuth timeout**: Increase with `--oauth-timeout 120000` (120 seconds).
- **stdio server fails**: Check that the command exists and try `--root <path>` to set the working directory.
