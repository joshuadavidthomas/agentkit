---
name: jj-workspaces
description: "Use when running parallel agents, needing isolated working copies, using jj workspace commands, or setting up worktree-like directories in jj. Covers workspace add/forget/update-stale, assigning agents to workspaces, monitoring progress across workspaces, cleanup, stale working copies, and conflict mitigation. Triggers on: jj workspace, parallel agents, worktree, multiple working copies, concurrent agents, isolated working copy, workspace add, workspace forget, working_copies()."
---

# JJ Workspaces for Parallel Agents

JJ workspaces give each agent an isolated working copy backed by a single shared repo. Like git worktrees, but integrated with jj's revision model — each workspace has its own `@` while sharing all commits.

**Target version: jj 0.36+**

## What Workspaces Are

**Authority:** jj official docs (working-copy.md, glossary.md).

A workspace is a working copy directory plus a `.jj/` directory that links back to the main repo's storage. Each workspace:

- Has its own `@` (working-copy commit)
- Can check out a different commit than other workspaces
- Shares the full revision graph with all other workspaces
- Operates independently — changes in one don't touch another's files

The main repo is itself a workspace (named `default`). Additional workspaces are created as sibling directories.

## When to Use Workspaces

**Use workspaces when:**
- 3+ truly independent tasks can run simultaneously
- Tasks touch different files (no shared modifications)
- Time savings justify the setup and cleanup overhead

**Don't use workspaces when:**
- Tasks are sequential or have ordering dependencies
- Only 1–2 tasks (overhead exceeds benefit)
- Tasks modify the same files (conflicts defeat the purpose)
- Tasks are small enough to complete faster sequentially

**Authority:** ypares jj-todo-workflow (parallel-agents.md — decision criteria and setup workflow).

## Core Commands

| Command | Purpose |
|---------|---------|
| `jj workspace add <path> --name <name>` | Create a new workspace |
| `jj workspace forget <name>` | Unregister a workspace (commits preserved) |
| `jj workspace list` | Show all workspaces and their `@` commits |
| `jj workspace update-stale` | Refresh files after external modification |
| `jj workspace root --name <name>` | Print workspace root path |

**Authority:** jj official docs (working-copy.md — workspaces section).

## Setup Workflow

### 1. Create Workspaces

```bash
# From the main repo directory
jj workspace add ../ws-auth --name auth
jj workspace add ../ws-api --name api
jj workspace add ../ws-docs --name docs

# Verify all registered
jj workspace list
```

Workspace directories **must be siblings** of the main repo, not subdirectories. Subdirectories would be tracked by jj.

### 2. Create Task Commits

```bash
# Create commits for agents to work on
jj new -m "feat: implement auth module" --no-edit
jj new -m "feat: implement API endpoints" --no-edit
jj new -m "docs: write API documentation" --no-edit
```

### 3. Assign Agents to Workspaces

Each agent needs instructions with **absolute paths** and a task change ID:

```
Working directory: /home/user/project-ws-auth
Task change-id: <change-id>

Before any work:
  cd /home/user/project-ws-auth
  jj edit <change-id>

After completing work:
  jj describe -m "feat: auth module complete"
  jj st
```

**Always use absolute paths.** Agents lose track of `cwd`. Relative paths break when an agent navigates during work.

### 4. Monitor Progress

```bash
# See all workspace working copies
jj log -r 'working_copies()'

# Check a specific workspace's commit
jj log -r 'auth@'

# Full status from a workspace
cd /home/user/project-ws-auth && jj st
```

### 5. Integrate Results

```bash
# Merge all task branches
jj new <auth-id> <api-id> <docs-id> -m "integrate: combine all features"

# Check for conflicts
jj st
```

### 6. Clean Up

```bash
# Unregister workspaces (commits stay in repo)
jj workspace forget auth
jj workspace forget api
jj workspace forget docs

# Delete workspace directories
rm -rf ../ws-auth ../ws-api ../ws-docs
```

Forgetting a workspace never loses commits. It only removes the working-copy association.

## Agent Instruction Template

Copy and adapt for each agent:

```
You are working in an isolated JJ workspace.

Workspace: /absolute/path/to/workspace
Task: <change-id> — <description>

Setup:
  cd /absolute/path/to/workspace
  jj edit <change-id>

Rules:
- All commands must run inside your workspace directory
- Use absolute paths for all file references
- Run `jj st` after every mutation to verify state
- Do NOT modify files outside your workspace
- Use `-m` for all messages (no interactive editors)

When done:
  jj describe -m "feat: <summary of completed work>"
  jj st
```

## Stale Working Copies

**Authority:** jj official docs (working-copy.md — stale working copy section).

A workspace becomes stale when its `@` commit is modified from another workspace. This is normal in multi-workspace setups. Symptoms: `jj st` warns about stale working copy.

**Fix:** Run `jj workspace update-stale` from the affected workspace.

If the operation was lost (e.g., `jj op abandon`), the update creates a recovery commit preserving whatever was on disk.

## Conflict Mitigation

Even with separate workspaces, conflicts can arise:

| Source | Prevention |
|--------|-----------|
| Build outputs | Ensure `.gitignore` covers `__pycache__/`, `node_modules/`, `target/`, etc. |
| Shared config files | Assign one agent to own shared files; others work around them |
| Lock files | Have only one task add dependencies, or resolve in integration step |
| Same source files | Redesign task boundaries so agents touch different files |

If conflicts do occur at integration, they're normal jj conflicts — edit the markers in the merge commit and verify with `jj st`.

## Revset Expressions for Workspaces

```bash
# All workspace working copies
jj log -r 'working_copies()'

# A specific workspace's working copy
jj log -r 'auth@'

# Current workspace's working copy
jj log -r '@'
```

See **jj-revsets** for the full revset language.

## Common Mistakes

- **Creating workspaces as subdirectories.** Use sibling directories (`../ws-name`), not child directories (`./ws-name`). Child directories get tracked by jj.

- **Using relative paths in agent instructions.** Agents navigate during work. Relative paths break. Always provide absolute paths.

- **Forgetting to `jj edit` the task commit.** Without this, the agent works on the default `@` in the new workspace, not the intended task. Always `jj edit <change-id>` first.

- **Panicking when "workspace stale" appears.** This is expected when commits are modified cross-workspace. Run `jj workspace update-stale`.

- **Thinking `forget` deletes work.** `jj workspace forget` only unregisters the workspace. All commits remain in the repo.

- **Not cleaning up workspace directories.** `jj workspace forget` doesn't delete files. Remove the directories manually afterward.

## References

- [references/parallel-agents.md](references/parallel-agents.md) — Complete parallel agent setup guide with detailed workflow, decision checklist, troubleshooting table, and agent instruction templates
