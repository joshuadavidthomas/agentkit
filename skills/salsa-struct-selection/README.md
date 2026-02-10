# salsa-struct-selection

Choosing the right Salsa struct type: `#[salsa::input]` vs `#[salsa::tracked]` vs `#[salsa::interned]` vs plain Rust types. The single most important design decision in a Salsa project.

The `SKILL.md` provides the decision framework and key trade-offs. The `references/` directory contains detailed real-world strategies from projects that made very different choices (e.g., ty uses zero tracked structs while rust-analyzer interns every definition).

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
- [ty](https://github.com/astral-sh/ty) and shared infrastructure in the [Ruff monorepo](https://github.com/astral-sh/ruff) — Python type checker. Licensed under [MIT](https://opensource.org/licenses/MIT).
