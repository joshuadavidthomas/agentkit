# Plan: `custom-provider-claude-agent-sdk` (v3)

A pi extension that currently registers a `claude-agent-sdk-v3` provider,
running Claude Code as the LLM backend via `@anthropic-ai/claude-agent-sdk`'s
stable `query()` API. This is the third attempt — v1 got too sprawling, v2 was
paused when the unstable `unstable_v2_createSession` API turned out to be too
limited for our needs. v3 starts clean on the `feature/claude-agent-provider`
branch with the lessons from v1, v2, and `pi-claude-bridge` baked in.

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

- Register a `claude-agent-sdk-v3` provider in pi during iteration. Models: Sonnet 4.5, Opus 4.7.
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
- `syncedThroughEntryId: string | null` (the latest pi branch entry known to be represented in the SDK session)
- `lastClaudeModelId: string | null`
- `sessionManager?: ContinuitySessionManager` for branch-aware handoff/reset checks
- `activeQuery: ReturnType<typeof query> | null`
- `currentStreamState: StreamState | null`
- `pendingToolCalls: Map<string, PendingCall>`
- `pendingResults: Map<string, CallToolResult>`
- `turnToolCallIds: string[]` + `nextToolHandlerIndex` for matching SDK MCP handlers to streamed pi tool calls
- `.prepareForTurn(pi)` builds fresh/delta pi-session handoff and resets stale branch state
- `.close()` tears down active queries and resolves pending MCP handlers

