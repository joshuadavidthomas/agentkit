---
name: jj-sharing
description: "Jujutsu (jj) sharing and collaboration — bookmarks, remotes, pushing, pulling, and GitHub/GitLab workflows. Use when pushing commits, pulling changes, creating or updating PRs, managing bookmarks (jj's branches), working with remotes, force-pushing, fetching, tracking remote bookmarks, configuring auto-track, or working in colocated repos. Triggers on: jj git push, jj git fetch, jj bookmark, bookmark set, bookmark create, bookmark track, push -c, push -b, pull request, PR, force push, remote, origin, upstream, colocated, stacked PRs, git interop."
---

# Sharing and Collaboration

Bookmarks, remotes, and GitHub/GitLab workflows for pushing and pulling code with jj. This skill covers the agent-safe patterns for sharing commits with others.

**Target version: jj 0.36+**

For full references, see:
- [references/bookmarks.md](references/bookmarks.md) — Complete bookmarks reference
- [references/github.md](references/github.md) — GitHub/GitLab workflow details
- [references/git-compatibility.md](references/git-compatibility.md) — Git interop and colocated workspaces

## Bookmarks (jj's Branches)

**Authority:** jj official docs (bookmarks.md). steveklabnik jujutsu-tutorial (named-branches chapter).

Bookmarks are named pointers to revisions — jj's equivalent of Git branches. The critical difference:

**Bookmarks do NOT auto-advance.** When you create a new commit, `@` moves but bookmarks stay where they are. You must explicitly move them before pushing. This is the #1 gotcha for Git users.

```bash
# Create a bookmark at the current commit
jj bookmark create my-feature -r @

# Move an existing bookmark to the current commit
jj bookmark set my-feature -r @

# List bookmarks (* = differs from remote)
jj bookmark list

# Delete a bookmark
jj bookmark delete my-feature
```

**Shorthand:** `jj b` is an alias for `jj bookmark`. Subcommands have single-letter shortcuts too: `jj b c` = `jj bookmark create`, `jj b s` = `jj bookmark set`.

### When Bookmarks Move Automatically

Bookmarks follow **rewrites**, not new commits:

- `jj rebase` moves bookmarks on rebased commits ✓
- `jj squash` moves bookmarks when commits are squashed ✓
- `jj abandon` deletes bookmarks on abandoned commits ✓
- `jj new` does NOT move bookmarks to the new commit ✗
- `jj commit` does NOT move bookmarks to the new commit ✗

**Authority:** jj official docs (bookmarks.md — bookmark updates section).

## Pushing Changes

**Authority:** jj official docs (bookmarks.md, github.md). jj-workflow (push patterns). jujutsu-skill (push workflow).

### The Push Pattern

Always: **set bookmark → push.** Every push needs a bookmark pointing at the commit you want to push.

```bash
# 1. Ensure your work is described
jj describe -m "feat: add user validation"

# 2. Create or move a bookmark to the commit you want to push
jj bookmark set my-feature -r @    # if bookmark exists
jj bookmark create my-feature -r @  # if it doesn't

# 3. Push
jj git push -b my-feature
```

### Quick Push with Auto-Named Bookmark

For one-off PRs, let jj generate a bookmark name from the change ID:

```bash
# Push @, auto-creating a bookmark like "push-vmunwxsksqvk"
jj git push -c @

# Push a specific change
jj git push -c <change-id>
```

**Note:** `-c` / `--change` creates the bookmark on the commit itself. If the working copy is empty (common after `jj commit`), push `@-` instead:

```bash
jj git push -c @-
```

**Authority:** jj official docs (github.md — using a generated bookmark name). steveklabnik jujutsu-tutorial (remotes chapter).

### Push Flags

| Flag | What it pushes |
|------|---------------|
| `-b <name>` / `--bookmark <name>` | Named bookmark |
| `-c <rev>` / `--change <rev>` | Auto-creates bookmark from change ID |
| `--all` | All bookmarks with remote changes |
| `--tracked` | All tracked bookmarks |
| `--deleted` | Pushes bookmark deletions to remote |
| `--dry-run` | Show what would be pushed without doing it |

