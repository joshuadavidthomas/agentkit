# salsa-cancellation

Handling cancellation in Salsa-based interactive systems: catching `Cancelled` unwinding in LSP servers and CLI tools, classifying cancellation variants for retry vs error, adding manual cancellation checks, and implementing the snapshot pattern for concurrent queries.

The `SKILL.md` provides cancellation concepts and decision guidance. The `references/` directory contains cancellation patterns from LSP servers of varying complexity.

## Attribution & License

This skill references code and patterns from the following open-source projects:

- [Mun](https://github.com/mun-lang/mun) — hot-reloading language. Licensed under [MIT](https://opensource.org/licenses/MIT) OR [Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0).
- [Salsa](https://github.com/salsa-rs/salsa) — the incremental computation framework itself. Licensed under [MIT](https://opensource.org/licenses/MIT) OR [Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0).
- [WGSL Analyzer](https://github.com/wgsl-analyzer/wgsl-analyzer) — WebGPU shader LSP. Licensed under [MIT](https://opensource.org/licenses/MIT) OR [Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0).
- [rust-analyzer](https://github.com/rust-lang/rust-analyzer) — Rust IDE/LSP server. Licensed under [MIT](https://opensource.org/licenses/MIT) OR [Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0).
- [ty](https://github.com/astral-sh/ty) and shared infrastructure in the [Ruff monorepo](https://github.com/astral-sh/ruff) — Python type checker. Licensed under [MIT](https://opensource.org/licenses/MIT).
