# rust-project-structure

Project/workspace organization and public API surface design for Rust: when to use a workspace, how to lay out crates and modules, how to use Cargo features correctly (additive, unified), and how to keep `pub` and documentation aligned with semver stability.

## Scope

Use this skill when starting a new Rust project, splitting code into crates, reorganizing a workspace, introducing feature flags, designing a library’s `lib.rs` facade, or debugging Cargo behavior like feature unification (`default-features = false` not working, unexpected dependencies, duplicated crate versions).

## References in this skill

Deep dives live in `references/`:
- `workspaces-and-layout.md` — Workspace vs single-crate decisions, virtual workspaces, `workspace.dependencies`, `Cargo.lock` rules, `crates/*` layouts
- `features-and-unification.md` — Feature unification, additive features, resolver versions, anti-patterns (feature-gated public API), debugging with `cargo tree -e features`
- `public-api-surface.md` — Visibility discipline (`pub(crate)` defaults), facade modules and `pub use`, avoiding wildcard imports, documentation placement and semver implications

## Attribution & license notes

This skill synthesizes guidance from:
- The Cargo Book (rust-lang/cargo): Workspaces, Features, Resolver versions (MIT OR Apache-2.0)
- Edition Guide (rust-lang/edition-guide): edition defaults, creating new projects (MIT OR Apache-2.0)
- Rust API Guidelines (rust-lang/api-guidelines): metadata, documentation, type safety, feature naming (MIT OR Apache-2.0)
- Effective Rust (David Drysdale): Item 22 (visibility), Item 23 (wildcard imports), Item 26 (feature creep), Item 27 (documentation) (O’Reilly content; included in this repo as reference material)
