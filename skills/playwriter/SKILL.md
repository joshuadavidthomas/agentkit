---
name: playwriter
description: Use when automating browsers, scraping websites, testing UIs, filling forms, debugging web issues, or controlling Chrome - executes Playwright code snippets via CLI against user's browser tabs
---

# Playwriter

Control user's Chrome browser via Playwright code snippets executed through CLI. The user enables tabs they want you to control using the Playwriter Chrome extension (green icon = enabled). You write Playwright code, execute it via the `./dist/browser` binary.

You can collaborate with the user - they can help with captchas, difficult elements, or reproducing bugs.

## How It Works

```
User's Chrome          Relay Server           CLI Binary
     ↓                      ↓                      ↓
[Extension] ←─WS─→ [localhost:19988] ←─CDP─→ [browser]
```

1. **User installs extension** and enables tabs (click icon → green)
2. **MCP manages relay** at `localhost:19988` (zero tool pollution - just lifecycle)
3. **You execute Playwright code** via `./dist/browser` binary which connects to relay

## Execution

```bash
# Inline code
./skills/playwriter/dist/browser "await page.goto('https://example.com'); console.log(await page.title())"

# From file
./skills/playwriter/dist/browser /tmp/my-script.js

# From stdin
echo "console.log(page.url())" | ./skills/playwriter/dist/browser
```

Prefer inline for simple operations. Use files for complex multi-step automation.

## Context Variables

Available in every execution:

- `browser` - Connected browser instance
- `context` - Browser context
- `page` - Default page (first enabled tab)
- `pages` - Array of all enabled pages

Example:
```javascript
// Inline execution
./dist/browser "
  console.log('Current URL:', page.url());
  console.log('Total enabled tabs:', pages.length);
  
  // Work with specific page
  const targetPage = pages.find(p => p.url().includes('localhost'));
  await targetPage.reload();
"
```

## Rules

- **Never close**: Never call `browser.close()` or `context.close()` - browser binary handles disconnection
- **Check state after actions**: Always verify what happened after clicking/submitting
- **Wait properly**: Use `page.waitForLoadState('domcontentloaded')` not `page.waitForEvent('load')`
- **No bringToFront**: Never call unless user asks - unnecessary and disruptive

## Checking Page State

After any action (click, submit, navigate), verify what happened. The simplest pattern is just log the URL:

```javascript
await page.goto('https://example.com/login');
console.log('Navigated to:', page.url());

await page.fill('input[name="email"]', 'test@example.com');
await page.fill('input[name="password"]', 'password123');
await page.click('button[type="submit"]');

// Verify navigation happened
console.log('After submit:', page.url());
```

For visually complex pages (grids, galleries, dashboards), take screenshots to understand layout.

## Selectors

**For unknown websites**: Use CSS selectors, Playwright's `getByRole`, `getByText`, `getByLabel`:

```javascript
await page.getByRole('button', { name: 'Submit' }).click()
await page.getByText('Sign in').click()
await page.getByLabel('Email').fill('user@example.com')
```

**Best practices** (when you have source code access):

1. **Best**: `[data-testid="submit"]` - explicit test attributes
2. **Good**: `getByRole('button', { name: 'Save' })` - accessible, semantic
3. **Good**: `getByText('Sign in')`, `getByLabel('Email')` - readable
4. **OK**: `input[name="email"]`, `button[type="submit"]` - semantic HTML
5. **Avoid**: `.btn-primary`, `#submit` - classes/IDs change frequently
6. **Last resort**: `div.container > form > button` - fragile

Combine locators for precision:
```javascript
page.locator('tr').filter({ hasText: 'John' }).locator('button').click()
```

If a locator matches multiple elements, use `.first()`, `.last()`, or `.nth(n)`:
```javascript
await page.locator('button').first().click()  // first match
await page.locator('li').nth(3).click()       // 4th item (0-indexed)
```

## Common Patterns

**Navigation**:
```javascript
await page.goto('https://example.com', { waitUntil: 'domcontentloaded' });
console.log('Loaded:', page.url());
```

**Fill and submit form**:
```javascript
await page.fill('input[name="username"]', 'testuser');
await page.fill('input[name="password"]', 'password123');
await page.click('button[type="submit"]');
await page.waitForURL('**/dashboard'); // wait for redirect
console.log('Redirected to:', page.url());
```

**Handle popups**:
```javascript
const [popup] = await Promise.all([
  page.waitForEvent('popup'),
  page.click('a[target=_blank]')
]);
await popup.waitForLoadState();
console.log('Popup URL:', popup.url());
```

