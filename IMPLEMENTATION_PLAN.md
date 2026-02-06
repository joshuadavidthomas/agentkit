# Ralph Loop Extension — Implementation Plan

> A pi extension for long-running iterative agent loops with detach/attach
> semantics. Watch a loop, steer it, walk away, come back later.

## Design Goals

1. **Detach/attach** — start a loop, watch it, exit pi, come back later and
   reattach. The loop keeps running regardless.
2. **Fresh context per iteration** — each iteration is a clean slate. No context
   window bloat at iteration 47.
3. **Mid-iteration steering** — type a message while the agent is working and
   it gets injected immediately (steer) or queued for next iteration
   (follow-up).
4. **Native TUI feel** — when attached, it should look and feel like a normal pi
   session. Loop metadata displayed as a widget above the editor. Events
   rendered as normal tool calls and assistant messages.
5. **Telemetry** — token usage, cost, timing per iteration and cumulative.

## Architecture

Two decoupled processes communicating via the filesystem:

```
┌──────────────────────────────────────────────────────────┐
│  Loop Runner (detached Node.js process)                   │
│                                                           │
│  Spawns: pi --mode rpc --no-session                       │
│  Holds stdin/stdout handles to the RPC process            │
│                                                           │
│  Loop:                                                    │
│    1. Send {"type": "prompt", "message": "..."}           │
│    2. Stream events → .ralph/<name>/events.jsonl          │
│    3. Watch .ralph/<name>/inbox/ for command files         │
│       → steer.json    → forward as RPC steer              │
│       → followup.json → forward as RPC follow_up          │
│       → abort.json    → forward as RPC abort              │
│       → stop.json     → graceful shutdown after iteration │
│    4. On agent_end event:                                 │
│       → Collect stats (tokens, cost, duration)            │
│       → Send {"type": "new_session"}  ← FRESH CONTEXT    │
│       → Update .ralph/<name>/state.json                   │
│       → Check for stop signal                             │
│       → Send next iteration's prompt                      │
│                                                           │
│  Survives parent exit (detached: true, unref'd)           │
│  PID stored in .ralph/<name>/pid                          │
└──────────────────────────────────────────────────────────┘
         ▲ filesystem ▲
         │            │
    write commands   tail events
         │            │
┌────────┴────────────┴────────────────────────────────────┐
│  Foreground pi extension (user's interactive TUI)         │
│                                                           │
│  /ralph start "name" [options]                            │
│    → writes task file                                     │
│    → spawns loop runner (detached)                        │
│    → auto-attaches                                        │
│                                                           │
│  Attached mode:                                           │
│    → tails events.jsonl, renders events in TUI            │
│    → widget above editor: loop name, iteration, status    │
│    → custom editor via setEditorComponent():              │
│        Enter     → write steer command to inbox/          │
│        Alt+Enter → write followup command to inbox/       │
│    → Escape     → abort current iteration                 │
│                                                           │
│  /ralph detach (or just quit pi)                          │
│    → stop tailing, restore default editor                 │
│    → loop runner keeps going                              │
│                                                           │
│  /ralph attach "name"                                     │
│    → verify PID is alive                                  │
│    → start tailing events.jsonl                           │
│    → install custom editor, show widget                   │
│                                                           │
│  /ralph stop "name"                                       │
│    → write stop.json to inbox/                            │
│    → loop finishes current iteration then exits           │
└──────────────────────────────────────────────────────────┘
```

### Why This Architecture

- **Filesystem as IPC** — both sides are fully decoupled. The loop runner
  doesn't know or care if anyone is watching. Command files in the inbox are
  the only way to communicate inward. This is what makes detach/attach trivial.
