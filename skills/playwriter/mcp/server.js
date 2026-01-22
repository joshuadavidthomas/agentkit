#!/usr/bin/env node
/**
 * Minimal MCP Server for Playwriter
 * 
 * Manages CDP relay lifecycle only - exposes NO tools to avoid context pollution.
 * Spawns `npx -y playwriter serve` as a subprocess to run the relay server.
 * CLI scripts connect to the relay at localhost:19988 via Playwright's connectOverCDP().
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { spawn } from 'node:child_process';

const RELAY_PORT = Number(process.env.PLAYWRITER_PORT) || 19988;
let relayProcess = null;

/**
 * Check if relay server is already running
 */
async function isRelayRunning() {
  try {
    const res = await fetch(`http://127.0.0.1:${RELAY_PORT}/version`, { 
      signal: AbortSignal.timeout(1000) 
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Wait for relay server to be ready
 */
async function waitForRelay(maxAttempts = 20, delayMs = 500) {
  for (let i = 0; i < maxAttempts; i++) {
    if (await isRelayRunning()) {
      return true;
    }
    await new Promise(resolve => setTimeout(resolve, delayMs));
  }
  return false;
}

/**
 * Start the CDP relay server via npx
 */
async function startRelay() {
  // Check if relay already running
  if (await isRelayRunning()) {
    console.error('[Playwriter MCP] Relay already running on port', RELAY_PORT);
    return;
  }

  console.error('[Playwriter MCP] Starting relay server via npx...');
  
  // Start relay as detached subprocess
  relayProcess = spawn('npx', ['-y', 'playwriter', 'serve'], {
    stdio: 'ignore',
    detached: true,
    env: {
      ...process.env,
      PLAYWRITER_PORT: String(RELAY_PORT),
    },
  });
  
  relayProcess.unref();
  
  // Wait for relay to be ready
  const ready = await waitForRelay();
  if (!ready) {
    throw new Error('Failed to start relay server after 10 seconds');
  }
  
  console.error('[Playwriter MCP] Relay server started on port', RELAY_PORT);
}

/**
 * Stop the CDP relay server
 */
function stopRelay() {
  if (relayProcess) {
    console.error('[Playwriter MCP] Stopping relay server...');
    try {
      process.kill(-relayProcess.pid, 'SIGTERM');
    } catch (e) {
      // Ignore errors if process already exited
    }
    relayProcess = null;
  }
}

// Create minimal MCP server with NO tools
const server = new McpServer({
  name: 'playwriter-relay',
  title: 'Playwriter Relay Manager (No Tools)',
  version: '1.0.0',
});

// Start relay server
await startRelay();

// Clean up on exit
process.on('SIGINT', () => {
  stopRelay();
  process.exit(0);
});

process.on('SIGTERM', () => {
  stopRelay();
  process.exit(0);
});

// Connect MCP transport
const transport = new StdioServerTransport();
await server.connect(transport);

console.error('[Playwriter MCP] MCP server ready (no tools exposed)');