**Downloads**:
```javascript
const [download] = await Promise.all([
  page.waitForEvent('download'),
  page.click('button.download')
]);
await download.saveAs(`/tmp/${download.suggestedFilename()}`);
```

**Screenshots**:
```javascript
await page.screenshot({ path: '/tmp/screenshot.png', scale: 'css' });
console.log('Screenshot saved to /tmp/screenshot.png');
```

Always use `scale: 'css'` to avoid 2-4x larger images on high-DPI displays.

**iFrames**:
```javascript
const frame = page.frameLocator('#my-iframe');
await frame.locator('button').click();
```

**Dialogs** (alerts/confirms/prompts):
```javascript
page.on('dialog', async dialog => {
  console.log('Dialog:', dialog.message());
  await dialog.accept(); // or dialog.dismiss()
});
await page.click('button.trigger-alert');
```

**Multiple pages**:
```javascript
// Find specific page
const targetPage = pages.find(p => p.url().includes('localhost'));
if (!targetPage) throw new Error('Target page not found');

// List all pages
pages.forEach((p, i) => console.log(`Page ${i}: ${p.url()}`));

// Create new page
const newPage = await context.newPage();
await newPage.goto('https://example.com');
```

## page.evaluate Patterns

Code inside `page.evaluate()` runs in browser context - use plain JavaScript only:

```javascript
// Extract data
const data = await page.evaluate(() => ({
  url: location.href,
  title: document.title,
  buttonCount: document.querySelectorAll('button').length,
}));
console.log(data);

// Scroll element into view
await page.evaluate(() => {
  document.querySelector('.target').scrollIntoView({ behavior: 'smooth' });
});
```

**Note**: `console.log` inside evaluate runs in browser, not visible in output. Return values and log outside.

## Troubleshooting (What to Tell User)

**"Extension not running" or "No browser tabs are connected"**
→ Tell user: "Click the Playwriter extension icon on the tab you want to control (icon should turn green)"

**Connection refused (ECONNREFUSED)**
→ Tell user: "Make sure the Playwriter MCP is configured in your MCP settings"

Provide setup instructions if needed:
1. Install extension: https://chromewebstore.google.com/detail/playwriter-mcp/jfeammnjpkecdekppnclgkkffahnhfhe
2. Add to MCP config (e.g., Claude Desktop):
   ```json
   {
     "mcpServers": {
       "playwriter-relay": {
         "command": "/absolute/path/to/skills/playwriter/dist/mcp-server"
       }
     }
   }
   ```
3. Restart MCP client
4. Click extension icon on tabs to control

**Note**: Binaries are pre-compiled for Linux (x86_64). For other platforms, see "Rebuilding Binaries" section below.

## Advanced Use Cases

**Network interception** (API scraping):
```javascript
const requests = [];
page.on('request', req => {
  if (req.url().includes('/api/')) {
    requests.push({ url: req.url(), method: req.method() });
  }
});

await page.goto('https://example.com');
await page.click('button.load-more');

console.log('Captured requests:', requests);
```

**Load file content**:
```javascript
const fs = require('node:fs');
const content = fs.readFileSync('./data.txt', 'utf-8');
await page.locator('textarea').fill(content);
```

**Upload files**:
```javascript
await page.locator('input[type="file"]').setInputFiles('/path/to/file.pdf');
```

## Rebuilding Binaries

The pre-compiled binaries (`mcp/server` and `scripts/browser`) are built for **Linux x86_64**. If you're on macOS, Windows, or another architecture, rebuild them:

```bash
cd /path/to/skills/playwriter

# Install bun if not already installed
# https://bun.sh

# Rebuild both binaries
bun run build

# Or rebuild individually
bun run build:mcp       # Rebuilds mcp/server
bun run build:browser   # Rebuilds scripts/browser
```

**Requirements:**
- Bun 1.3.6 or later
- Internet connection (downloads dependencies on first build)

**Binary sizes:**
- `mcp/server`: ~97MB (includes MCP SDK)
- `scripts/browser`: ~100MB (includes Playwright core + chromium-bidi)

After rebuilding, update your MCP config to point to the new binary location.

## Notes

- Each script execution is independent - browser connects, runs code, disconnects
- MCP manages relay lifecycle (starts with MCP client, stops when MCP closes)
- User can collaborate - they see what's happening in their browser
- Full Playwright API available - any browser task is possible
- Screenshots and downloads saved to `/tmp` for easy access
- Zero npm install required - binaries are self-contained
