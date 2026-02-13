# Jujutsu (jj) Skill Plan

Plan for a family of jj skills following the same patterns as the existing `rust-*` and `salsa-*` skill families.

## How to Use This Plan

Before writing any skill, load these two skills for guidance:

1. **`skill-authoring`** (`skills/skill-authoring/SKILL.md`) — Covers SKILL.md structure, frontmatter, description optimization, and how agents discover skills. Read this first.
2. **`writing-cli-skills`** (`skills/writing-cli-skills/SKILL.md`) — Covers writing skills that wrap CLI tools. Sections, line limits, description trigger phrases, and the checklist to review against.

Use these existing skills as concrete examples of good structure:

| Example skill | Why it's a good model |
|--------------|----------------------|
| `skills/salsa-overview/SKILL.md` | Gateway skill that routes to specialists — model for `jj-overview` |
| `skills/rust-async/SKILL.md` | ~360 lines, references/ dir, clean sections — model for `jj-revsets` and `jj-history` |
| `skills/rust-ownership/SKILL.md` | Error-code triggers in description, decision trees — model for `jj-sharing` |
| `skills/salsa-cancellation/SKILL.md` | Focused topic with real-world patterns in references/ — model for `jj-workspaces` |
| `skills/rust-project-structure/SKILL.md` | ~210 lines, concise config-oriented — model for `jj-config` |

## Progress

| # | Skill | SKILL.md | README.md | References | Status |
|---|-------|----------|-----------|------------|--------|
| 1 | `jj-overview` | `skills/jj-overview/SKILL.md` | `skills/jj-overview/README.md` | `git-to-jj.md`, `git-experts.md`, `command-gotchas.md` | written |
| 2 | `jj-revsets` | `skills/jj-revsets/SKILL.md` | `skills/jj-revsets/README.md` | `revsets.md`, `templates.md`, `filesets.md` | todo |
| 3 | `jj-sharing` | `skills/jj-sharing/SKILL.md` | `skills/jj-sharing/README.md` | `bookmarks.md`, `github.md`, `git-compatibility.md` | todo |
| 4 | `jj-history` | `skills/jj-history/SKILL.md` | `skills/jj-history/README.md` | `conflicts.md`, `divergence.md` | todo |
| 5 | `jj-workspaces` | `skills/jj-workspaces/SKILL.md` | `skills/jj-workspaces/README.md` | `parallel-agents.md` | todo |
| 6 | `jj-config` | `skills/jj-config/SKILL.md` | `skills/jj-config/README.md` | `config.md` | todo |

Statuses: **todo** → **written** → **reviewed**

A skill isn't **written** until all three exist: SKILL.md, README.md (with attribution), and reference files.

## Source Material

Primary references live in `reference/`:

| Directory | What it is |
|-----------|-----------|
| `reference/jj-vcs/` | **Canonical jj repo** clone — authoritative source for official docs |
| `reference/jujutsu-skill/` | Monolithic agent skill — good agent-specific patterns |
| `reference/jj-workflow/` | Concise AI-focused workflow skill |
| `reference/sgai-using-jj/` | Git→jj command mapping table |
| `reference/ypares-agent-skills/working-with-jj/` | Version-aware (0.36.x) skill with scripts and references |
| `reference/ypares-agent-skills/jj-todo-workflow/` | TODO-as-commits workflow, includes parallel-agents.md |
| `reference/coobaha-jj/` | Compact skill with good anti-patterns section |
| `reference/edmundmiller-jj-skills/` | History investigation and commit splitting |
| `reference/katies-ai-skills/skills/jj-vcs/` | Older snapshot of jj docs (superseded by canonical clone) |
| `reference/steveklabnik-jj-tutorial/` | Narrative tutorial — mental model and conceptual grounding |

## Design Principles

Drawn from how the existing skill families work:

