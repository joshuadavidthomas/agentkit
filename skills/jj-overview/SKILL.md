---
name: jj-overview
description: "Start here for Jujutsu (jj) — the Git-compatible version control system. Use when performing any VCS operations in a jj repo (.jj/ directory), when asked about jj, or when Git commands are attempted in a jj-managed project. Triggers on: jj, jujutsu, commit, push, pull, branch, bookmark, rebase, squash, merge, diff, log, status, working copy, change ID, .jj/ directory, detached HEAD in a colocated repo."
---

# Jujutsu (jj) Version Control

Jujutsu is a Git-compatible VCS with mutable commits, automatic change tracking, and an operation log that makes every action undoable. This skill covers the mental model, agent-specific rules, and daily workflow.

**Target version: jj 0.36+**

## Mental Model

**Authority:** jj official docs (working-copy.md, glossary.md). steveklabnik jujutsu-tutorial.

**The working copy is a commit.** There is no staging area. Every file change is automatically snapshotted into the working-copy commit (`@`) when you run any `jj` command. Instead of "stage → commit," just code and describe.

**Change IDs are stable. Commit IDs are not.** Every commit has two identifiers:
- **Change ID** — Stable across rewrites. Letters k–z (e.g., `tqpwlqmp`). Displayed first in `jj log`. Prefer these in commands.
- **Commit ID** — Content hash that changes on any rewrite. Hex digits (e.g., `3ccf7581`). This is the Git commit ID in colocated repos.

**History is mutable.** Commits can be freely rewritten. Descendants are automatically rebased. Old versions stay accessible in the operation log and by commit ID.

