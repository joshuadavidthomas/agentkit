#!/usr/bin/env node
/**
 * Playwriter Browser Automation Script
 * 
 * Executes Playwright code against user's Chrome browser via Playwriter extension.
 * Connects to relay server at localhost:19988 (managed by MCP).
 * 
 * Usage:
 *   ./browser.js "code here"                    # Inline code
 *   ./browser.js /path/to/script.js             # Execute file
 *   echo "code" | ./browser.js                  # From stdin
 */

import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const RELAY_PORT = Number(process.env.PLAYWRITER_PORT) || 19988;
const CDP_ENDPOINT = `http://127.0.0.1:${RELAY_PORT}`;

const NO_TABS_ERROR = `No browser tabs are connected. Please install and enable the Playwriter extension on at least one tab: https://chromewebstore.google.com/detail/playwriter-mcp/jfeammnjpkecdekppnclgkkffahnhfhe`;

/**
 * Get code to execute from various sources
 */
function getCodeToExecute() {
  const args = process.argv.slice(2);

  // Case 1: File path provided
  if (args.length > 0 && fs.existsSync(args[0])) {
    const filePath = path.resolve(args[0]);
    console.log(`📄 Executing file: ${filePath}`);
    return fs.readFileSync(filePath, 'utf8');
  }

  // Case 2: Inline code provided as argument
  if (args.length > 0) {
    console.log('⚡ Executing inline code');
    return args.join(' ');
  }

  // Case 3: Code from stdin
  if (!process.stdin.isTTY) {
    console.log('📥 Reading from stdin');
    return fs.readFileSync(0, 'utf8');
  }

  // No input
  console.error('❌ No code to execute');
  console.error('Usage:');
  console.error('  ./browser.js "code here"       # Execute inline');
  console.error('  ./browser.js script.js         # Execute file');
  console.error('  cat script.js | ./browser.js   # Execute from stdin');
  process.exit(1);
}

/**
 * Wrap code in async IIFE if not already wrapped
 */
function wrapCodeIfNeeded(code) {
  // If code looks like a complete script, return as-is
  const hasAsync = code.includes('(async () => {') || code.includes('(async()=>{') || code.includes('async function');
  
  if (hasAsync && (code.includes('browser') || code.includes('page') || code.includes('context'))) {
    return code;
  }

  // Wrap in async IIFE with error handling
  return `
(async () => {
  try {
    ${code}
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  }
})();
`;
}

/**
 * Main execution
 */
async function main() {
  let browser = null;
  
  try {
    console.log('🎭 Playwriter Browser Automation\n');
    
    // Connect to relay server
    console.log(`🔌 Connecting to relay at ${CDP_ENDPOINT}...`);
    browser = await chromium.connectOverCDP(CDP_ENDPOINT);
    
    // Get context and pages
    const contexts = browser.contexts();
    if (contexts.length === 0) {
      throw new Error('No browser contexts available');
    }
    
    const context = contexts[0];
    const pages = context.pages();
    
    // Check if any tabs are enabled
    if (pages.length === 0) {
      throw new Error(NO_TABS_ERROR);
    }
    
    const page = pages[0];
    console.log(`✅ Connected to ${pages.length} tab(s)\n`);
    
    // Get code to execute
    const rawCode = getCodeToExecute();
    const code = wrapCodeIfNeeded(rawCode);
    
    // Create execution context
    const contextVars = {
      browser,
      context,
      page,
      pages,
      console,
    };
    
    // Execute code
    console.log('🚀 Executing...\n');
    const executeCode = new Function(...Object.keys(contextVars), code);
    await executeCode(...Object.values(contextVars));
    
    console.log('\n✅ Done');
    
  } catch (error) {
    console.error('\n❌ Failed:', error.message);
    
    // Provide helpful hints for common errors
    if (error.message.includes('ECONNREFUSED') || error.message.includes('connect')) {
      console.error('\nHint: Make sure the Playwriter MCP is configured and running.');
      console.error('The relay server should be available at', CDP_ENDPOINT);
    }
    
    if (error.stack && !error.message.includes(NO_TABS_ERROR)) {
      console.error('\nStack trace:');
      console.error(error.stack);
    }
    
    process.exit(1);
    
  } finally {
    // Disconnect from browser
    if (browser) {
      try {
        await browser.close();
      } catch (e) {
        // Ignore disconnect errors
      }
    }
  }
}

// Run
main().catch(error => {
  console.error('❌ Fatal error:', error.message);
  process.exit(1);
});