1. **Gateway skill routes to specialists** — `jj-overview` is the entry point, like `salsa-overview`
2. **One concern per skill** — each skill is 150–300 lines, focused on a single topic
3. **References for depth** — detailed docs go in `references/` files, keeping SKILL.md lean
4. **Descriptions are trigger-oriented** — "Use when..." with the words users actually say
5. **Agent-first** — every skill assumes non-interactive execution (no editors, always `-m`)
6. **Version-aware** — target jj 0.36+ syntax (`-o` not `-d`, stricter symbol resolution, glob filesets)

## Skill Inventory

Six skills total:

| Skill | Lines (est.) | Trigger | Purpose |
|-------|-------------|---------|---------|
| `jj-overview` | ~200 | Any jj/jujutsu mention, VCS ops in a jj repo | Mental model, daily workflow, routes to other skills |
| `jj-revsets` | ~250 | Writing revset/fileset/template expressions | The three DSLs: revsets, filesets, templates |
| `jj-sharing` | ~250 | Push, pull, PRs, bookmarks, branches, GitHub | Bookmarks, remotes, GitHub workflows |
| `jj-history` | ~300 | Splitting, rebasing, squashing, conflict resolution | History rewriting and investigation |
| `jj-workspaces` | ~200 | Parallel agents, worktrees, isolated working copies | Workspaces for agentic parallel execution |
| `jj-config` | ~150 | Configuring jj, aliases, diff tools | Configuration and customization |

## Skill Details

### 1. `jj-overview`

The gateway. Always loads first for any jj interaction.

**SKILL.md covers:**
- Mental model (working copy is a commit, no staging area, change IDs vs commit IDs, mutable history)
- Agent rules (always `-m`, never interactive commands, verify with `jj st`, use `JJ_CONFIG` for agent-specific config — see `jj-config` for details)
- Core daily workflow: describe → code → `jj new` → repeat
- Essential commands table (the 80% case)
- Recovery basics (`jj undo`, `jj op log`, `jj op restore`)
- Routing: "For revsets see jj-revsets, for pushing see jj-sharing" etc.

**References:**
- `references/git-to-jj.md` — Git-to-jj command mapping table
- `references/git-experts.md` — Why jj is better for git power users (absorb, operation log, evolog, colocation)
- `references/command-gotchas.md` — `-r` vs `-s` vs `-f` vs `-o` semantics, quoting rules, symbol strictness, glob defaults, deprecated flags

**Primary sources:** jujutsu-skill, jj-workflow, ypares/working-with-jj, steveklabnik intro chapters, **canonical** docs/git-experts.md, **canonical** guides/cli-revision-options.md

### 2. `jj-revsets`

Loads when working with jj's query languages.

**SKILL.md covers:**
- Revset syntax and operators (`::@`, `@::`, `|`, `&`, `~`, `parents()`, `ancestors()`)
- Common patterns: `mine()`, `conflicted()`, `empty()`, `bookmarks()`, `description()`
- Quoting rules and `substring:` / `substring-i:` / `glob:` matchers
- Fileset basics (glob by default in 0.36+, `cwd:` prefix for literals)
- Template basics (customizing `jj log` output with `-T`)
- Useful aliases to put in config

**References:**
- `references/revsets.md` — Full revset language reference (from official docs)
- `references/templates.md` — Full template language reference (from official docs)
- `references/filesets.md` — Fileset language reference (from official docs)

**Primary sources:** **canonical** docs (revsets.md, templates.md, filesets.md), ypares revset section, coobaha anti-patterns

### 3. `jj-sharing`

Loads when interacting with remotes or collaborators.

**SKILL.md covers:**
- Bookmarks vs git branches — create, set, move, delete, track
- Key gotcha: bookmarks don't auto-advance, must `jj bookmark set` before pushing
- Push workflow: create/move bookmark → `jj git push -b <name>`
- Feature branch / PR workflow (create, update, force-push)
- Stacked PRs pattern
- Fetching and tracking remote bookmarks (`jj bookmark track <name>@<remote>`)
- Colocated repos (`.jj` + `.git` coexistence, when to use git directly)
- Auto-track config for remotes