### Push Safety

jj's push is safe by default — equivalent to `git push --force-with-lease`:

- If the remote has been updated since your last fetch, push is rejected
- If a local bookmark is conflicted, push is rejected
- Resolution: `jj git fetch`, resolve any bookmark conflicts, then retry

**Authority:** jj official docs (bookmarks.md — pushing bookmarks safety checks).

## Fetching Changes

```bash
# Fetch from default remote
jj git fetch

# Fetch from a specific remote
jj git fetch --remote upstream
```

After fetching, **tracked** remote bookmarks automatically update their local counterparts. If both local and remote moved, jj merges them (or creates a bookmark conflict if they diverged).

There is no `jj git pull`. Instead:

```bash
# Fetch + rebase your work onto updated trunk
jj git fetch
jj rebase -o trunk()
```

**Authority:** jj official docs (github.md — updating the repository).

### Tracking Remote Bookmarks

By default, `jj git clone` tracks only the default branch (e.g., `main@origin`). Other remote bookmarks exist but aren't tracked — they won't create or update local bookmarks on fetch.

```bash
# Track a remote bookmark
jj bookmark track my-feature --remote origin

# Untrack a remote bookmark
jj bookmark untrack my-feature --remote origin

# List tracked bookmarks
jj bookmark list --tracked

# List ALL bookmarks (including untracked remotes)
jj bookmark list --all
```

### Auto-Tracking Configuration

