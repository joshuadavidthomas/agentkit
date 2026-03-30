# auto-share Extension

Automatically exports pi sessions to GitHub gists and keeps them updated as the conversation progresses. Produces stable, shareable URLs that always reflect the latest session state.

## File

`pi-extensions/auto-share/index.ts`

## State

```typescript
let gistId: string | null = null;
let lastExportTime = 0;
let ghAvailable: boolean | null = null; // null = unchecked
let enabled = true; // toggled via /auto-share
const COOLDOWN_MS = 10_000; // 10 seconds between exports
```

## Hooks

### `session_start` — Restore gist ID

- Scan `ctx.sessionManager.getEntries()` for the last `CustomEntry` where `customType === "auto-share"`
- If found, set `gistId = entry.data.gistId`
- If not found, `gistId` stays null (will create gist on first export)

### `agent_end` — Main export trigger

- Skip if `!enabled`
- Check cooldown: skip if `Date.now() - lastExportTime < COOLDOWN_MS`
- Export session HTML to temp file via `exportFromFile(sessionFilePath, tmpPath)`
  - Import from `@mariozechner/pi-coding-agent/dist/core/export-html/index.js`
- If `gistId` is null:
  - `gh gist create --public=false tmpFile`
  - Parse gist ID from stdout URL
  - `pi.appendEntry("auto-share", { gistId })` to persist on the session
  - Update manifest
- If `gistId` exists:
  - `gh gist edit <gistId> --filename session.html tmpFile`
  - Update manifest (touch `updated` timestamp)
- Clean up temp file
- Update `lastExportTime`
- Fire-and-forget — don't block the agent
- Log errors to debug file, don't show to user except on first failure (gh not installed / not logged in)

### `session_before_switch` — Handle session transitions

- Final export of outgoing session (skip cooldown)
- Reset `gistId = null`
- New session's `session_start` will fire after the switch and restore its own gist ID

### `session_compact` / `session_tree` — Content changed

- Same as `agent_end` (checks `enabled` and cooldown)

### `session_shutdown` — Final export

- Final export, skip cooldown
- Use `spawnSync` since the process is exiting

## Startup Validation

On first export attempt, check once:

- Is `gh` installed?
- Does `gh auth status` pass?

Cache result in `ghAvailable`. If false, log a warning and disable exports for the rest of the session.

## Manifest

**Location:** `~/.pi/agent/sessions/<encoded-cwd>/shares.json`

Co-located with session JSONL files. One manifest per project directory.

**Format:**

```json
{
  "abc-123": {
    "gistId": "a1b2c3d4",
    "viewerUrl": "https://pi.dev/session/#a1b2c3d4",
    "name": "refactor auth",
    "sessionFile": "2026-03-23T10-00-00-000Z_abc-123.jsonl",
    "created": "2026-03-23T10:00:00Z",
    "updated": "2026-03-23T14:30:00Z"
  }
}
```

Read-modify-write on each gist create/update. Transient race (two pi instances clobbering) self-heals on next export since `CustomEntry` on the session is the source of truth.

## Source of Truth

- `CustomEntry` on the session (`pi.appendEntry("auto-share", { gistId })`) is the authoritative mapping
- The manifest is a derived convenience index for external consumption
- If the manifest is deleted or corrupted, it rebuilds from `CustomEntry` data as sessions are used

## Commands

### `/auto-share`

Toggle auto-sharing on/off for the current session.

- State stored in memory (default: on)
- When toggled, show status via `ctx.ui.notify`:
  - `"Auto-share enabled"` / `"Auto-share disabled"`
- When enabled after being off, trigger an immediate export (skip cooldown)

### `/auto-share status`

Show current state:

- Enabled/disabled
- Gist URL (if one exists for this session)
- Last export time
- Whether `gh` is available

## Not In Scope (for now)

- Retroactive export of old sessions — only active sessions while the extension is loaded
- Configurable manifest location
