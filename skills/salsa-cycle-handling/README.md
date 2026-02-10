# salsa-cycle-handling

Dealing with recursive queries in Salsa: fixed-point iteration (`cycle_fn` + `cycle_initial`) and fallback values (`cycle_result`). Covers convergence requirements, monotonicity, and real-world cycle patterns from type systems, import resolution, and class hierarchies.

The `SKILL.md` provides the two strategies, decision framework, and scale calibration. The `references/` directory contains cycle handling patterns from projects with up to 60+ cycle sites.

## Attribution & License

This skill references code and patterns from the following open-source projects:

- [Cairo](https://github.com/starkware-libs/cairo) — smart contract language compiler. Licensed under [Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0).
- [Fe](https://github.com/argotorg/fe) — smart contract language. Licensed under [Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0).
- [Salsa](https://github.com/salsa-rs/salsa) — the incremental computation framework itself. Licensed under [MIT](https://opensource.org/licenses/MIT) OR [Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0).
- [WGSL Analyzer](https://github.com/wgsl-analyzer/wgsl-analyzer) — WebGPU shader LSP. Licensed under [MIT](https://opensource.org/licenses/MIT) OR [Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0).
- [rust-analyzer](https://github.com/rust-lang/rust-analyzer) — Rust IDE/LSP server. Licensed under [MIT](https://opensource.org/licenses/MIT) OR [Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0).
- [ty](https://github.com/astral-sh/ty) and shared infrastructure in the [Ruff monorepo](https://github.com/astral-sh/ruff) — Python type checker. Licensed under [MIT](https://opensource.org/licenses/MIT).