To automatically track all new remote bookmarks (like Git's default behavior):

```bash
jj config set --user 'remotes.origin.auto-track-bookmarks' 'glob:*'
```

Or in config file:

```toml
[remotes.origin]
auto-track-bookmarks = "glob:*"
```

This only affects **newly fetched** bookmarks. Existing untracked bookmarks need manual `jj bookmark track`.

**Authority:** jj official docs (bookmarks.md — automatic tracking). jj-workflow (auto-track tip).

## Feature Branch / PR Workflow

### Creating a PR

```bash
# Start work from trunk
jj new trunk() -m "feat: add search endpoint"

# ... make changes ...

# Option A: Named bookmark (recommended for ongoing work)
jj bookmark create feat-search -r @
jj git push -b feat-search

# Option B: Auto-named bookmark (quick one-off)
jj git push -c @
```

### Updating a PR (Adding Commits)

```bash
# Create new commit on top of the PR branch
jj new feat-search -m "address review feedback"

# ... make changes ...

# Move bookmark to include the new commit
jj bookmark set feat-search -r @
jj git push -b feat-search
```

### Updating a PR (Rewriting Commits)

```bash
# Edit the original commit directly
jj edit <change-id>

# ... make changes (they amend the commit in place) ...

# jj automatically rebases descendants
# Push — jj handles the force-push automatically
jj git push -b feat-search
```

**Authority:** jj official docs (github.md — addressing review comments). steveklabnik jujutsu-tutorial (updating-prs chapter).

### Syncing with Upstream

```bash
# Fetch latest changes
jj git fetch

# Rebase your feature stack onto updated trunk
jj rebase -b feat-search -o trunk()
```

## Stacked PRs

For a chain of dependent changes, create separate bookmarks for each:

```bash
# First PR
jj new trunk() -m "refactor: extract validation"
# ... work ...
jj bookmark create pr-1-refactor -r @

# Second PR (depends on first)
jj new -m "feat: add input validation using extracted module"
# ... work ...
jj bookmark create pr-2-feature -r @

# Push both
jj git push -b pr-1-refactor -b pr-2-feature
```

When the first PR is updated, jj automatically rebases the second. Move bookmarks as needed and push again.

## Working with Multiple Remotes

Common setup: `upstream` is the shared repo, `origin` is your fork.

```bash
# Clone from upstream
jj git clone --remote upstream https://github.com/org/repo
cd repo

# Add your fork
jj git remote add origin git@github.com:you/repo.git

# Configure: fetch from upstream, push to origin
```

In config:

```toml
[git]
fetch = "upstream"
push = "origin"
```

To fetch from both remotes (keeping your own bookmarks synced):

```toml
[git]
fetch = ["upstream", "origin"]
push = "origin"
```

**Authority:** jj official docs (github.md — using several remotes).

## Colocated Repos

**Authority:** jj official docs (git-compatibility.md — colocated workspaces).

A colocated repo has both `.jj/` and `.git/` in the same directory. This is the default when using `jj git init` or `jj git clone`.

### Advantages

- Git tools (CI, IDEs, GitHub CLI) work alongside jj
- `jj` and `git` commands can be interleaved (with care)
- Every `jj` command auto-syncs with Git's view

### Gotchas

- Git shows "detached HEAD" — this is **normal**, not an error
- Interleaving `jj` and `git` mutating commands can cause bookmark conflicts or divergent change IDs
- IDE background `git fetch` can cause unexpected state — prefer running `jj git fetch` explicitly
- Git tools won't understand jj's conflict representation

### When to Use Git Directly

In a colocated repo, prefer `jj` for everything. Use `git` only for:
- Operations jj doesn't support (e.g., submodules, LFS, annotated tags)
- Tools that require Git (some CI systems, pre-commit hooks)
- Read-only Git commands (`git log --graph` for a different view)

### Colocation Management

```bash
# Check colocation status
jj git colocation status

# Convert to colocated
jj git colocation enable

# Convert to non-colocated
jj git colocation disable
```

## Using GitHub CLI

In non-colocated repos, `gh` can't find the Git directory. Fix with:

```bash
GIT_DIR=.jj/repo/store/git gh issue list
```

Or automate with a `.envrc` file (requires [direnv](https://direnv.net)):

```bash
export GIT_DIR=$PWD/.jj/repo/store/git
```

**Authority:** jj official docs (github.md — using GitHub CLI).

## Common Mistakes

- **Forgetting to move the bookmark before pushing.** `jj bookmark set <name> -r @` before `jj git push -b <name>`. This is the most common jj sharing mistake.
- **Pushing the empty working copy.** After `jj commit`, `@` is empty. Push `@-` instead: `jj git push -c @-`.
- **Using `jj bookmark move` when `set` is simpler.** `jj bookmark set <name> -r @` is the straightforward way to point a bookmark at a commit. `move` requires `--from`/`--to` flags.
- **Not fetching before pushing.** If the remote changed, push will be rejected. Always `jj git fetch` first if others may have pushed.
- **Expecting auto-tracking.** By default, only `main@origin` (or similar) is tracked after clone. Other remote bookmarks need manual `jj bookmark track` or the `auto-track-bookmarks` config.
- **Running `git push` in a colocated repo.** Use `jj git push` — it handles bookmark state correctly. Raw `git push` can desync jj's bookmark tracking.

## Agent Checklist

Before any push operation:

1. ☐ Verify the commit to push has a description: `jj log -r @`
2. ☐ Ensure a bookmark points at it: `jj bookmark list`
3. ☐ If not, create or set one: `jj bookmark set <name> -r @`
4. ☐ Check for conflicts: `jj st`
5. ☐ Push: `jj git push -b <name>`
6. ☐ Verify after push: `jj bookmark list` (no `*` on the pushed bookmark)

## Cross-References

| I need to... | Load |
|--------------|------|
| Understand the mental model, daily workflow, or agent rules | **jj-overview** |
| Write revset, fileset, or template expressions | **jj-revsets** |
| Split, rebase, squash, or resolve conflicts | **jj-history** |
| Run parallel agents with isolated working copies | **jj-workspaces** |
| Configure jj, set up aliases, or customize diffs | **jj-config** |
