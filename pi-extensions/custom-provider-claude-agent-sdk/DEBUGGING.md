# Claude Agent SDK Provider — Debugging Plan

Working doc for the issues surfaced while instrumenting `fix/claude-agent-sdk-stream-perf`. Several of these go deeper than the perf complaint that started the investigation. Use this as a checklist — fill in the status log as we work through it.

## Confirmed observations

### A. Cold-start fresh-seed handoff is huge

- 79-message pi session, `pi -c`, `hasContinuity: false` → `buildFreshSeedHandoff` flattens the entire pi conversation into one user message.
- Measured: **318,408 bytes** in a single `SDKUserMessage`. ≈ 80K tokens, prompt-cache-cold every time it fires.
- Captured in `/tmp/pi-claude-agent-sdk-provider.log` at `2026-04-27T15:24:18` — `runSessionQuery:push-input` line shows `handoffBytes: 318408`, preview starts with `"Pi session handoff for Claude Agent SDK:"`.

### B. Continuity isn't surviving pi restart in observed cases

- `pi -c` on an existing session (79 messages) shows `hasContinuity: false` on turn 1 of the new pi process.
- Persistence within a process works: turn 2 in the same pi run shows `hasContinuity: true` (turn 1 captured `sdkSessionId` and `markSessionSynced` ran on `turn_end`).
- Cross-restart load is what's breaking. Root cause unconfirmed — see H3.

### C. Turn-2 stall (in-process, after successful turn 1)

- Captured `2026-04-27T14:56:51` → `14:58:21`.
- Turn 1 completed cleanly with `stopReason: "stop"`.
- Turn 2 started with `hasContinuity: true`, `handoff: true`. 3 `system` messages arrived, then **90 seconds of dead air**, then the watchdog fired (`runSessionQuery:no-output-timeout`).
- The 90s no-output watchdog is currently load-bearing for recovery. Without it the session would hang indefinitely.
- Root cause unconfirmed — see H1, H2.

### D. Architectural: two-state-machine design

- Pi is the source of truth for the conversation tree (forks, branches, compactions, custom messages).
- The SDK subprocess maintains its own independent session transcript on disk.
- The handoff is the bridge between them.
- t3code (`reference/t3code/apps/server/src/provider/Layers/ClaudeAdapter.ts:581`) does *not* do this — they treat the SDK as the single source of truth and just push the user's prompt straight through. They can do that because t3code's UI is built around the SDK; pi can't because pi has its own structural ops.
- The current design has 3 handoff modes (fresh seed, delta, context fallback) and 3 reset triggers (compact, fork/tree, branch mismatch). This is over-engineered for the common case (within-session continuation, where the SDK already has the context) and under-engineered for the worst case (post-compact full replay).

## Open hypotheses

Ordered by cost-to-test. For each: how to test, what each outcome means.

### H1: Turn-2 stall is caused by the delta handoff feeding the SDK content it already has

**Test (cheap — instrumentation already in place):**

```bash
PI_CLAUDE_AGENT_SDK_DEBUG=1 pi -c
# send prompt A, wait for completion
# send prompt B
# tail /tmp/pi-claude-agent-sdk-provider.log
```

Inspect the *second* `runSessionQuery:push-input` line. The `handoffPreview` field will show the first 400 chars of what we sent.

**Outcomes:**

- Preview begins with `"Pi session handoff since Claude Agent SDK last synced:"` and contains `"Assistant:\n<turn 1's reply>"` → **likely cause confirmed**. The SDK is being told what it just said. Move to H1-fix.
- Preview contains `Tool result (...)` entries or `Context:\n...` (custom messages from extensions) the SDK could not have seen → handoff is doing real work, stall is something else. Move to H2.
- `handoffBytes: 0` or `handoff: false` → stall is unrelated to handoff. Move to H2.

**H1 fix candidate:** skip the handoff entirely when `sdkSessionId` is set AND the live SDK query is still alive (i.e., turn 2+ in the same pi process). Trust the SDK's working memory. One-line change in `runSessionQuery` or `prepareForTurn`.

### H2: Stall is upstream of pi (auth, network, or `claude` binary itself)

**Test (cheap — already wired):**

