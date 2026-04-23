# Plan: `custom-provider-claude-agent-sdk` (v3)

A pi extension that registers a `claude-agent-sdk` provider, running Claude
Code as the LLM backend via `@anthropic-ai/claude-agent-sdk`'s stable `query()`
API. This is the third attempt — v1 got too sprawling, v2 was paused when the
unstable `unstable_v2_createSession` API turned out to be too limited for our
needs. v3 starts clean on the `feature/claude-agent-provider` branch with the
lessons from v1, v2, and `pi-claude-bridge` baked in.

## Background

Two bugs in the third-party `pi-claude-bridge` extension (v0.3.1) pushed us
back to writing our own:

1. **Scout stall.** When a parent session uses `claude-bridge` and a scout
   (finder / librarian / specialist) also uses `claude-bridge`, the scout's
   first tool call hangs for ~3 minutes and then aborts. Root cause: a
   module-level `sharedSession` singleton in `pi-claude-bridge/index.ts:313`
   that is not re-entrancy-safe under nested sessions. Oracle sidesteps the
   bug only because `ORACLE_FAMILY_PARTNERS` routes anthropic → openai.

2. **`/compact` silently does the wrong thing.** pi's compaction passes a
   `systemPrompt` to `completeSimple`, but `pi-claude-bridge` hardcodes
   `{ type: "preset", preset: "claude_code" }` at `index.ts:1258-1260` and
   drops the caller's system prompt. Combined with the `syncSharedSession`
   REUSE branch (`missed.length === 0` is trivially true for a 1-message
   compaction context), the SDK resumes the full prior conversation and
   receives "summarize this" as just another turn — not an isolated
   summarization call.

Both bugs share a single root cause: global state in the bridge, plus
hardcoded options that can't be overridden by callers. Wrapper shims,
`patch-package`, and scout-side demotion all turned out uglier than the
rewrite.

## What to port from v2

v2 lives at `pi-extensions/custom-provider-claude-agent-sdk-v2/`. We're not
copying files wholesale — v3 is a fresh directory — but a few pieces are
still good:

- **`package.json`** (11 lines). Structure + dep pins + pi extension config.
  Rename `"name"` to `pi-extension-custom-provider-claude-agent-sdk-v3`.
- **`constants.ts`** (24 lines). Port `DEFAULT_PROVIDER_MODELS` (Sonnet 4.5
  ctx 200k / maxTokens 64k; Opus 4.7 ctx 1M / maxTokens 128k). Rename
  `PROVIDER_ID` to `claude-agent-sdk-v3`.
- **`types.ts`** — port only the `PromptBlock` / `PromptTextBlock` /
  `PromptImageBlock` shapes (~10 lines). Everything else (`Turn`,
  `ExtensionBindings`) is tied to the unstable v2 SDK API and gets
  rewritten.

Do **not** port:

- `session.ts` — built around `unstable_v2_createSession` /
  `unstable_v2_resumeSession`. v3 uses the stable `query()` API with its
  own `ClaudeSession` class.
- `Turn` type from `types.ts` — tied to the unstable session handle shape.

v1 at `pi-extensions/custom-provider-claude-agent-sdk/` is a reference, not
a source of ports. Two ideas worth lifting as we build: the `persistence.ts`
pattern (`pi.appendEntry(SESSION_ENTRY_TYPE, { sdkSessionId,
syncedThroughEntryId, lastClaudeModelId })` for per-pi-session SDK session
IDs) and the README's framing that "this provider ignores pi's normal tool
loop and uses the SDK's own tool/runtime stack instead."

## Goals

- Register a `claude-agent-sdk` provider in pi. Models: Sonnet 4.5, Opus 4.7.
- `streamSimple` runs Claude Code via the SDK, streams text/thinking/tool
  events back into pi, and surfaces pi's built-in tools to CC via an
  in-process MCP server (same pattern as `pi-claude-bridge`).
- Per-pi-session `ClaudeSession` with its own SDK session id, persisted via
  `pi.appendEntry` so `--resume` works across pi restarts.
- `/compact` works: pi's compaction scaffolding drives the summarization
  call; we run it as a fresh `query()` with the caller's `systemPrompt`
  honored; the resulting summary is then injected as the first user turn of
  a new SDK session.
- Works correctly when used as both the parent provider and the scout
  provider in the same process (no module-level session singletons).

## Non-goals (for now)

- Not shipping extra pi extensions beyond the provider. Scouts, paperclip,
  custom-tools, etc. keep using whatever provider resolution they already
  have.
- Not implementing the SDK's own compaction — we piggyback on pi's.
- No widgets / UI components. v1 had a `components.ts`; skip it in v3 until
  something actually needs it.
- No `extraArgs` passthrough in M1; add later if a real need shows up.

## Architecture

**Single source of module state:** a `Map<piSessionId, ClaudeSession>`.
Nothing else global. No `sharedSession`. No static symbols for
registration guards beyond the minimum pi already requires.

