# Plan: `custom-provider-claude-agent-sdk`

A pi extension that registers a `claude-agent-sdk` provider,
running Claude Code as the LLM backend via `@anthropic-ai/claude-agent-sdk`'s
stable `query()` API. This is the third attempt — v1 got too sprawling, v2 was
paused when the unstable `unstable_v2_createSession` API turned out to be too
limited for our needs. This implementation started clean on the
`feature/claude-agent-provider` branch with the lessons from v1, v2, and
`pi-claude-bridge` baked in.

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

v2 lives at `reference/pi-extensions/custom-provider-claude-agent-sdk-v2/`.
We're not copying files wholesale — this implementation started as a fresh
directory — but a few pieces are still good:

- **`package.json`** (11 lines). Structure + dep pins + pi extension config.
  Rename `"name"` to `pi-extension-custom-provider-claude-agent-sdk`.
- **Provider identity plus local model setup in `index.ts` / `stream.ts`**.
  Start from v2 provider/model config, then replace the static model list with
  pi's built-in Anthropic model registry. Provider/API ids now live directly in
  `index.ts`.
- **Prompt block shapes** — port only the `PromptBlock` /
  `PromptTextBlock` / `PromptImageBlock` shapes (~10 lines), now colocated in
  `prompt.ts`. Everything else (`Turn`, `ExtensionBindings`) is tied to the
  unstable v2 SDK API and gets rewritten.

Do **not** port:

- `session.ts` — built around `unstable_v2_createSession` /
  `unstable_v2_resumeSession`. This provider uses the stable `query()` API
  with its own `ClaudeSession` class.
- `Turn` type from `types.ts` — tied to the unstable session handle shape.

v1 at `reference/pi-extensions/custom-provider-claude-agent-sdk/` is a
reference, not a source of ports. Two ideas worth lifting as we build: the
`persistence.ts`
pattern (`pi.appendEntry(SESSION_ENTRY_TYPE, { sdkSessionId,
syncedThroughEntryId, lastClaudeModelId })` for per-pi-session SDK session
IDs) and the README's framing that "this provider ignores pi's normal tool
loop and uses the SDK's own tool/runtime stack instead."

## Goals

- Register a `claude-agent-sdk` provider in pi with Claude models mirrored from pi's built-in Anthropic registry.
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
- No widgets / UI components. v1 had a `components.ts`; skip it until
  something actually needs it.
- No `extraArgs` passthrough in M1; add later if a real need shows up.

## Architecture

**Single source of session state:** a `Map<piSessionId, ClaudeSession>`.
No `sharedSession`. The only other module/global state is a defensive duplicate
registration guard for accidental same-process double loads.

**`ClaudeSession`** owns per-pi-session identity and query lifecycle:
- `piSessionId: string`
- private `sdkSessionId: string | null` (set after first successful query)
- private `syncedThroughEntryId: string | null` (the latest pi branch entry known to be represented in the SDK session)
- private `lastClaudeModelId: string | null`
- private `sessionManager?: HandoffSessionReader` for branch-aware handoff/reset checks
- private `activeQuery: ReturnType<typeof query> | null`
- private `currentStreamState: PiStreamState | null`
- `toolCalls: ToolCallMatcher` for matching streamed tool-call ids to SDK MCP handler promises
- `.prepareForTurn()` builds fresh/delta pi-session handoff and resets stale branch state
- `.close()` tears down active queries and resolves pending MCP handlers

