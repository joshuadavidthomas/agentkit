# Playwriter Skill

CLI skill for browser automation via Playwriter. Enables agents to control your Chrome browser with zero MCP tool context pollution.

## Setup

### 1. Install Bun

```bash
curl -fsSL https://bun.sh/install | bash
```

Requires Bun 1.3.6 or later.

### 2. Install Extension

Install the Playwriter Chrome extension:
https://chromewebstore.google.com/detail/playwriter-mcp/jfeammnjpkecdekppnclgkkffahnhfhe

### 3. Build Binaries

```bash
cd /path/to/skills/playwriter
bun install
bun run build
```

This creates:
- `dist/mcp-server` (~97MB) - MCP server that manages relay lifecycle
- `dist/browser` (~100MB) - CLI tool for executing Playwright code

### 4. Configure MCP

Add to your MCP settings (e.g., `~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "playwriter-relay": {
      "command": "/absolute/path/to/skills/playwriter/dist/mcp-server"
    }
  }
}
```

Replace `/absolute/path/to/` with your actual path.

### 5. Restart MCP Client

Restart Claude Desktop (or your MCP client).

## Usage

Once set up, agents can control your Chrome browser:

1. Click the Playwriter extension icon on tabs you want to control (icon turns green)
2. Agent executes Playwright code via `./dist/browser`
3. You can collaborate - help with captchas, difficult elements, etc.

## How It Works

```
Chrome Extension → Relay Server (localhost:19988) → CLI Binary
```

- **MCP server** (`dist/mcp-server`) manages relay lifecycle, exposes NO tools (zero context pollution)
- **CLI binary** (`dist/browser`) connects to relay, executes Playwright code on-demand
- Agent loads skill only when needed for browser automation

## Troubleshooting

**Build fails:**
- Ensure Bun 1.3.6+ installed: `bun --version`
- Delete `node_modules` and `dist`, try again

**MCP not working:**
- Check absolute path in MCP config
- Restart MCP client
- Check binary is executable: `chmod +x dist/mcp-server`

**Connection refused:**
- Ensure MCP client is running
- Check relay started: `curl http://localhost:19988/version`

**No tabs available:**
- Click Playwriter extension icon on at least one tab (should turn green)

## Development

**Rebuild after changes:**
```bash
bun run build          # Rebuild both
bun run build:mcp      # Rebuild MCP server only
bun run build:browser  # Rebuild browser CLI only
```

**Binary sizes:**
- `dist/mcp-server`: ~97MB (includes MCP SDK)
- `dist/browser`: ~100MB (includes Playwright core + chromium-bidi)
