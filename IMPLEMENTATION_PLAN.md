# Ralph Loop Extension — Implementation Plan

> A pi extension for long-running iterative agent loops with fresh context
> per iteration. Steer the loop, reflect on progress, let the agent drive
> its own task file. Optionally detach and reattach later.

## Design Goals

1. **Fresh context per iteration** — each iteration is a clean slate. No context
   window bloat at iteration 47.
2. **In-session first** — the loop runs within your pi session. You see
   everything happening live, as if the agent were working normally. No extra
   processes, no filesystem polling, no indirection.
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
7. **Detach/attach (future)** — once the in-session loop is solid, extract
   the engine to a detached process. Walk away, come back later.

## Architecture

### In-Session Mode (Primary)

The extension spawns `pi --mode rpc --no-session` as a **child process**
(not detached) and drives the iteration loop directly. Events from RPC
stdout are rendered in the TUI in real-time. User input is forwarded to
the RPC process as steer/follow-up commands.

```
┌──────────────────────────────────────────────────────────┐
│  pi extension (ralph)                                     │
│                                                           │
│  Spawns: pi --mode rpc --no-session (child process)       │
│  Holds stdin/stdout handles to the RPC process            │
│                                                           │
│  Loop:                                                    │
│    1. Read task.md, build iteration prompt                │
│    2. Send {"type": "prompt", "message": "..."}           │
│    3. Stream events → render in TUI + write events.jsonl  │
│    4. pi.on("input") intercepts editor submissions:       │
│       → forward as RPC steer (mid-iteration)              │
│       → queue as follow-up (between iterations)           │
│    5. On agent_end event:                                 │
│       → Collect stats (tokens, cost, duration)            │
│       → Send {"type": "new_session"}  ← FRESH CONTEXT    │
│       → Update state.json                                 │
│       → Check for stop signal / completion                │
│       → Re-read task.md (agent may have updated it)       │
│       → Send next iteration's prompt                      │
│                                                           │
│  When pi exits → RPC child dies too (that's fine)         │
│  /ralph stop → graceful stop after current iteration      │
└──────────────────────────────────────────────────────────┘
```

### Why This Architecture

