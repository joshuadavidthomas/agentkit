# jj-workspaces

Jujutsu (jj) workspaces for parallel agent execution: creating isolated working copies, assigning agents to workspaces, monitoring progress, handling stale working copies, conflict mitigation, cleanup, and the decision framework for when parallel workspaces are worth the overhead. Targets jj 0.36+.

## References in this skill

- `references/parallel-agents.md` — Complete parallel agent setup guide: problem statement, step-by-step workflow (plan → create → launch → monitor → integrate → cleanup), agent instruction templates, stale workspace handling, conflict mitigation strategies, decision checklist, and troubleshooting table

## Attribution & License

This skill synthesizes guidance from:

- [Jujutsu](https://github.com/jj-vcs/jj) — the jj VCS itself. Official documentation used for workspace concepts, commands, and stale working copy behavior (working-copy.md, glossary.md). Licensed under [Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0).
- [Steve Klabnik's Jujutsu Tutorial](https://github.com/steveklabnik/jujutsu-tutorial) — conceptual grounding on workspaces as multiple local checkouts.
- [agent-skills jj-todo-workflow](https://github.com/YPares/agent-skills) by Yves Parès — parallel agent workspace patterns, decision criteria, agent instruction templates, and cleanup workflow. Licensed under [MIT](https://opensource.org/licenses/MIT).