**`ClaudeSession`** holds:
- `piSessionId: string`
- `sdkSessionId: string | null` (set after first successful query)
- `syncedThroughEntryId: number | null` (for the persistence invariant)
- `lastClaudeModelId: string | null`
- `mcpServer: ReturnType<typeof createSdkMcpServer>` (per-session so
  `pendingToolCalls` state can't leak across sessions)
- `pendingToolCalls: Map<string, PendingCall>`
- `.send(opts)` runs one `query()` turn, adapts SDK stream → pi events
- `.close()` tears down MCP bindings

**Provider entry:**
- `streamSimple({ model, messages, systemPrompt, tools, signal }, emit)`:
  1. Resolve or create `ClaudeSession` for current pi session.
  2. Build SDK options: `resume: sdkSessionId ?? undefined`,
     `systemPrompt: { type: "preset", preset: "claude_code", append:
     callerSystemPrompt }` (append, don't replace),
     `mcpServers: { "pi-tools": session.mcpServer }`,
     `includePartialMessages: true`,
     `allowedTools: toolsWhitelistFromPi(tools)`.
  3. Iterate the AsyncGenerator, translate each SDK event to pi events.
  4. On `system.init`, capture the new `sdkSessionId` and persist it.

**Tool bridge:** same shape as `pi-claude-bridge`'s MCP bridge, scoped per
`ClaudeSession`. pi tools → MCP tools registered in `session.mcpServer`.
Handler awaits a Promise, stores entry in `session.pendingToolCalls`,
resolves when pi delivers the `toolResult` in the next `streamSimple`
turn.

**Compaction:** pi calls `completeSimple(model, { systemPrompt:
SUMMARIZATION_SYSTEM_PROMPT, messages: [...] }, ...)`. In our
`completeSimple` implementation we do NOT reuse the current
`ClaudeSession`; we run a one-shot fresh `query()` with an ephemeral
session, honor the passed `systemPrompt` as `append`, return the summary
text. Then on the next normal turn, `SessionCompactEvent` tells us to
reset `sdkSessionId` on the live `ClaudeSession` so the next `query()`
starts a new SDK session seeded with the summary as its first user turn.

**Persistence:** `pi.appendEntry<SessionEntry>(SESSION_ENTRY_TYPE,
{ sdkSessionId, syncedThroughEntryId, lastClaudeModelId })`. On
`SessionStartEvent` we reconstruct `ClaudeSession` from the most recent
entry (if any). On `SessionShutdownEvent` we `.close()`.

## File layout

```
pi-extensions/custom-provider-claude-agent-sdk-v3/
├── PLAN.md                 (this file)
├── package.json            (ported from v2, renamed)
├── index.ts                (provider registration, event wiring)
├── constants.ts            (PROVIDER_ID, DEFAULT_PROVIDER_MODELS — ported)
├── types.ts                (PromptBlock + v3-specific types)
├── session.ts              (ClaudeSession class — written fresh)
├── stream.ts               (SDK event → pi event adapter)
├── tools.ts                (pi tools → MCP bridge)
├── persistence.ts          (appendEntry helpers)
└── compaction.ts           (one-shot summarization + post-compact reset)
```

## Milestones

- **M1 — Skeleton.** Register provider; `streamSimple` runs a fresh
  `query()` each call (no resume, no tools). Emits text/thinking/done.
  Enough to pick the provider in pi and get a streamed text reply.
- **M2 — Session continuity.** Add `ClaudeSession` + persistence. Capture
  `sdkSessionId` from `system.init`, `resume` on subsequent turns, store
  via `appendEntry`, reconstruct on `SessionStartEvent`.
- **M3 — Tool bridge.** Per-session MCP server, `pendingToolCalls` map,
  SDK `mcp__pi-tools__*` tool calls → pi tool requests → pi tool results
  → MCP handler resolution.
- **M4 — Compaction.** Honor caller's `systemPrompt` as `append`. One-shot
  fresh `query()` for summarization. `SessionCompactEvent` resets
  `sdkSessionId` so the next turn starts a new SDK session.
- **M5 — Scout co-existence.** Verify parent + scout both using this
  provider in the same process works (different pi session ids → different
  `ClaudeSession` entries → no shared state). The bug that kicked this
  whole thing off.
- **M6 — Polish.** `DISALLOWED_BUILTIN_TOOLS` pruning, model metadata,
  `AskClaude`-style reentrancy guard if needed, README.

## Open questions

- Can we avoid the `{ type: "preset", preset: "claude_code" }` preset
  entirely and pass a plain system prompt through? Preset gives us CC's
  built-in tool prompts "for free" but also pulls in behaviors we might
  not want. Leave as preset + append for M1; revisit in M6.
- `includePartialMessages: true` vs streaming full messages — pi's UI
  probably wants partials; confirm against `pi-coding-agent`'s event
  contract in M1.
- Does pi's `tools` param on `streamSimple` already include the full
  current whitelist, or do we need to cross-reference with the extension
  system? Check during M3.
- Do we need an `ACTIVE_STREAM_SIMPLE_KEY`-style guard? Only if pi can
  register the provider twice in one process. Defer until we see it.
