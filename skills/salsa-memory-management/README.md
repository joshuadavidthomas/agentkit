# salsa-memory-management

Controlling Salsa cache growth: LRU eviction, `no_eq` for skipping expensive equality checks, `returns(ref)`/`returns(deref)` to avoid cloning, `heap_size` for memory profiling, and `revisions = usize::MAX` for immortal interning.

The `SKILL.md` provides the memory management levers and decision guidance. The `references/` directory contains memory strategies from projects ranging from minimal (`returns(ref)` only) to comprehensive (proc-macro-injected heap tracking).

## Attribution & License

This skill references code and patterns from the following open-source projects:

- [BAML](https://github.com/BoundaryML/baml) — AI function compiler. Licensed under [Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0).
- [Cairo](https://github.com/starkware-libs/cairo) — smart contract language compiler. Licensed under [Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0).
- [Salsa](https://github.com/salsa-rs/salsa) — the incremental computation framework itself. Licensed under [MIT](https://opensource.org/licenses/MIT) OR [Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0).
- [django-language-server](https://github.com/joshuadavidthomas/django-language-server) — Django template LSP. Licensed under [Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0).
- [rust-analyzer](https://github.com/rust-lang/rust-analyzer) — Rust IDE/LSP server. Licensed under [MIT](https://opensource.org/licenses/MIT) OR [Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0).
- [ty](https://github.com/astral-sh/ty) and shared infrastructure in the [Ruff monorepo](https://github.com/astral-sh/ruff) — Python type checker. Licensed under [MIT](https://opensource.org/licenses/MIT).
