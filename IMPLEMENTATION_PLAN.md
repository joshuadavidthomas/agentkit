# Ralph Loop Extension — Implementation Plan

> A pi extension for long-running iterative agent loops with fresh context
> per iteration. Steer the loop, reflect on progress, let the agent drive
> its own task file.

## Design Goals

1. **Fresh context per iteration** — each iteration is a clean slate. No context
   window bloat at iteration 47.
2. **In-session** — the loop runs within your pi session. You see everything
   happening live, as if the agent were working normally. No extra processes,
   no filesystem polling, no indirection.
3. **Mid-iteration steering** — type a message while the agent is working and
   it gets injected immediately (steer) or queued for next iteration
   (follow-up).
4. **Native TUI feel** — loop output looks and feels like a normal pi session.
   Loop metadata displayed as a widget above the editor. Tool calls and
   assistant messages rendered natively.
5. **Telemetry** — token usage, cost, timing per iteration and cumulative.
6. **Task file as working memory** — the agent reads and updates a task file
   each iteration. Checklist progress, notes, and context survive across
   fresh-context boundaries.

## Architecture

### In-Process via SDK

The extension creates an `AgentSession` (from the pi SDK) directly in the
same Node.js process. No subprocess, no RPC, no JSON serialization.
Events are received via `session.subscribe()`, steering via `session.steer()`,
fresh context via `session.newSession()`.

```
┌──────────────────────────────────────────────────────────┐
│  pi extension (ralph)                                     │
│                                                           │
│  Creates: AgentSession via createAgentSession()           │
│  In-process — same Node.js heap, typed events             │
│                                                           │
│  Loop:                                                    │
│    1. Read task.md, build iteration prompt                │
│    2. await session.prompt(taskContent)                   │
│    3. session.subscribe() → render in TUI                 │
│    4. pi.on("input") intercepts editor submissions:       │
│       → session.steer(text) (mid-iteration)               │
│       → queue follow-up (between iterations)              │
│    5. On agent_end event:                                 │
│       → Collect stats (tokens, cost, duration)            │
│       → await session.newSession() ← FRESH CONTEXT       │
│       → Update state.json                                 │
│       → Check for stop signal / completion                │
│       → Re-read task.md (agent may have updated it)       │
│       → await session.prompt(nextTask)                    │
│                                                           │
│  When pi exits → session.dispose() — clean, instant       │
│  /ralph stop → graceful stop after current iteration      │
└──────────────────────────────────────────────────────────┘
```

### Why In-Process (SDK) Over RPC Subprocess

The original design spawned `pi --mode rpc --no-session` as a child process.
This was a good tracer bullet (Phase 0) but proved to be the source of most
bugs and complexity:

- **Process management** — detached spawning, process groups, SIGTERM,
  unref(), Ctrl+C handling, zombie processes. All gone with SDK.
- **JSON serialization overhead** — events serialized to stdout, parsed back.
  With SDK, events are typed objects in the same heap.
- **Event timing** — getting user message insertion right required careful
  correlation of `message_start`/`message_end` events over a JSON stream.
  With SDK, `session.steer()` is a method call with clear semantics.
- **Startup latency** — no process spawn, just `createAgentSession()`.
- **Memory** — one process instead of two.

The SDK provides everything the RPC mode did:
- `session.prompt()` — send iteration prompts
- `session.steer()` — mid-iteration steering (first-class method)
- `session.followUp()` — queue for after current work
- `session.newSession()` — fresh context between iterations
- `session.subscribe()` — typed event stream
- `session.abort()` — cancel current operation
- `session.dispose()` — clean shutdown
- `SessionManager.inMemory()` — no session persistence

### Filesystem Layout

```
.ralph/
  <name>/
    task.md              # The task prompt (agent's working memory)
    config.json          # Loop configuration (max iterations, model, etc.)
    state.json           # Loop state (iteration, status, stats)
    reflect.md           # Optional: custom reflection prompt
    iterations/          # Per-iteration telemetry
      001.json           # {tokens, cost, duration, summary}
      002.json
      ...
```

### State Machine

```
              /ralph start
                   │
                   ▼
             ┌──────────┐
             │  RUNNING  │
             └────┬─────┘
                  │
       ┌──────────┼──────────┐
       │          │          │
  /ralph stop  max iters  task complete
       │          │          │
       ▼          ▼          ▼
  ┌─────────┐ ┌─────────┐ ┌───────────┐
  │ STOPPED │ │ STOPPED │ │ COMPLETED │
  └─────────┘ └─────────┘ └───────────┘
```