**Bookmarks are not branches.** Bookmarks (jj's equivalent of Git branches) don't advance when new commits are created. They follow rewrites automatically but must be explicitly set before pushing. See **jj-sharing** for details.

**Conflicts don't block.** jj allows committing conflicted files. Resolve at your convenience by editing the conflict markers directly, then verify with `jj st`.

## Agent Rules

These rules are non-negotiable when operating as an automated agent:

1. **Always use `-m` for messages.** Never invoke a command that opens an editor. Commands that need `-m`: `jj new`, `jj describe`, `jj commit`, `jj squash`.

2. **Never use interactive commands.** `jj split` (without file paths), `jj squash -i`, and `jj resolve` open interactive UIs that hang. Use file-path arguments or `jj restore` workflows instead. See [references/command-gotchas.md](references/command-gotchas.md) for alternatives.

3. **Verify after mutations.** Run `jj st` after `squash`, `abandon`, `rebase`, `restore`, or any destructive operation to confirm it worked.

4. **Use change IDs, not commit IDs.** Change IDs survive rewrites. Commit IDs become stale instantly.

5. **Quote revsets.** Always single-quote revset expressions to prevent shell interpretation: `jj log -r 'mine() & ::@'`.

**Authority:** jujutsu-skill (agent environment section). jj-workflow (AI workflow patterns). ypares working-with-jj.

### Agent-Specific Configuration

For dedicated agent environments, use `JJ_CONFIG` to point at an agent-specific config file that prevents editor hangs and uses git-style diffs:

**Authority:** ypares agent-skills (JJ_CONFIG pattern, .agent-space/jj-config.toml).

```toml
# agent-jj-config.toml
[user]
name = "Agent"
email = "agent@example.com"

[ui]
editor = "TRIED_TO_RUN_AN_INTERACTIVE_EDITOR"
diff-formatter = ":git"
```

Launch with: `JJ_CONFIG=/path/to/agent-jj-config.toml <agent-harness>`

See **jj-config** for full configuration details.

## Core Workflow

The daily loop: **describe → code → new → repeat.**

```bash
# 1. Describe intent (if working copy has no description yet)
jj describe -m "feat: add user validation"

# 2. Make changes — auto-tracked, no `add` needed

# 3. Verify
jj st
jj diff

# 4. Start next task
jj new -m "feat: add error handling"
```

### Checkpointing Before Risky Changes

```bash
jj describe -m "checkpoint: stable state before refactor"
jj new -m "refactor: extract validation logic"
# If it goes wrong:
jj undo
```

### Curating History

```bash
# Squash working copy into parent
jj squash -m "feat: final clean message"

# Absorb hunks into the right ancestor commits automatically
jj absorb

# Abandon a failed experiment
jj abandon @
```

### Non-Linear Work

The linear loop above assumes each task builds on the last. When you need to start unrelated work — a bugfix, a tangential change, something that shouldn't depend on your half-done feature — branch off from a stable point instead of stacking on `@`.

**Authority:** steveklabnik jujutsu-tutorial (anonymous-branches chapter, simultaneous-edits chapter).

**Starting unrelated work from an earlier change:**

```bash
# You're midway through a feature on @. A bugfix needs to happen,
# but it shouldn't sit on top of your WIP.

# Create a sibling commit from trunk (doesn't move @)
jj new trunk() --no-edit -m "fix: correct timezone handling"

# Switch to the new commit to work on it
jj edit <bugfix-change-id>

# ... fix the bug ...
jj st
```

The bugfix now lives as an independent line from trunk, not as a child of your feature work.

**Returning to original work:**

```bash
# Find your branches
jj log -r 'heads(trunk()..)'

# Resume editing the feature commit directly
jj edit <feature-change-id>

# Or start a new commit on top of the feature
jj new <feature-change-id> -m "feat: continue with validation"
```

Use `jj edit` to amend an existing commit in place. Use `jj new` to add a new commit on top of it.

**Reconciling parallel lines when both are done:**

```bash
# Option A: Keep independent — push as separate PRs (most common)
jj bookmark create fix-timezone -r <bugfix-id>
jj bookmark create feat-validation -r <feature-id>
jj git push -b fix-timezone -b feat-validation

# Option B: Stack one on the other if there's a real dependency
jj rebase -s <feature-id> -o <bugfix-id>
```

See **jj-sharing** for the full PR workflow including independent parallel PRs. See **jj-history** for rebase details.

**Agent rule: choose the right parent.** When working through a plan or spec, don't always build on `@`. Before creating a new commit, ask whether the next piece of work depends on the current commit chain. If it doesn't — different feature area, unrelated fix, tangential cleanup — branch off trunk or the appropriate earlier commit. Flag the divergence to the user rather than silently adapting the plan's commit structure.

## Essential Commands

| Task | Command |
|------|---------|
| Check status | `jj st` |
| View diff | `jj diff` |
| View log | `jj log` |
| Describe current commit | `jj describe -m "message"` |
| Start new work | `jj new -m "task description"` |
| Edit an older commit | `jj edit <change-id>` |
| Show a specific commit | `jj show <change-id>` |
| Squash into parent | `jj squash` |
| Auto-distribute changes | `jj absorb` |
| Abandon a commit | `jj abandon <change-id>` |
| Undo last operation | `jj undo` |
| View operation history | `jj op log` |
| Restore to earlier state | `jj op restore <op-id>` |
| Restore files from parent | `jj restore [paths]` |
| Create bookmark | `jj bookmark create <name> -r @` |
| Move bookmark | `jj bookmark set <name> -r @` |
| Push to remote | `jj git push -b <bookmark>` |
| Fetch from remote | `jj git fetch` |

For Git-to-jj translations, see [references/git-to-jj.md](references/git-to-jj.md).

## Recovery

jj's operation log makes almost any mistake reversible.

**Authority:** jj official docs (git-experts.md — operation log section).

```bash
# Undo the last operation
jj undo

# See full operation history
jj op log

# Restore entire repo to a specific past state
jj op restore <op-id>

# See how a specific change evolved over time
jj evolog -r <change-id>
```

`jj undo` can be repeated to keep stepping backward. `jj op restore` jumps directly to any point.

## Detecting a jj Repo

A `.jj/` directory indicates a jj-managed repository. In colocated repos, both `.jj/` and `.git/` exist. When you see `.jj/`:

- **Use `jj` commands**, not `git`, for all VCS operations
- Git commands in a colocated repo can work but may cause unexpected state — prefer `jj`
- If Git shows "detached HEAD," this is normal in colocated repos; use `jj log` to see the real state

## Routing to Specialized Skills

| I need to... | Load |
|--------------|------|
| Write revset, fileset, or template expressions | **jj-revsets** |
| Push, pull, manage bookmarks, or work with GitHub | **jj-sharing** |
| Split, rebase, squash, or resolve conflicts | **jj-history** |
| Run parallel agents with isolated working copies | **jj-workspaces** |
| Configure jj, set up aliases, or customize diffs | **jj-config** |

## References

- [references/git-to-jj.md](references/git-to-jj.md) — Git-to-jj command mapping table
- [references/git-experts.md](references/git-experts.md) — Why jj improves on Git for power users
- [references/command-gotchas.md](references/command-gotchas.md) — Flag semantics, quoting, deprecated flags, version-specific changes