**Provider entry:**
- `streamSimple(model, context, options)`:
  1. Resolve or create `ClaudeSession` for current pi session.
  2. If `session.activeQuery` exists, treat the call as tool-result delivery: attach a new pi stream, extract `toolResult` messages from the tail of `context.messages`, resolve pending MCP handlers, and return without starting a new SDK query.
  3. Otherwise build SDK options: `resume: sdkSessionId ?? undefined`, `systemPrompt: { type: "preset", preset: "claude_code", append: callerSystemPrompt }` (append, don't replace), `mcpServers: { "pi-tools": buildPiMcpServer(context.tools, ...) }`, `includePartialMessages: true`, `allowedTools: ["mcp__pi-tools__*"]`, `disallowedTools: DISALLOWED_BUILTIN_TOOLS`, `permissionMode: "bypassPermissions"`.
  4. Iterate the AsyncGenerator in the background, translate each SDK event to pi events.
  5. On `system.init`, capture the new `sdkSessionId` and persist it.

**Tool bridge:** same shape as `pi-claude-bridge`'s MCP bridge, scoped per
`ClaudeSession`. pi tools → MCP tools registered in a per-query SDK MCP
server. Handler awaits a Promise, stores entry in
`session.pendingToolCalls`, and resolves when pi delivers the `toolResult`
in the next `streamSimple` turn. Execution stays in pi's normal tool loop so
permissions, tool rendering, extension hooks, persistence, and retries keep
working.

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

- **M1 — Skeleton. Done.** Register provider; `streamSimple` runs a fresh
  `query()` each call (no resume, no tools). Emits text/thinking/done.
  Enough to pick the provider in pi and get a streamed text reply.
- **M2 — Session continuity. Done.** Add `ClaudeSession` + persistence.
  Capture `sdkSessionId` from `system.init`, `resume` on subsequent turns,
  store via `appendEntry`, reconstruct on `SessionStartEvent`, track
  `syncedThroughEntryId`, reset on branch/tree mismatch, and build v3-native
  fresh/delta handoff.
- **M3 — Tool bridge. Implemented and smoke-verified.** Per-session query
  state, SDK MCP server from pi tools, `pendingToolCalls` map, SDK
  `mcp__pi-tools__*` tool calls → pi `toolcall_*` events → pi tool results
  → MCP handler resolution. Verified with tmux/TUI for `read`, `bash`,
  `write`, two parallel `read` calls, abort during `bash sleep 30`,
  cross-restart resume after a tool turn, and JSONL invariants.
- **M4 — Compaction. Implemented and smoke-verified.** `completeSimple`
  calls without a pi `sessionId` run as fresh one-shot SDK `query()` calls
  with no `resume`, no tools, and the caller's `systemPrompt` used directly
  for isolated summarization. `SessionCompactEvent` resets `sdkSessionId`
  and refreshes the session manager so the next turn starts a new SDK
  session seeded from pi's compacted context/handoff.
- **M5 — Scout co-existence. Smoke-verified.** Verified parent v3 session
  calling the `finder` scout with explicit model
  `claude-agent-sdk-v3/claude-sonnet-4-5`. The scout made tool calls and
  returned the expected path without the pi-claude-bridge shared-session
  stall. JSONL had matching finder tool call/result and no v1 custom entries.
- **M6 — Polish. Remaining.** final provider naming/collapse, model
  metadata, README, duplicate-load behavior, portability of Claude binary
  resolution, schema conversion breadth, and any reentrancy guard if needed.

## Verified so far

M3 was verified with tmux-backed interactive pi sessions and JSONL checks:

- normal TUI tool rendering for `read`, `bash`, and `write`
- same-process continuation after tool turns
- cross-restart resume after a tool/write turn
- two parallel `read` tool calls matched by `toolCallId`
- abort during `bash sleep 30` produced an error `toolResult` and recovered on the next prompt
- one-shot completion path returns isolated summaries/replies without resuming an SDK session
- `/compact` resets the v3 SDK session and the next turn receives pi context handoff in the Claude transcript
- post-compact continuity smoke test recalled `m4f-papaya, m4f-guava`
- parent v3 session successfully called `finder` scout also running v3 (`claude-agent-sdk-v3/claude-sonnet-4-5`) and received the expected result
- JSONL had matching tool calls/results, no orphan tool results, no missing tool results, and no old `claude-agent-sdk-provider` entries when v3 was loaded only once

## Caveats / follow-ups

- **Duplicate v3 load:** If v3 is installed globally and also passed via `-e`, pi loads two v3 instances. That produced duplicate v3 custom entries and reset/persist churn. Clean runs with only one v3 instance behaved correctly. Document or guard before final collapse.
- **Old v1 provider still installed:** Clean v3 runs no longer write `claude-agent-sdk-provider`; v1's tree/compact handlers are now guarded so they do not append v1 state during v3 tree/compact events. v1 still remains present in the normal extension set until final replacement.
- **Permission UX coverage is shallow:** `write` to `/tmp` worked and used normal pi tool rendering. A destructive/guarded edit/command should still be manually or tmux-tested for confirm/deny behavior.
- **Abort coverage is partial:** Tested abort while a pi `bash` tool was running. Still untested: abort while Claude is streaming before a tool call, while an MCP handler is waiting before pi returns a result, and while mixed parallel tools are mid-flight.
- **Parallel coverage is partial:** Two parallel `read` calls worked. Still test mixed parallel calls and one-success/one-error batches.
- **Schema conversion is minimal:** TypeBox/JSON schema → Zod handles common object properties, arrays, enums, constants, and primitives. It does not deeply model nested object properties, oneOf/anyOf/allOf, nullable unions, numeric bounds, or string formats.
- **Linux binary workaround:** v3 forces the glibc x64 Claude SDK binary on Linux x64 because SDK auto-selection picked the musl binary here, which failed due a missing musl loader. Make this more portable before finalizing.
- **Concurrent same-session access:** Running print-mode against the same session file while the TUI session was still open timed out. After closing TUI, print-mode resume worked. Treat same-session concurrent use as unsupported unless pi provides locking semantics.
- **Scout/subagent coexistence coverage is shallow:** Parent + `finder` scout both using v3 works. Still test librarian/specialist/oracle and failure/abort paths if we want broader confidence.
- **Compaction edge coverage:** M4 smoke test passes for ordinary `/compact` and post-compact continuation. Still test split-turn compaction, custom compaction instructions, and compaction while an active tool/query is pending.
- **Duplicate v3 load:** Still unsupported. Avoid loading the installed provider again with `-e`; a reload-safe duplicate guard needs separate design.

## Open questions

- For normal turns, should we keep using `{ type: "preset", preset: "claude_code" }` plus append forever, or eventually move to a plainer prompt? M4 one-shot summarization already uses the caller's `systemPrompt` directly to avoid Claude Code repo/tool behavior polluting summaries.
- Do we need an `ACTIVE_STREAM_SIMPLE_KEY`-style guard or other duplicate-load
  detection? Duplicate v3 loads can happen during ad hoc testing with `-e`.
  Decide before final provider collapse.
- Should complex tool schemas degrade to permissive `unknown` fields, or do we
  need fuller JSON Schema → Zod conversion for custom tools?