States:
- **STARTING** — AgentSession being created
- **RUNNING** — actively iterating
- **STOPPED** — user stopped it (`/ralph stop`)
- **COMPLETED** — task signaled done, or max iterations reached
- **ERROR** — session error

### Event Rendering

Events from `session.subscribe()` are rendered directly in the TUI using
pi's built-in components. Same approach as before — `pi.sendMessage()` with
custom types and `pi.registerMessageRenderer()` — but events arrive as
typed objects instead of parsed JSON.

| Session Event            | TUI Rendering                                      |
| ------------------------ | -------------------------------------------------- |
| `message_update`         | Stream assistant text (text_delta), thinking blocks |
| `tool_execution_start`   | Show tool call header (like normal pi)              |
| `tool_execution_update`  | Stream tool output                                 |
| `tool_execution_end`     | Show tool result                                   |
| `agent_start`            | Iteration border: `─── Iteration N ───`            |
| `agent_end`              | Stats border: `─── 45s │ 3 turns │ $0.12 ───`     |
| `auto_compaction_*`      | Show compaction status                             |
| `auto_retry_*`           | Show retry status                                  |

### Input Routing

When a loop is active, `pi.on("input", ...)` intercepts editor submissions
and routes them to the loop session:

- **Mid-iteration** → `session.steer(text)` (interrupts the agent)
- **Between iterations** → queued as follow-up (appended to next prompt)
- **Not in a loop** → `{ action: "continue" }` (normal pi behavior)

```typescript
pi.on("input", (event, ctx) => {
  if (!activeLoop) return { action: "continue" };
  activeLoop.session.steer(event.text);
  return { action: "handled" };
});
```

### Widget

A `setWidget()` above the editor showing loop metadata:

```
ralph: my-feature │ running │ iter 7/50 │ 12m │ $0.847
```

Updated on each iteration boundary. Shows name, iteration/max, status,
elapsed time, cumulative cost. Pending follow-up messages shown above
in dim text matching pi's native styling.

### Telemetry

Stats are extracted from session events in real-time:

- **Per iteration**: tokens (input/output/cache), cost, duration, turn count.
  Written to `iterations/NNN.json`.
- **Cumulative**: aggregated in `state.json`, updated after each iteration.
- **Widget display**: updated live from in-memory stats.
- **`/ralph status`**: reads from state.json for a summary view.

## Phases

### Phase 0: Tracer Bullet ✅

Proved the core bets: RPC iteration loop works, `new_session` clears context,
events render identically to native pi output using pi's own components,
per-iteration telemetry is available from the event stream.

### Phase 1: In-Session Loop Engine ✅

Core loop running inside the extension. LoopEngine class, iteration logic,
TUI rendering, widget, telemetry, commands. Originally built on RPC subprocess.

### Phase 2: Input Routing ✅

Enter → steer mid-iteration. Alt+N → queue follow-up for next iteration.
Sticky pending message display in widget. User messages inserted into stream
at the right position (on `message_start` for steers, on iteration start
for follow-ups).

### Phase 3: SDK Migration

Replace the RPC subprocess with the pi SDK (`createAgentSession`). This
eliminates all process management complexity while keeping the same
user-facing behavior.

- [ ] Replace RPC subprocess with `createAgentSession()` in LoopEngine
  - `SessionManager.inMemory()` for no persistence
  - Configure model/provider/thinking via session options
  - Share `AuthStorage` and `ModelRegistry` from parent pi
- [ ] Replace `rpcSend({ type: "prompt" })` with `await session.prompt()`
- [ ] Replace `rpcSend({ type: "new_session" })` with `await session.newSession()`
- [ ] Replace `rpcSend({ type: "steer" })` with `await session.steer()`
  - Remove the wrapper prompt — `session.steer()` handles delivery natively
- [ ] Replace JSON event parsing with `session.subscribe()`
  - Same event types, but typed — no more JSON.parse on stdout lines
  - Remove readline, events.jsonl writing (or keep for debugging)
- [ ] Replace process lifecycle management with `session.dispose()`
  - Remove spawn, detached, unref, process groups, SIGTERM
  - Remove session_shutdown handler (dispose is instant)
- [ ] Replace `agent_end` promise resolution with proper event handling
  - Subscribe to `agent_end` event directly
- [ ] Verify: steer user message timing still works
  - `message_start` with role "user" should still fire for steers