`PI_CLAUDE_AGENT_SDK_DEBUG=1` already sets `debugFile: /tmp/pi-claude-code-debug.log` (the SDK subprocess's own debug log) and pipes the subprocess stderr through our `debug()` helper.

After repro'ing the stall, check `/tmp/pi-claude-code-debug.log` for the dead-air window.

**Outcomes:**

- Auth/OAuth refresh chatter at the stall point → token refresh is hanging. Investigate OAuth flow inside the `claude` binary.
- Network/HTTP errors → upstream issue (Anthropic side or local connectivity).
- Subprocess silent at the stall point → the `claude` binary itself is wedged. Likely a claude-agent-sdk bug; consider building a minimal reproducer and filing upstream.
- Subprocess actively processing but no output reaches us → bug in our consumeLiveQuery loop (unlikely given other turns work).

### H3: Continuity isn't persisting across pi restart, or is being reset at startup

**Test (cheap):**

```bash
# 1. start fresh on an existing session
pi -c
# 2. send one short prompt, let it complete
# 3. quit cleanly (Ctrl-D / :q / however)
# 4. inspect the on-disk session log
ls -la ~/.pi/sessions/<session-id>/
# look for entries matching SESSION_ENTRY_TYPE in the JSONL log
# 5. relaunch
PI_CLAUDE_AGENT_SDK_DEBUG=1 pi -c
# 6. send another short prompt
# 7. check log: was hasContinuity true on turn 1?
```

**Outcomes:**

- No `SESSION_ENTRY_TYPE` entries on disk after step 3 → **persistence isn't writing**. Bug in `appendContinuity` or `captureSdkSessionId` isn't firing the persist callback. Add debug logging in `persistSessionEntry`.
- Entries exist but `hasContinuity: false` on step 7 → **load is failing OR reset fires before turn 1**. Add temporary debug logging in `loadContinuity` and `resetContinuity` to discriminate. Also check what `event.reason` is for `pi -c`'s `session_start` (might be firing `"new"` instead of `"resume"`, in which case our `onSessionStart` resets continuity).
- Entries exist, `hasContinuity: true` on step 7 → continuity works for clean restart. The 318KB log we already have was a one-off (first run after branch switch, no prior entries existed yet).

### H4: Even fresh-seed handoffs are the wrong shape (architectural)

After H1/H3 fixes, fresh seed still fires after `/compact`, `/fork`, `/tree`, and branch mismatches. Currently we send the entire pi history flattened into one user message. The SDK's `query()` may support seeding via structured messages instead.

**Test (research, not repro):**

- Check `@anthropic-ai/claude-agent-sdk` Options docs and source: does `query()` accept a pre-loaded message array, or only `string | AsyncIterable<SDKUserMessage>`?
- If structured turns are accepted, fresh seed could push proper user/assistant pairs into the new SDK session instead of one giant user-prefix. This would fix prompt caching and reduce the cold-start cost.

### H5: Collapse the handoff to fire only at session boundaries (architectural, depends on H1+H3)

If H1 confirms the per-turn delta is harmful and H3 confirms restart continuity should work, the simplification is:

- **Within a live query**: send only the user's prompt. No handoff.
- **After pi restart with intact continuity**: open query with `resume: priorSessionId`, send only the user's prompt. The SDK loads its own transcript.
- **Only on real structural breaks** (compact, fork, tree, branch mismatch): fresh seed handoff to bring a brand-new SDK session up to speed.

This is the t3code-shaped path on the common case, while still respecting pi's structural operations. Eliminates the "delta handoff" mode entirely.

**Trade-off:** if a pi extension adds custom messages between turns that the SDK should see, those won't reach the SDK. We'd need to decide whether that's a real workflow (and if so, find a different bridge for it).

## Investigation order

1. **H1** — smallest test, biggest stall payoff. Two-prompt repro, look at the delta preview.
2. **H3** — cheap, fixes the 318KB cold-start case if it pans out. Run before/after restart, check disk + log.
3. **H2** — only if H1 doesn't pan out. Read the SDK's own debug log around the stall window.
4. **H4** — research, can run in parallel with H3.
5. **H5** — decision based on outcomes of H1+H3+H4. This is the architectural simplification; do it last.

## Things not to break

- **The 90s no-output watchdog stays** until the underlying stall (H1 or H2) is fixed. It's currently load-bearing for recovery. Removing it before the fix means hangs become indefinite instead of self-recovering.
- **The premature-finish gate** (commit `e888d62`) is correct and unrelated to these issues. Don't revert it during this investigation.
- **The `closeLiveQuery`-not-`resetContinuity` swap** (commit `ec5ff04`) is also correct: aborts and turn replacements should preserve `sdkSessionId` so the next turn can resume cheaply. Don't roll back.

## Out of scope

- Subprocess fork latency (~900ms-3s). One-shot only; not a recurring cost in interactive sessions.
- Effect-based rewrite. Adds complexity, doesn't address root causes.
- Removing the SDK provider. Out of scope; the value is the Claude Code tool stack + Max subscription billing.

## Status log

| Date | What ran | What we learned | Next |
|------|----------|-----------------|------|
| 2026-04-27 | Initial perf+stall instrumentation, 6 commits on `fix/claude-agent-sdk-stream-perf` | Confirmed throttle, MCP cache, OAuth strip working. Confirmed turn-2 stall + 318KB cold-start handoff. | Run H1 and H3 in next session. |
