# rust-serde

Serde serialization patterns and schema design defaults for Rust. Covers derive-first workflow, high-leverage attributes, enum wire representations, adapter choices (`serde_with`, `#[serde(with = ...)]`, `from/try_from/into`), and when manual Serialize/Deserialize is justified.

## Scope

Use this skill when you are:

- adding `#[derive(Serialize, Deserialize)]` to structs/enums
- deciding how an enum should be represented on the wire (tag/content/untagged)
- dealing with serde attributes like `flatten`, `default`, `rename_all`, `deny_unknown_fields`
- adapting third-party types (Url, Mime, Duration, bytes, etc.) to a specific representation
- writing custom (de)serialization logic and want the least-custom, most-idiomatic approach

## References in this skill

Deep dives live in `references/`:

- `attributes-cheatsheet.md` — practical attribute subset + gotchas (flatten vs deny_unknown_fields, tagging restrictions, compatibility tools like alias/other)
- `adapters-and-custom-impls.md` — serde_with patterns, with-modules, from/try_from/into conversions, when manual impls are justified

## Attribution & license notes

This skill synthesizes guidance from:

- [Serde documentation](https://serde.rs/) — attributes, enum representations, custom serialization. The serde.rs book/docs content in `reference/serde-docs` is licensed under CC BY-SA 4.0 (see `LICENSE-CC-BY-SA` in that repo).
- [serde_with](https://github.com/jonasbb/serde_with) — reusable adapters and the `serde_as` pattern. Licensed under MIT OR Apache-2.0.
- [Effective Rust](https://www.lurklurk.org/effective-rust/) by David Drysdale — especially the newtype pattern and orphan rule implications for serialization. Licensed CC BY 4.0.
- [Rust API Guidelines](https://github.com/rust-lang/api-guidelines) — type-driven design defaults that drive better schemas. Licensed under MIT OR Apache-2.0.
