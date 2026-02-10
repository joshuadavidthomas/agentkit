# salsa-durability

Tuning Salsa with durability levels (`HIGH`, `MEDIUM`, `LOW`) to skip unnecessary revalidation. Covers the mental model, per-field durability, and strategies for categorizing inputs by change frequency.

The `SKILL.md` provides the durability concepts and decision guidance. The `references/` directory contains durability strategies from the two projects that use them most extensively.

## Attribution & License

This skill references code and patterns from the following open-source projects:

- [Salsa](https://github.com/salsa-rs/salsa) — the incremental computation framework itself. Licensed under [MIT](https://opensource.org/licenses/MIT) OR [Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0).
- [rust-analyzer](https://github.com/rust-lang/rust-analyzer) — Rust IDE/LSP server. Licensed under [MIT](https://opensource.org/licenses/MIT) OR [Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0).
- [ty](https://github.com/astral-sh/ty) and shared infrastructure in the [Ruff monorepo](https://github.com/astral-sh/ruff) — Python type checker. Licensed under [MIT](https://opensource.org/licenses/MIT).