- [ ] Verify: telemetry extraction from `message_end` events still works
- [ ] Remove `/ralph kill` command (no process to kill, stop is sufficient)
- [ ] Update index.ts event rendering to use typed events instead of
  `Record<string, unknown>` casts

### Phase 4: Reflection + Task File Management

The agent's working memory across iterations, plus periodic reflection.

- [ ] Task file as working memory
  - The agent can update task.md during iterations (via write tool)
  - Loop engine re-reads task.md at the start of each iteration
  - Prompt includes instructions to maintain the task file
- [ ] Task file templates
  - Default template with Goals / Checklist / Notes sections
  - `/ralph start` without an existing task file creates from template
  - The agent's checklist progress persists across fresh-context iterations
- [ ] Reflection scheduling
  - Every N iterations, prepend reflection instructions to the prompt
  - Default reflection prompt: "Review task.md, update progress, note blockers"
  - Custom reflection prompt via `.ralph/<name>/reflect.md`
  - Configurable interval (`--reflect-every N`)
  - Track last reflection iteration in state
- [ ] Completion detection
  - Detect when all checklist items in task.md are checked → auto-complete
  - Also support explicit completion marker in agent output
  - On completion: update state, stop loop, show summary

### Phase 5: SKILL.md + Agent Self-Start

Allow the agent to start loops on its own.

- [ ] Write SKILL.md for agent discoverability
  - When to use ralph loops (long-running, iterative, verifiable tasks)
  - How to structure a task file
  - How the iteration/reflection cycle works
- [ ] Register `ralph_start` tool
  - Agent can create a task file and start a loop programmatically
  - Parameters: name, task content, max iterations, reflect interval
  - Creates the directory structure, writes task.md, starts loop engine
- [ ] Register `ralph_status` tool
  - Agent can check on running loops
  - Returns structured data about loop state

### Phase 6: Polish + Edge Cases

- [ ] Handle multiple loops (only one active in-session at a time)
  - `/ralph list` shows all, `/ralph start` while one is running prompts
- [ ] Error recovery
  - Session errors → detect, report, offer restart
  - Clear error reporting in state.json and TUI
- [ ] Configuration
  - Default model/provider/thinking for loop sessions
  - Default max iterations
  - Default reflect interval and prompt
  - Per-project vs global settings

## Decisions

- **In-process via SDK** — the RPC subprocess approach was a useful tracer
  bullet but introduced unnecessary complexity (process management, JSON
  serialization, event timing bugs, Ctrl+C issues). The SDK provides the
  same capabilities (`prompt`, `steer`, `followUp`, `newSession`) as typed
  method calls in the same process. Simpler, faster, fewer failure modes.

- **No detach/attach** — the original plan included a future phase for
  detaching loops to survive the parent process. In practice, the in-session
  experience is more valuable. Detach/attach would require subprocess mode,
  filesystem IPC, process registries — significant complexity for a mode
  that conflicts with the core "you see everything live" design goal.

- **LoopEngine as a class/module** — encapsulates session management,
  iteration logic, and telemetry. The extension creates an instance on
  `/ralph start` and holds a reference. Single source of truth for loop
  behavior.

- **Reflect prompt authoring**: Separate file (`.ralph/<name>/reflect.md`),
  not inline in config. Easier to edit, version control, and swap out.

## Open Questions

- **Streaming updates via registerMessageRenderer**: Pi exports the built-in
  TUI components and they accept the same data types as session events, so
  static rendering is solved (native fidelity). The remaining question is
  whether `registerMessageRenderer` supports re-rendering on message update
  for live streaming of tool output. If not, we may need to buffer events
  and render complete units.

- **Shared auth/model config**: The SDK session needs API keys and model
  config. We can share the parent pi's `AuthStorage` and `ModelRegistry`
  (or just pass model directly). Need to verify the cleanest way to get
  these from within an extension.

## Prior Art

- **ralph-prototype/** (this repo) — shell-driven outer loop, fresh pi -p
  process per iteration, telemetry extension, tmux-based parallel runs. Good
  for unattended batch evaluation. Lacks interactivity.

- **@tmustier/pi-ralph-wiggum** — in-session pi extension, agent self-starts
  via tools, pause/resume/archive lifecycle, UI widgets. Good interactivity.
  Lacks fresh context per iteration.

- **pi-review-loop** — simpler iteration loop focused on code review.
  In-session, no detach.

This design takes the best of both: fresh context per iteration (prototype),
full TUI integration and agent self-start (tmustier), all in-process via
the SDK for maximum simplicity.