**Provider entry:**
- `streamSimple(model, context, options)`:
  1. Resolve or create `ClaudeSession` for current pi session.
  2. If the session has an active SDK query, treat the call as tool-result delivery: attach a new pi stream, extract `toolResult` messages from the tail of `context.messages`, resolve pending MCP handlers through `ToolCallMatcher`, and return without starting a new SDK query.
  3. Otherwise build SDK options: `resume: sdkSessionId ?? undefined`, `systemPrompt: { type: "preset", preset: "claude_code", append: callerSystemPrompt }` (append, don't replace), `mcpServers: { "pi-tools": buildPiMcpServer(context.tools, ...) }`, `includePartialMessages: true`, `allowedTools: ["mcp__pi-tools__*"]`, `disallowedTools: DISALLOWED_BUILTIN_TOOLS`, `permissionMode: "bypassPermissions"`.
  4. Iterate the AsyncGenerator in the background, translate SDK stream events through `claude-stream-events.ts` into provider events, then apply them to `PiStreamState`.
  5. When SDK messages expose a `session_id`, capture the new `sdkSessionId` and persist it.

**Tool bridge:** same shape as `pi-claude-bridge`'s MCP bridge, scoped per
`ClaudeSession`. pi tools → MCP tools registered in a per-query SDK MCP
server. `ToolCallMatcher` records streamed tool-call ids in order, maps SDK MCP
handler invocations to those ids, and resolves the handler promise when pi
delivers the matching `toolResult` in the next `streamSimple` turn. Execution
stays in pi's normal tool loop so permissions, tool rendering, extension hooks,
persistence, and retries keep working.

**Compaction:** pi calls `completeSimple(model, { systemPrompt:
SUMMARIZATION_SYSTEM_PROMPT, messages: [...] }, ...)`. In our
`completeSimple` implementation we do NOT reuse the current
`ClaudeSession`; we run a one-shot fresh `query()` with an ephemeral
session, no tools, no `resume`, and the caller's `systemPrompt` used directly,
then return the summary text. On the next normal turn, `SessionCompactEvent`
tells us to reset `sdkSessionId` on the live `ClaudeSession` so the next
`query()` starts a new SDK session seeded from pi's compacted context/handoff.

**Persistence:** `pi.appendEntry<SessionEntry>(SESSION_ENTRY_TYPE,
{ sdkSessionId, syncedThroughEntryId, lastClaudeModelId })`. On
`SessionStartEvent` we reconstruct `ClaudeSession` from the most recent
entry (if any). On `SessionShutdownEvent` we `.close()`.

## File layout

```
pi-extensions/custom-provider-claude-agent-sdk/
├── PLAN.md                 (this file)
├── package.json            (ported from v2, renamed)
├── index.ts                (provider registration, event wiring, provider/API ids)
├── prompt.ts               (pi context/user prompt → Claude SDK prompt)
├── sessions.ts             (ClaudeSessionManager + active manager guard)
├── session.ts              (ClaudeSession identity/query lifecycle)
├── tool-call-matcher.ts    (tool-call id ↔ MCP handler rendezvous)
├── stream.ts               (Claude SDK query orchestration)
├── claude-stream-events.ts (Claude SDK stream event → provider event)
├── pi-stream.ts            (provider event/result → pi stream/message state)
├── tools.ts                (pi tools → MCP bridge)
├── handoff.ts              (pi session/context handoff construction)
└── persistence.ts          (appendEntry helpers)
```

## Milestones

- **M1 — Skeleton. Done.** Register provider; `streamSimple` runs a fresh
  `query()` each call (no resume, no tools). Emits text/thinking/done.
  Enough to pick the provider in pi and get a streamed text reply.
- **M2 — Session continuity. Done.** Add `ClaudeSession` + persistence.
  Capture `sdkSessionId` from SDK messages, `resume` on subsequent turns,
  store via `appendEntry`, reconstruct on `SessionStartEvent`, track
  `syncedThroughEntryId`, reset on branch/tree mismatch, and build provider-native
  fresh/delta handoff.
- **M3 — Tool bridge. Implemented and smoke-verified.** Per-session query
  state, SDK MCP server from pi tools, `ToolCallMatcher`, SDK
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
- **M5 — Scout co-existence. Smoke-verified.** Verified parent session
  calling the `finder` scout with explicit model
  `claude-agent-sdk/claude-sonnet-4-5`. The scout made tool calls and
  returned the expected path without the pi-claude-bridge shared-session
  stall. JSONL had matching finder tool call/result and no v1 custom entries.
- **M6 — Polish. In progress.** Provider directory and public provider id have
  been collapsed to `custom-provider-claude-agent-sdk` / `claude-agent-sdk`.
  The provider now mirrors pi's built-in Anthropic model list and passes those
  model ids directly to Claude Code. A same-load duplicate registration guard
  prevents the common installed provider + explicit `-e` double-load case.
  Recent polish split prompt marshalling, Claude stream parsing, pi stream
  application, and tool-call matching into separate modules. Remaining polish:
  re-evaluate the provider event layer, tighten the `ClaudeSession` API further,
  final regression, schema conversion breadth, and any remaining reentrancy guard
  if needed.

## Verified so far

M3 was verified with tmux-backed interactive pi sessions and JSONL checks:

- normal TUI tool rendering for `read`, `bash`, and `write`
- same-process continuation after tool turns
- cross-restart resume after a tool/write turn
- two parallel `read` tool calls matched by `toolCallId`
- abort during `bash sleep 30` produced an error `toolResult` and recovered on the next prompt
- one-shot completion path returns isolated summaries/replies without resuming an SDK session
- `/compact` resets the SDK session and the next turn receives pi context handoff in the Claude transcript
- post-compact continuity smoke test recalled `m4f-papaya, m4f-guava`
- parent session successfully called `finder` scout also running this provider (`claude-agent-sdk/claude-sonnet-4-5`) and received the expected result
- final identity smoke tests passed with `claude-agent-sdk/claude-sonnet-4-5` for no-tool, `read`, duplicate-load guard, and parent → `finder` scout
- model list now comes from pi's built-in Anthropic registry via `getModels("anthropic")`; `claude-agent-sdk/claude-sonnet-4-6` was smoke-tested
- final tmux regression with `claude-agent-sdk/claude-sonnet-4-6` passed no-tool continuity, `read`, `bash`, `write`, parallel `read`s, abort/recovery, `/compact` recall, and parent → `finder` scout
- JSONL had matching tool calls/results, no orphan tool results, no missing tool results, final `claude-agent-sdk-session` entries, and no old `claude-agent-sdk-provider` entries when the provider was loaded only once

## Caveats / follow-ups

- **Duplicate load:** If the provider is installed globally and also passed via `-e`, pi can load two instances. That previously produced duplicate custom entries and reset/persist churn. The same-load guard prevents the common case.
- **Old v1/v2 provider attempts:** Archived under `reference/pi-extensions/` and no longer installed by `install.sh`. Clean runs should not write the old v1 `claude-agent-sdk-provider` custom entry.
- **Permission UX coverage is shallow:** `write` to `/tmp` worked and used normal pi tool rendering. A destructive/guarded edit/command should still be manually or tmux-tested for confirm/deny behavior.
- **Abort coverage is partial:** Tested abort while a pi `bash` tool was running. Still untested: abort while Claude is streaming before a tool call, while an MCP handler is waiting before pi returns a result, and while mixed parallel tools are mid-flight.
- **Parallel coverage is partial:** Two parallel `read` calls worked. Still test mixed parallel calls and one-success/one-error batches.
- **Schema conversion is minimal:** TypeBox/JSON schema → Zod handles common object properties, arrays, enums, constants, and primitives. It does not deeply model nested object properties, oneOf/anyOf/allOf, nullable unions, numeric bounds, or string formats.
- **Linux binary workaround:** On this machine the SDK auto-selected its Linux x64 musl package, which failed due a missing musl loader, while the glibc package worked. `stream.ts` documents this local quirk and prefers the glibc binary only on Linux x64; other platforms fall back to SDK resolution.
- **Concurrent same-session access:** Running print-mode against the same session file while the TUI session was still open timed out. After closing TUI, print-mode resume worked. Treat same-session concurrent use as unsupported unless pi provides locking semantics.
- **Scout/subagent coexistence coverage is shallow:** Parent + `finder` scout both using this provider works. Still test librarian/specialist/oracle and failure/abort paths if we want broader confidence.
- **Compaction edge coverage:** M4 smoke test passes for ordinary `/compact` and post-compact continuation. Still test split-turn compaction, custom compaction instructions, and compaction while an active tool/query is pending.
## Open questions

- For normal turns, should we keep using `{ type: "preset", preset: "claude_code" }` plus append forever, or eventually move to a plainer prompt? M4 one-shot summarization already uses the caller's `systemPrompt` directly to avoid Claude Code repo/tool behavior polluting summaries.
- Is the same-load duplicate guard enough for final provider collapse, or do we
  need a stronger pi-level extension identity/dedup mechanism?
- Should complex tool schemas degrade to permissive `unknown` fields, or do we
  need fuller JSON Schema → Zod conversion for custom tools?