- **`pi --mode rpc`** — gives us a persistent pi process with full tool access,
  event streaming, and the ability to send `steer`/`follow_up` mid-iteration.
  This is strictly better than `pi -p` (which can't be steered).
- **`new_session` RPC command** — resets context between iterations. We get the
  fresh-context-per-iteration property of the shell loop prototype without
  killing and respawning the process.
- **Loop runner as separate script** — not the extension itself. The extension
  is just a viewer/controller. This is what makes detach possible — the runner
  has no dependency on the foreground pi process.

### Filesystem Layout

**Per-project loop data** (in the project where the loop was started):

```
.ralph/
  <name>/
    task.md              # The task prompt (user-authored or generated)
    state.json           # Loop state (iteration, status, config, stats)
    pid                  # PID of the loop runner process
    events.jsonl         # Append-only log of all RPC events
    events.offset        # Last byte offset read by the attached viewer
    inbox/               # Command files (consumed by loop runner)
      steer.json         # {"message": "..."}
      followup.json      # {"message": "..."}
      abort.json         # {}
      stop.json          # {}
    iterations/          # Per-iteration records
      001.json           # {tokens, cost, duration, summary}
      002.json
      ...
```

**Global process registry** (`~/.ralph/registry/`):

One file per loop — no locking needed. Mirrors how pi organizes sessions:
pi uses `~/.pi/agent/sessions/--<cwd-path>--/<timestamp>_<uuid>.jsonl`, with
the cwd slugified as the directory name.

We follow a similar convention: each loop runner writes a single JSON file to
`~/.ralph/registry/`. The filename encodes the project + loop name so
collisions are impossible and listing is a simple directory scan.

```
~/.ralph/
  registry/
    --home-josh-projects-myapp--my-feature.json
    --home-josh-projects-other-project--fix-tests.json
```

Each registry file:

```json
{
  "pid": 12345,
  "cwd": "/home/josh/projects/myapp",
  "ralphDir": "/home/josh/projects/myapp/.ralph/my-feature",
  "name": "my-feature",
  "startedAt": "2026-02-06T17:50:00Z",
  "lastSeen": "2026-02-06T18:23:00Z",
  "model": "claude-sonnet-4",
  "provider": "anthropic",
  "status": "running",
  "iteration": 7,
  "maxIterations": 50
}
```

The registry is the source of truth for "what's running." The extension uses
it for:
- `/ralph list --all` — glob `~/.ralph/registry/*.json`, show all loops
- `/ralph list` (no flag) — filter to entries matching current cwd
- `/ralph attach <name>` — resolve by name, find the right loop even from a
  different project directory
- Health checks — verify PIDs are alive, delete stale registry files
- No name collisions — the filename includes the project path

The loop runner:
- **On startup**: writes its registry file (atomic: write tmp + rename)
- **On clean shutdown**: deletes its registry file
- **Heartbeat**: updates `lastSeen` and `iteration` periodically so the
  extension can detect stale entries (crashed without cleanup)
- **No file locking needed** — each loop owns exactly one file

### State Machine

```
                /ralph start
                     │
                     ▼
               ┌──────────┐
               │  RUNNING  │◄──── /ralph resume
               └────┬─────┘
                    │
         ┌──────────┼──────────┐
         │          │          │
    stop signal  max iters  task complete
         │          │          │
         ▼          ▼          ▼
    ┌─────────┐ ┌─────────┐ ┌───────────┐
    │ STOPPED │ │ STOPPED │ │ COMPLETED │
    └─────────┘ └─────────┘ └───────────┘
```

Loop runner states:
- **RUNNING** — actively iterating
- **PAUSED** — waiting (e.g., between iterations if a pause is requested)
- **STOPPED** — user stopped it, can be resumed
- **COMPLETED** — task signaled done, or max iterations reached
- **ERROR** — RPC process crashed, will be reported in state.json

### Event Rendering in TUI

When attached, the extension tails `events.jsonl` and renders RPC events as if
they were happening in the current pi session. The mapping:

| RPC Event              | TUI Rendering                                      |
| ---------------------- | -------------------------------------------------- |
| `message_update`       | Stream assistant text (text_delta), thinking blocks |
| `tool_execution_start` | Show tool call header (like normal pi)              |
| `tool_execution_update`| Stream tool output                                 |
| `tool_execution_end`   | Show tool result                                   |
| `agent_start`          | Update widget: "Iteration N started"               |
| `agent_end`            | Update widget: "Iteration N complete"              |
| `auto_compaction_*`    | Show compaction status                             |
| `auto_retry_*`         | Show retry status                                  |

Pi exports its built-in TUI components (`ToolExecutionComponent`,
`AssistantMessageComponent`, `UserMessageComponent`, etc.) from
`@mariozechner/pi-coding-agent`. These accept the exact same data types that
come out of RPC events — `AssistantMessage` objects, tool args/results, etc.

The approach: use `pi.sendMessage()` with custom types and
`pi.registerMessageRenderer()` that instantiates the **real built-in
components** rather than reimplementing rendering. This gives us native
rendering fidelity — syntax highlighting, diffs, markdown, image support —
for free.

```typescript
pi.registerMessageRenderer("ralph-tool", (message, options, theme) => {
  const { toolName, args, result } = message.details;
  const comp = new ToolExecutionComponent(toolName, args, opts, undefined, tui, cwd);
  if (result) comp.updateResult(result);
  return comp;
});
```

For streaming (live-updating tool output while attached), the components
support `updateResult(result, isPartial: true)`. Need to verify that
`registerMessageRenderer` re-calls the renderer on message update, or find
another way to pipe streaming updates into the component instance.

### Custom Editor (Attached Mode)

When attached, `ctx.ui.setEditorComponent()` installs a custom editor that:

- Extends `CustomEditor` to inherit app keybindings (Escape, Ctrl+D, etc.)
- On **Enter**: writes `steer.json` to the loop's inbox. The loop runner
  forwards it as an RPC `steer` command, interrupting the current iteration.
- On **Alt+Enter**: writes `followup.json` to the loop's inbox. The loop runner
  forwards it as an RPC `follow_up` command, queued for after the current
  iteration finishes.
- Shows placeholder text indicating the mode: "Steering ralph loop: <name>"
- On detach: restores the default editor via `setEditorComponent(undefined)`

### Widget (Above Editor)

A `setWidget()` above the editor showing:

```
🔄 ralph: my-feature │ iteration 7/50 │ running │ ⏱ 12m │ $0.847
```

Updated on each `agent_start`/`agent_end` event. Shows:
- Loop name
- Current iteration / max
- Status (running, waiting, steering...)
- Elapsed time
- Cumulative cost

### Telemetry

The loop runner extracts stats from RPC events:

- **Per iteration**: tokens (input/output/cache), cost, duration, turn count.
  Written to `iterations/NNN.json`.
- **Cumulative**: aggregated in `state.json`, updated after each iteration.
- **`get_session_stats` RPC command**: called after each iteration for
  authoritative token/cost numbers before `new_session` resets them.

The foreground extension reads these for the widget display. Also available
via `/ralph status` for a summary view.

## Phases

### Phase 0: Tracer Bullet

Prove the two core bets with minimal code before building anything real.
No steering, no custom editor, no registry, no state management, no
telemetry. Just: **does the loop run, and can I watch it from another
pi session?**

**Part A — Loop Runner script (`loop-runner.ts`)**

Standalone script, run with `bun run loop-runner.ts`:

- [ ] Spawn `pi --mode rpc --no-session` as a child process
- [ ] Send a prompt via RPC stdin: `{"type": "prompt", "message": "Create a
  file called hello.txt containing 'hello world'"}`
- [ ] Read RPC stdout line by line, write each event to
  `.ralph/test/events.jsonl`
- [ ] On `agent_end` event → send `{"type": "new_session"}`
- [ ] Send prompt #2: `{"type": "prompt", "message": "Read hello.txt and tell
  me what's in it"}`
- [ ] On second `agent_end` → exit

**What this proves**: The RPC iteration loop works. `new_session` clears
context (iteration 2 must re-read the file — it doesn't remember writing it).
Events are captured to a file.

**Part B — Minimal viewer extension (`index.ts`)**

A pi extension with one command:

- [ ] `/ralph demo` command that:
  - Spawns `loop-runner.ts` as a detached process
  - Tails `.ralph/test/events.jsonl`
  - On `tool_execution_end` events → `pi.sendMessage()` with a renderer that
    instantiates `ToolExecutionComponent` from pi's built-in components
  - On `message_end` events → `pi.sendMessage()` with a renderer that
    instantiates `AssistantMessageComponent`

**What this proves**: We can watch a background loop's output rendered with
native pi TUI components from a foreground pi session. The rendering looks
identical to a normal pi interaction.

**Success criteria**: Run `/ralph demo`, watch two iterations stream through
the TUI with proper tool call rendering and assistant message formatting, then
the loop exits. The whole thing should take ~30 minutes to build and validate
all core assumptions.

### Phase 1: Loop Runner (Core Engine)

The standalone Node.js script that manages the RPC process and iteration loop.
This is the foundation — everything else builds on it. It should be testable
independently (run it manually, check that state.json and events.jsonl are
written correctly).

- [ ] Scaffold the project structure (extension dir, loop runner script, types)
- [ ] Implement loop runner process management
  - Spawn `pi --mode rpc --no-session` as a child process
  - Handle process lifecycle (startup, crash detection, restart)
  - Store PID to `.ralph/<name>/pid`
  - Graceful shutdown on SIGTERM
- [ ] Implement the iteration loop
  - Read task file, build iteration prompt
  - Send `prompt` RPC command
  - Parse event stream from RPC stdout
  - Detect `agent_end` → send `new_session` → start next iteration
  - Respect max iteration limit
- [ ] Implement filesystem communication
  - Write all RPC events to `events.jsonl` (append-only)
  - Watch `inbox/` directory for command files (steer, followup, abort, stop)
  - Forward inbox commands to RPC stdin
  - Consume (delete) command files after forwarding
- [ ] Implement global process registry (`~/.ralph/registry/`)
  - One file per loop: `--<cwd-slugified>--<name>.json`
  - Mirrors pi's session directory naming convention
  - Register on startup (atomic write: tmp file + rename)
  - Deregister on clean shutdown (delete file)
  - Periodic heartbeat (update `lastSeen`, `iteration` in registry file)
  - No file locking needed — each loop owns its own file
- [ ] Implement state management
  - Write/update `state.json` after each iteration
  - Track: iteration count, status, start time, config
  - Detect completion signal from agent output (configurable marker)
- [ ] Implement per-iteration telemetry
  - Call `get_session_stats` before `new_session`
  - Write per-iteration stats to `iterations/NNN.json`
  - Aggregate cumulative stats in `state.json`
- [ ] Handle edge cases
  - RPC process crashes mid-iteration (detect, update state, optionally restart)
  - Disk full / write errors
  - Stale PID detection (process died without cleanup)

### Phase 2: Extension Shell (Commands + Lifecycle)

The pi extension that provides commands and manages loop lifecycle. No TUI
rendering yet — just spawning, stopping, and basic status.

- [ ] Extension skeleton (export default function, register commands)
- [ ] `/ralph start <name> [options]` command
  - Create `.ralph/<name>/` directory structure
  - Create default task.md (or accept a path to an existing file)
  - Spawn loop runner as detached process (`child_process.spawn` with
    `detached: true`, `stdio: 'ignore'`, `unref()`)
  - Pass through options: max iterations, model, provider, thinking level,
    reflect interval, extensions/skills to load in the RPC process
  - Auto-attach after start
- [ ] `/ralph stop [name]` command
  - Write `stop.json` to inbox
  - Update status display
  - If no name given, stop the currently attached loop
- [ ] `/ralph status [name]` command
  - Read state.json, show iteration/status/cost summary
  - If name given, show detailed stats for that loop
  - If no name, list all loops in `.ralph/`
- [ ] `/ralph list` command
  - Default: enumerate `.ralph/*/state.json` for current project
  - `--all`: read `~/.ralph/registry.json` to show loops across all projects
  - Show: name, cwd, status, iteration, cost, PID alive/dead
- [ ] `/ralph kill <name>` command
  - Send SIGTERM to the loop runner PID
  - Clean up state (mark as stopped)
  - For when stop.json isn't being consumed (process is stuck)
- [ ] `/ralph clean` command
  - Remove completed/stopped loop directories
  - Or archive them somewhere
- [ ] Process health checking
  - On extension load / session_start: scan `~/.ralph/registry.json`
  - Verify PIDs are alive, prune stale entries from registry
  - Also scan local `.ralph/` for loops not in registry (crashed without cleanup)
  - Notify user of running loops (current project) and orphaned loops
- [ ] Options/config to pass through to the RPC process
  - `--model`, `--provider`, `--thinking`
  - Extensions and skills to load in the background process
  - Reflect prompt and interval

### Phase 3: TUI — Event Rendering (Attached Mode)

Make the attached mode actually show what the loop is doing. This is the
most complex phase — translating RPC JSON events into pi's TUI.

- [ ] Implement event log tailing
  - Track read offset in `events.offset`
  - On attach: optionally replay recent events or start from current position
  - Tail with `fs.watch` or polling for new lines
- [ ] Implement event → TUI message rendering
  - Register message renderer via `pi.registerMessageRenderer("ralph", ...)`
  - Map RPC `message_update` events to streamed assistant text
  - Map RPC `tool_execution_*` events to tool call/result display
  - Map `agent_start`/`agent_end` to iteration boundaries
  - Handle thinking blocks, errors, retries, compaction events
- [ ] Implement the widget (above editor)
  - `ctx.ui.setWidget("ralph", ...)` with loop metadata
  - Update on: iteration change, status change, cost update
  - Show: name, iteration/max, status, elapsed time, cumulative cost
  - Clear widget on detach
- [ ] Implement status bar entry
  - `ctx.ui.setStatus("ralph", ...)` in the footer
  - Compact summary: "🔄 my-feature (7/50)"
- [ ] `/ralph attach <name>` command
  - Resolve name: check local `.ralph/<name>/` first, then global registry
  - This allows attaching to loops from other projects
  - Verify loop exists and PID is alive
  - Start tailing events (using `ralphDir` from registry if cross-project)
  - Install widget and status (show cwd in widget if cross-project)
  - Install custom editor (Phase 4)
  - If already attached to another loop, detach first
- [ ] `/ralph detach` command
  - Stop tailing events
  - Clear widget and status
  - Restore default editor
- [ ] Handle attach on session_start
  - If a loop was attached when pi last exited, offer to reattach
  - Store "last attached" in a local preference file

### Phase 4: TUI — Custom Editor (Steering)

Wire up the editor so typed messages route to the loop instead of the
foreground pi's agent.

- [ ] Implement custom editor class extending `CustomEditor`
  - Override `handleInput()` to intercept Enter and Alt+Enter
  - Enter → write `steer.json` to inbox
  - Alt+Enter → write `followup.json` to inbox
  - Show submitted message in TUI as a "sent" confirmation
  - Escape → write `abort.json` to inbox (abort current iteration)
  - All other keys → `super.handleInput(data)` for normal editing
- [ ] Install custom editor on attach, restore on detach
  - `ctx.ui.setEditorComponent(factory)` on attach
  - `ctx.ui.setEditorComponent(undefined)` on detach
- [ ] Editor placeholder/prompt
  - Show "Steering: <loop-name>" or similar in the editor border/placeholder
  - Distinguish steer vs follow-up mode visually (if possible)
- [ ] Handle edge case: message sent while between iterations
  - If agent isn't running (between `agent_end` and next `prompt`),
    a steer becomes a follow-up automatically (nothing to interrupt)

### Phase 5: Reflection + Task File Management

Add reflection iterations and task file lifecycle.

- [ ] Implement reflection scheduling in the loop runner
  - Every N iterations, prepend reflection instructions to the prompt
  - Configurable reflection prompt (default provided, user can override)
  - Track last reflection iteration in state
- [ ] Task file updates by the agent
  - The agent can update the task file during iterations (via write tool)
  - Loop runner re-reads task.md at the start of each iteration
  - This is the agent's "working memory" across iterations
- [ ] Task file templates
  - Provide a default template with Goals / Checklist / Notes sections
  - The agent's checklist progress persists across fresh-context iterations
  - `/ralph start` without an existing task file creates from template
- [ ] Completion detection
  - Configurable completion marker (default: some marker string in output)
  - Also: detect when all checklist items in task.md are checked
  - On completion: update state, stop loop, notify (if attached)

### Phase 6: SKILL.md + Agent Self-Start

Allow the agent to start loops on its own, like tmustier's `ralph_start` tool.

- [ ] Write SKILL.md for agent discoverability
  - When to use ralph loops (long-running, iterative, verifiable tasks)
  - How to structure a task file
  - How the iteration/reflection cycle works
- [ ] Register `ralph_start` tool
  - Agent can create a task file and start a loop programmatically
  - Parameters: name, task content, max iterations, items per iteration,
    reflect interval
  - Creates the directory structure, writes task.md, spawns loop runner
- [ ] Register `ralph_status` tool
  - Agent can check on running loops
  - Returns structured data about loop state
- [ ] Notify when a loop started by the agent completes
  - If the user is in a pi session, show a notification
  - Include summary: iterations completed, final status, cost

### Phase 7: Polish + Edge Cases

- [ ] Handle pi version mismatches between foreground and RPC process
- [ ] Handle multiple loops running simultaneously
  - Each in its own `.ralph/<name>/` directory
  - Can only be attached to one at a time
  - Status/list commands show all
- [ ] Log rotation / cleanup for events.jsonl (can get large)
  - Rotate after N iterations or N MB
  - Keep last N files for replay on attach
- [ ] Session persistence for the RPC process
  - Option to use `--session-dir` instead of `--no-session`
  - Enables resuming a crashed loop from where it left off
- [ ] Configuration
  - Default model/provider/thinking for loop processes
  - Default max iterations
  - Default reflect interval and prompt
  - Per-project vs global settings
- [ ] Error recovery
  - Loop runner auto-restarts RPC process on crash
  - Exponential backoff for repeated failures
  - Clear error reporting in state.json and attached TUI

## Stretch Goal: Worktree-Based Parallel Loops

Run multiple loops against different git worktrees from the same repo. This
enables the evaluation-style parallel runs from the prototype but with full
TUI attach/detach.

```bash
/ralph start my-feature --worktree feature-branch
# Creates a git worktree under .ralph/my-feature/worktree/
# The RPC process cwd is set to the worktree
# The loop works in an isolated copy of the repo
```

**How it works:**
- `/ralph start <name> --worktree <branch>` creates a git worktree at
  `.ralph/<name>/worktree/` (or a configurable location)
- The loop runner spawns `pi --mode rpc` with `cwd` set to the worktree
- The agent works in the worktree — file edits, git commits, etc. are isolated
- Multiple loops can run against different branches simultaneously
- `/ralph list` shows which worktree/branch each loop is targeting

**Registry entry for worktree loops:**
```json
{
  "pid": 12345,
  "cwd": "/home/josh/projects/myapp/.ralph/my-feature/worktree",
  "ralphDir": "/home/josh/projects/myapp/.ralph/my-feature",
  "name": "my-feature",
  "worktree": {
    "branch": "feature-branch",
    "path": "/home/josh/projects/myapp/.ralph/my-feature/worktree"
  }
}
```

**Cleanup:** `/ralph clean <name>` removes the worktree
(`git worktree remove`) after stopping the loop.

This is explicitly a stretch goal — the core loop/attach/detach design works
without it. But the filesystem layout and registry are designed to accommodate
it when the time comes.

## Decisions

- **Registry architecture**: One file per loop in `~/.ralph/registry/`, filename
  encodes cwd + loop name. No locking needed. Mirrors pi's session directory
  convention. Collisions impossible on disk.

- **Registry name resolution**: `/ralph attach refactor` when multiple projects
  have a loop named "refactor" — use `ctx.ui.select()` to show an interactive
  picker with project paths for disambiguation.

- **Extensions/skills in RPC process**: Pass through as CLI args when spawning
  `pi --mode rpc`. Already covered in Phase 2 options. User specifies via
  `/ralph start` options (e.g., `--extension ./my-ext.ts --skill my-skill`).

- **Reflect prompt authoring**: Separate files (`.ralph/<name>/reflect.md`),
  not inline in state.json. Easier to edit, version control, and swap out.
  Default provided, user can override per-loop.

## Open Questions

- **Streaming updates via registerMessageRenderer**: Pi exports the built-in
  TUI components and they accept the same data types as RPC events, so static
  rendering is solved (native fidelity). The remaining question is whether
  `registerMessageRenderer` supports re-rendering on message update for live
  streaming of tool output. If not, we may need to buffer events and render
  complete units, or use a widget for in-progress output that gets replaced
  by the final rendered message. Phase 3 investigation.

- **Events.jsonl size**: For long-running loops (50+ iterations), the event log
  could get very large. Need a rotation/truncation strategy that still allows
  attaching and seeing recent output. One option: rotate per-iteration (one
  JSONL file per iteration in `iterations/`), only tail the current one.

- **Agent-to-agent messaging**: If the user's foreground pi session has an
  agent running AND they're attached to a ralph loop, there's ambiguity about
  where typed messages go. Need a clear mode switch or visual indicator.
  Likely answer: attached mode fully takes over the editor, so there's no
  ambiguity. If you want to talk to your foreground agent, detach first.

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
full TUI integration and agent self-start (tmustier), plus the new
detach/attach capability via the RPC + filesystem architecture.