- **`pi --mode rpc`** — gives us a persistent pi process with full tool access,
  event streaming, and the ability to send `steer`/`follow_up` mid-iteration.
  This is strictly better than `pi -p` (which can't be steered).
- **`new_session` RPC command** — resets context between iterations. We get the
  fresh-context-per-iteration property of the shell loop prototype without
  killing and respawning the process.
- **In-process loop** — no filesystem polling, no IPC overhead. Events go
  directly from RPC stdout to the TUI renderer. Input goes directly from
  the editor to RPC stdin. Simple, fast, debuggable.
- **Filesystem artifacts for observability** — state.json, events.jsonl, and
  iterations/ are still written, giving us telemetry, crash recovery data,
  and the foundation for future detach/attach mode.

### Filesystem Layout

```
.ralph/
  <name>/
    task.md              # The task prompt (agent's working memory)
    config.json          # Loop configuration (max iterations, model, etc.)
    state.json           # Loop state (iteration, status, stats)
    events.jsonl         # Append-only log of all RPC events
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
- **STARTING** — RPC process spawning
- **RUNNING** — actively iterating
- **STOPPED** — user stopped it (`/ralph stop`)
- **COMPLETED** — task signaled done, or max iterations reached
- **ERROR** — RPC process crashed

### Event Rendering

Events from the RPC process are rendered directly in the TUI using pi's
built-in components. No tailing, no replaying — it's live.

| RPC Event              | TUI Rendering                                      |
| ---------------------- | -------------------------------------------------- |
| `message_update`       | Stream assistant text (text_delta), thinking blocks |
| `tool_execution_start` | Show tool call header (like normal pi)              |
| `tool_execution_update`| Stream tool output                                 |
| `tool_execution_end`   | Show tool result                                   |
| `agent_start`          | Iteration border: `─── Iteration N ───`            |
| `agent_end`            | Stats border: `─── 45s │ 3 turns │ $0.12 ───`     |
| `auto_compaction_*`    | Show compaction status                             |
| `auto_retry_*`         | Show retry status                                  |

The approach: use `pi.sendMessage()` with custom types and
`pi.registerMessageRenderer()` that instantiates pi's **real built-in
components** (`ToolExecutionComponent`, `AssistantMessageComponent`).
This gives native rendering fidelity — syntax highlighting, diffs, markdown,
image support — for free. Already proven in Phase 0.

### Input Routing

When a loop is active, `pi.on("input", ...)` intercepts editor submissions
and routes them to the RPC process instead of the foreground agent:

- **Mid-iteration** → `steer` RPC command (interrupts the agent)
- **Between iterations** → queued as follow-up (sent as next prompt)
- **Not in a loop** → `{ action: "continue" }` (normal pi behavior)

```typescript
pi.on("input", (event, ctx) => {
  if (!activeLoop) return { action: "continue" };
  // Forward directly to RPC process — no filesystem indirection
  activeLoop.steer(event.text);
  return { action: "handled" };
});
```

### Widget

A `setWidget()` above the editor showing loop metadata:

```
🔄 ralph: my-feature │ iteration 7/50 │ running │ ⏱ 12m │ $0.847
```

Updated on each iteration boundary. Shows name, iteration/max, status,
elapsed time, cumulative cost.

### Telemetry

Stats are extracted from RPC events in real-time:

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

- [x] Spawn `pi --mode rpc --no-session` as a child process
- [x] Send prompts via RPC stdin, read events from stdout
- [x] Write all events to `.ralph/test/events.jsonl`
- [x] On `agent_end` → send `new_session` → send next prompt
- [x] Track tool args from `tool_execution_start`, pair with `tool_execution_end`
- [x] Render tool calls via `ToolExecutionComponent` (native pi rendering)
- [x] Render assistant text via `AssistantMessageComponent` with `getMarkdownTheme()`
- [x] Iteration boundaries as labeled `─── Iteration N ───` borders
- [x] Per-iteration telemetry (duration, turns, tokens in/out, cost) in end border
- [x] Spinner widget (`Loader`) while RPC process boots
- [x] Status bar entry during iteration (`ralph: test (N/2)`)

### Phase 1: In-Session Loop Engine

The core loop, running inside the extension process. Merges the loop-runner
logic with direct TUI rendering. This is the foundation — everything that
the Phase 0 demo proved, but generalized for real use.

- [ ] Refactor into a `LoopEngine` class (or module) that the extension drives
  - Spawn `pi --mode rpc --no-session` as child process
  - Accept config (name, max iterations, model, provider, thinking)
  - Expose methods: `start()`, `stop()`, `steer(message)`, `followUp(message)`
  - Emit events the extension can render (or call render callbacks directly)
  - Handle RPC process lifecycle (startup, crash detection)
  - Graceful shutdown on stop
- [ ] Iteration loop
  - Read task.md at the start of each iteration
  - Send `prompt` RPC command
  - Parse event stream from RPC stdout
  - On `agent_end` → collect stats → send `new_session` → next iteration
  - Respect max iteration limit
  - Check for stop signal between iterations
- [ ] Event rendering (live, in TUI)
  - Reuse Phase 0 message renderers (`ralph_tool`, `ralph_assistant`, etc.)
  - Render events as they arrive from RPC stdout (no buffering)
  - Iteration start/end borders with telemetry
- [ ] Widget + status bar
  - Widget above editor: name, iteration/max, status, duration, cost
  - Status bar: compact `ralph: name (N/M)`
  - Updated on each iteration boundary
- [ ] Telemetry
  - Per-iteration stats → `iterations/NNN.json`
  - Cumulative stats → `state.json`
  - Extract from `message_end` events (tokens, cost) in real-time
- [ ] State management
  - Write `state.json` after each iteration (atomic: tmp + rename)
  - Write `config.json` on start
  - Write all events to `events.jsonl` (append-only, for debugging/replay)
- [ ] Commands
  - `/ralph start <name> [options]` — create loop dir, write task, start engine
  - `/ralph stop [name]` — signal stop after current iteration
  - `/ralph status [name]` — show loop stats from state.json
  - `/ralph list` — enumerate local `.ralph/*/` loops with status
  - `/ralph kill [name]` — force-kill the RPC process
  - `/ralph clean` — remove completed/stopped loop directories

### Phase 2: Input Routing (Steering + Follow-up)

Wire up input interception using pi's existing Enter/Alt+Enter UX.
Two distinct paths, matching pi's native steer vs follow-up semantics:

**Enter → steer** (interrupt RPC agent mid-iteration):
- `pi.on("input", ...)` intercepts when loop is active
- Returns `{ action: "handled" }` to prevent foreground agent processing
- Forwards text to RPC process as `{ type: "steer", message: text }`
- The RPC agent receives it after current tool execution, skips remaining tools

**Alt+Enter → follow-up** (queue for next iteration):
- `pi.registerShortcut("alt+enter", ...)` fires before pi's built-in handler
- Reads editor text via `ctx.ui.getEditorText()`
- Clears editor via `ctx.ui.setEditorText("")`
- Queues text via `activeLoop.engine.followUp(text)` — used as next iteration's
  prompt instead of task.md
- Pi's built-in `handleFollowUp()` never runs (shortcut consumed the keypress)

**When no loop is active** — both paths fall through to normal pi behavior.
The alt+enter shortcut must handle this carefully: if no loop is active, it
needs to trigger the normal follow-up behavior (read editor text, call
`pi.sendUserMessage()` with appropriate delivery).

- [ ] Register `pi.on("input", ...)` handler
  - When loop active: return `{ action: "handled" }`, forward to RPC as steer
  - When no loop active: return `{ action: "continue" }` for normal behavior
- [ ] Register `pi.registerShortcut("alt+enter", ...)` handler
  - When loop active: `getEditorText()` → `setEditorText("")` → queue follow-up
  - When no loop active: `getEditorText()` → `setEditorText("")` →
    `pi.sendUserMessage(text, { deliverAs: "followUp" })` to preserve native behavior
- [ ] Show submitted message in TUI as visual confirmation
  - `pi.sendMessage()` with a `ralph_steer` or `ralph_followup` renderer
  - Echo what was sent so the user sees their message in the chat flow
- [ ] Widget indication that input is being routed to the loop
  - Visual cue so the user knows their editor submissions go to ralph

### Phase 3: Reflection + Task File Management

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

### Phase 4: SKILL.md + Agent Self-Start

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

### Phase 5: Polish + Edge Cases

- [ ] Handle multiple loops (only one active in-session at a time)
  - `/ralph list` shows all, `/ralph start` while one is running prompts
- [ ] Log rotation / cleanup for events.jsonl
  - Rotate after N iterations or N MB
- [ ] Error recovery
  - RPC process crashes mid-iteration → detect, report, offer restart
  - Clear error reporting in state.json and TUI
- [ ] Configuration
  - Default model/provider/thinking for loop processes
  - Default max iterations
  - Default reflect interval and prompt
  - Per-project vs global settings

### Phase 6: Detach/Attach (Future)

Extract the loop engine to a detachable process. The in-session mode
continues to work as-is; detach mode adds the ability to walk away.

- [ ] Extract loop engine to standalone loop-runner script
  - Same iteration logic, but runs as a detached process
  - Communicates via filesystem (events.jsonl, inbox/, state.json)
  - Survives parent exit (`detached: true`, `unref()`)
- [ ] Filesystem IPC for commands
  - inbox/steer.json, inbox/stop.json, etc.
  - Loop runner polls inbox, forwards to RPC
- [ ] Global process registry (`~/.ralph/registry/`)
  - One file per loop: `--<cwd-slugified>--<name>.json`
  - Health checks, stale entry pruning
- [ ] `/ralph detach` command
  - Migrate from in-session to detached mode
  - Or: start in detached mode with `--detach` flag
- [ ] `/ralph attach <name>` command
  - Tail events.jsonl, render in TUI
  - Install input handler for steering via inbox
  - Cross-project attach via registry
- [ ] Event log tailing
  - Track read offset
  - Replay recent events on attach
  - `fs.watch` or polling for new lines

### Stretch: Worktree-Based Parallel Loops

Run multiple loops against different git worktrees from the same repo.

- `/ralph start my-feature --worktree feature-branch`
- Creates a git worktree at `.ralph/<name>/worktree/`
- RPC process cwd is set to the worktree
- Agent works in isolation — file edits, git commits don't affect main
- `/ralph clean <name>` removes the worktree

## Decisions

- **In-session first** — get the full loop experience working before adding
  detach/attach complexity. The filesystem artifacts (state.json, events.jsonl,
  iterations/) are written regardless, so nothing is wasted when we add
  detached mode later.

- **LoopEngine as a class/module** — encapsulates RPC management, iteration
  logic, and telemetry. The extension creates an instance on `/ralph start`
  and holds a reference. Later, the standalone loop-runner can use the same
  engine. Single source of truth for loop behavior.

- **Direct RPC communication** — in-session mode talks to the RPC process
  directly via stdin/stdout. No filesystem indirection for steer/follow-up
  commands. Simpler, faster, fewer failure modes. Filesystem-based inbox
  is only needed for detached mode.

- **Reflect prompt authoring**: Separate file (`.ralph/<name>/reflect.md`),
  not inline in config. Easier to edit, version control, and swap out.

- **Extensions/skills in RPC process**: Pass through as CLI args when spawning
  `pi --mode rpc`. User specifies via `/ralph start` options
  (e.g., `--extension ./my-ext.ts --skill my-skill`).

## Open Questions

- **Streaming updates via registerMessageRenderer**: Pi exports the built-in
  TUI components and they accept the same data types as RPC events, so static
  rendering is solved (native fidelity). The remaining question is whether
  `registerMessageRenderer` supports re-rendering on message update for live
  streaming of tool output. If not, we may need to buffer events and render
  complete units. Phase 1 investigation.

- **Events.jsonl size**: For long-running loops (50+ iterations), the event log
  could get very large. Need a rotation/truncation strategy. One option: rotate
  per-iteration (one JSONL file per iteration), only keep the last N.

- **Session persistence**: Option to use `--session-dir` instead of
  `--no-session` in the RPC process, enabling crash recovery by resuming
  from the last session state.

## Prior Art

- **ralph-prototype/** (this repo) — shell-driven outer loop, fresh pi -p
  process per iteration, telemetry extension, tmux-based parallel runs. Good
  for unattended batch evaluation. Lacks interactivity.

- **@tmustier/pi-ralph-wiggum** — in-session pi extension, agent self-starts
  via tools, pause/resume/archive lifecycle, UI widgets. Good interactivity.
  Lacks detach/attach, context bloats over iterations.

- **pi-review-loop** — simpler iteration loop focused on code review.
  In-session, no detach.

This design takes the best of both: fresh context per iteration (prototype),
full TUI integration and agent self-start (tmustier), with detach/attach
as a future enhancement once the core loop is proven.