**References:**
- `references/bookmarks.md` — Full bookmarks reference (from official docs)
- `references/github.md` — GitHub workflow details (from official docs)
- `references/git-compatibility.md` — Git interop details (from official docs)

**Primary sources:** **canonical** docs (bookmarks.md, github.md, git-compatibility.md), jujutsu-skill push section, jj-workflow push section, steveklabnik sharing-code chapters

### 4. `jj-history`

Loads when rewriting or investigating history.

**SKILL.md covers:**
- Squash (`jj squash`), absorb (`jj absorb`), rebase patterns
- Splitting commits: agent-safe approach using `jj restore` to move changes out (since `jj split` is interactive); note that `jj split -r <rev> <paths>` with explicit paths can work non-interactively
- Handling immutability (`--ignore-immutable`, when it's safe)
- Conflict resolution: edit markers directly in files, `jj squash` to fold resolution into parent
- Investigating history: `jj show`, `jj file annotate`, `jj evolog`, `jj diff -r`
- Abandoning commits, cleaning up empties
- Verification checklist after major rewrites

**References:**
- `references/conflicts.md` — Conflict handling details (from official docs)
- `references/divergence.md` — Divergent changes guide (from official docs)

**Primary sources:** edmundmiller/jj-history-investigation, ypares split/rebase sections, **canonical** docs (conflicts.md, guides/divergence.md), steveklabnik conflict chapter

### 5. `jj-workspaces`

Loads when running parallel agents or needing isolated working copies.

**SKILL.md covers:**
- What workspaces are (like git worktrees — isolated `@` per workspace, shared revisions)
- The problem they solve: multiple agents fighting over a single `@`
- When to use them (3+ independent parallel tasks, no shared files) vs when not to (sequential work, likely conflicts)
- Setup workflow: create workspace, assign agent, cleanup
- Agent instruction template (absolute paths, `cd` to workspace, `jj edit <task-id>`)
- Monitoring progress across workspaces
- Cleanup: `jj workspace forget`, remove directories
- Conflict risk and mitigation (`.gitignore` generated files, design tasks for different files)
- Troubleshooting common workspace issues

**References:**
- `references/parallel-agents.md` — Full parallel agent setup guide with examples

**Primary sources:** ypares/jj-todo-workflow/references/parallel-agents.md, steveklabnik workspaces section (conceptual)

**Note:** This skill focuses on the *agentic* use case for workspaces. Human-oriented workspace usage (e.g., "I want to look at main while working on a feature") is covered lightly but isn't the focus.

### 6. `jj-config`

Loads when configuring jj.

**SKILL.md covers:**
- Config file locations and precedence (`--user` vs `--repo`)
- **Agent-specific config** — dedicated `jj-config.toml` for agents, launched via `JJ_CONFIG=/path/to/agent-jj-config.toml <agent-harness>`. This ensures agents see git-style diffs (`:git` formatter instead of color-words), use standard log templates, and get a clear error instead of hanging when an editor is invoked. Example config:
  ```toml
  [user]
  name = "Agent"
  email = "agent@example.com"

  [ui]
  editor = "TRIED_TO_RUN_AN_INTERACTIVE_EDITOR"
  diff-formatter = ":git"
  ```
- Useful aliases (`recent`, `conflicts`, `empty`)
- Diff/merge tool configuration
- Auto-track settings for remotes
- Signing configuration
- Template customization pointers (detailed syntax in jj-revsets)

**References:**
- `references/config.md` — Full configuration reference (from official docs, ~2000 lines)

**Primary sources:** **canonical** docs (config.md), ypares aliases and agent config pattern (`JJ_CONFIG` env var, `.agent-space/jj-config.toml`), jj-workflow auto-track tip

## Reference Material Sourcing

The canonical jj repo (`reference/jj-vcs/`) is the primary source for official docs. It's consistently newer than katies' copy (which was a snapshot at some point). Three docs exist only in canonical: `git-experts.md`, `guides/cli-revision-options.md`, and `revsets.toml`.

Where each reference file comes from:

| Reference file | Source | Lines | Notes |
|---------------|--------|-------|-------|
| `jj-overview/references/git-to-jj.md` | sgai-using-jj SKILL.md (command table) | ~100 | Extract and clean up the mapping table |
| `jj-overview/references/git-experts.md` | **canonical** docs/git-experts.md | 110 | Why jj is better for git power users — absorb, undo, evolog |
| `jj-overview/references/command-gotchas.md` | ypares command-syntax.md + coobaha anti-patterns + **canonical** guides/cli-revision-options.md | ~200 | Merge flag gotchas, `-r`/`-s`/`-f`/`-o`/`-A`/`-B` semantics, quoting, deprecations |
| `jj-revsets/references/revsets.md` | **canonical** docs/revsets.md | 657 | Full revset language reference |
| `jj-revsets/references/templates.md` | **canonical** docs/templates.md | 762 | Full template language reference |
| `jj-revsets/references/filesets.md` | **canonical** docs/filesets.md | 97 | Fileset language reference |
| `jj-sharing/references/bookmarks.md` | **canonical** docs/bookmarks.md | 234 | Full bookmarks reference |
| `jj-sharing/references/github.md` | **canonical** docs/github.md | 287 | GitHub workflow details |
| `jj-sharing/references/git-compatibility.md` | **canonical** docs/git-compatibility.md | 249 | Git interop details |
| `jj-history/references/conflicts.md` | **canonical** docs/conflicts.md | 223 | Conflict handling details |
| `jj-history/references/divergence.md` | **canonical** docs/guides/divergence.md | 108 | Divergent changes guide |
| `jj-workspaces/references/parallel-agents.md` | ypares jj-todo-workflow/references/parallel-agents.md | ~200 | Adapt and clean up for agentic use |
| `jj-config/references/config.md` | **canonical** docs/config.md | 2111 | Full config reference |

## Attribution and Citing Sources

Each skill must acknowledge its sources in two places, following the pattern established by existing skills like `rust-async` and `salsa-overview`.

### 1. README.md — Full attribution

Every skill directory gets a `README.md` with an "Attribution & License" section. This is the human-readable record of where content came from. Format follows the existing pattern:

```markdown
# jj-overview

One-paragraph description of the skill's scope.

## References in this skill

List the files in `references/` and what they cover.

## Attribution & License

This skill synthesizes guidance from:

- [Jujutsu](https://github.com/jj-vcs/jj) — the jj VCS itself. Official documentation used for reference material. Licensed under [Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0).
- [Steve Klabnik's Jujutsu Tutorial](https://steveklabnik.github.io/jujutsu-tutorial/) — narrative tutorial, mental model grounding.
- [jujutsu-skill](https://github.com/...) by ... — agent-specific workflow patterns. Licensed under [MIT](https://opensource.org/licenses/MIT).
- ...
```

List every source that contributed content or patterns to the skill, with URL, brief description of what was used, and license where known.

### 2. SKILL.md — Inline `**Authority:**` citations

Inside the SKILL.md body, cite sources inline next to the specific claims they support. This tells the agent (and any human reviewer) *where a particular pattern or rule comes from*:

```markdown
**Authority:** jj official docs (working-copy.md). steveklabnik tutorial (hello-world chapter).
```

```markdown
**Authority:** jj official docs (revsets.md). ypares working-with-jj (revset reference section).
```

Use `**Authority:**` for factual claims about jj behavior. Not every line needs one — use them for non-obvious rules, gotchas, and patterns where the source matters.

### Source inventory for attribution

| Source | URL | License | Used in |
|--------|-----|---------|---------|
| Jujutsu (jj) | https://github.com/jj-vcs/jj | Apache-2.0 | All skills (official docs) |
| Steve Klabnik's tutorial | https://github.com/steveklabnik/jujutsu-tutorial | No LICENSE file (author typically uses MIT) | jj-overview, jj-sharing, jj-history |
| jujutsu-skill (danverbraganza) | https://github.com/danverbraganza/jujutsu-skill | MIT | jj-overview |
| dot-claude jj-workflow (TrevorS) | https://github.com/TrevorS/dot-claude | ISC (in package.json) | jj-overview, jj-sharing |
| ypares agent-skills (Yves Parès) | https://github.com/YPares/agent-skills | MIT (in marketplace.json) | jj-overview, jj-revsets, jj-workspaces, jj-config (agent config pattern) |
| jjtask (Coobaha / Alexander Ryzhikov) | https://github.com/Coobaha/jjtask | MIT | jj-overview (anti-patterns) |
| dotfiles (edmundmiller) | https://github.com/edmundmiller/dotfiles | MIT | jj-history |
| sgai (sandgardenhq / Sandgarden.com) | https://github.com/sandgardenhq/sgai | Modified MIT (non-compete clause) | jj-overview (git-to-jj table) |
| katies-ai-skills (SecKatie) | https://github.com/SecKatie/katies-ai-skills | No LICENSE file (jj-vcs docs within are Apache-2.0) | Superseded by canonical, but informed structure |

**Note:** For sources with no license or restrictive licenses, we synthesize and rewrite rather than copy verbatim, and attribute the source of patterns and ideas. Reference files sourced from the canonical jj repo (`reference/jj-vcs/docs/`) are Apache-2.0 licensed.



### TODO-as-commits workflow (ypares jj-todo-workflow)
Creative idea — use empty commits as task specs, fill them in later. But it's a highly opinionated workflow layered on top of jj, not jj knowledge itself. If wanted later, it would be a standalone `jj-todo-workflow` skill, not part of the core jj family.

### Full CLI reference dump
The katies cli-reference.md is just 21 lines of links. `jj help <command>` is better. Skills should teach mental models and patterns, not duplicate man pages.

### Monolithic "everything in one file" approach
Several references (jujutsu-skill, sgai) try to be one skill that covers everything. This bloats context. The family approach means the agent only loads what's relevant.

## Build Order

1. **`jj-overview`** — Gateway, most commonly loaded, unblocks everything else
2. **`jj-revsets`** — Foundational (revsets appear everywhere in jj)
3. **`jj-sharing`** — Most common "I need help" scenario after basics
4. **`jj-history`** — Advanced but frequently needed
5. **`jj-workspaces`** — Agentic-specific, builds on understanding from earlier skills
6. **`jj-config`** — Least urgent, config questions are infrequent

## Directory Structure

```
skills/
├── jj-overview/
│   ├── SKILL.md
│   ├── README.md
│   └── references/
│       ├── git-to-jj.md
│       ├── git-experts.md
│       └── command-gotchas.md
├── jj-revsets/
│   ├── SKILL.md
│   ├── README.md
│   └── references/
│       ├── revsets.md
│       ├── templates.md
│       └── filesets.md
├── jj-sharing/
│   ├── SKILL.md
│   ├── README.md
│   └── references/
│       ├── bookmarks.md
│       ├── github.md
│       └── git-compatibility.md
├── jj-history/
│   ├── SKILL.md
│   ├── README.md
│   └── references/
│       ├── conflicts.md
│       └── divergence.md
├── jj-workspaces/
│   ├── SKILL.md
│   ├── README.md
│   └── references/
│       └── parallel-agents.md
└── jj-config/
    ├── SKILL.md
    ├── README.md
    └── references/
        └── config.md
```
