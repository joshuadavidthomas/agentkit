# salsa-database-architecture

How to structure a Salsa database: layered trait hierarchies, non-Salsa side-table state, test databases with event capture, and production databases.

The `SKILL.md` provides the architectural patterns and decision guidance. The `references/` directory contains real-world database architectures from projects spanning 4 to 6 trait layers.

## Attribution & License

This skill references code and patterns from the following open-source projects:

- [BAML](https://github.com/BoundaryML/baml) — AI function compiler. Licensed under [Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0).
- [Cairo](https://github.com/starkware-libs/cairo) — smart contract language compiler. Licensed under [Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0).
- [Fe](https://github.com/argotorg/fe) — smart contract language. Licensed under [Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0).
- [Mun](https://github.com/mun-lang/mun) — hot-reloading language. Licensed under [MIT](https://opensource.org/licenses/MIT) OR [Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0).
- [Salsa](https://github.com/salsa-rs/salsa) — the incremental computation framework itself. Licensed under [MIT](https://opensource.org/licenses/MIT) OR [Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0).
- [WGSL Analyzer](https://github.com/wgsl-analyzer/wgsl-analyzer) — WebGPU shader LSP. Licensed under [MIT](https://opensource.org/licenses/MIT) OR [Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0).
- [django-language-server](https://github.com/joshuadavidthomas/django-language-server) — Django template LSP. Licensed under [Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0).
- [rust-analyzer](https://github.com/rust-lang/rust-analyzer) — Rust IDE/LSP server. Licensed under [MIT](https://opensource.org/licenses/MIT) OR [Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0).
- [stc](https://github.com/dudykr/stc) — TypeScript type checker in Rust. Licensed under [Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0).
- [ty](https://github.com/astral-sh/ty) and shared infrastructure in the [Ruff monorepo](https://github.com/astral-sh/ruff) — Python type checker. Licensed under [MIT](https://opensource.org/licenses/MIT).
