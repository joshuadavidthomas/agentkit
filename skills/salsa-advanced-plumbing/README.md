# salsa-advanced-plumbing

Low-level Salsa patterns for specialized use cases: `specify` for overriding tracked functions, `singleton` inputs, `attach` for thread-local database access, persistence/serialization, and synthetic writes for benchmarking.

The `SKILL.md` provides pattern descriptions and a decision table for when to reach for each feature.

## Attribution & License

This skill references code and patterns from the following open-source projects:

- [Cairo](https://github.com/starkware-libs/cairo) — smart contract language compiler. Licensed under [Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0).
- [Salsa](https://github.com/salsa-rs/salsa) — the incremental computation framework itself. Licensed under [MIT](https://opensource.org/licenses/MIT) OR [Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0).
- [rust-analyzer](https://github.com/rust-lang/rust-analyzer) — Rust IDE/LSP server. Licensed under [MIT](https://opensource.org/licenses/MIT) OR [Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0).
