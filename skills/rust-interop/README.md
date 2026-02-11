# rust-interop

Rust ecosystem defaults for cross-language integration: choosing the right interop tool (raw C ABI vs cxx vs PyO3 vs napi-rs vs wasm-bindgen vs UniFFI), designing a small explicit boundary, and translating ownership/errors/concurrency correctly across runtimes.

## Scope

Use this skill when exposing Rust to other languages (or embedding other runtimes in Rust): `extern "C"` FFI, bindgen/cbindgen, C++ interop, Python modules via PyO3, Node.js addons via napi-rs, WebAssembly via wasm-bindgen, or generating Swift/Kotlin/Python bindings via UniFFI.

## References in this skill

Deep dives live in `references/`:

- `c-ffi.md` — C ABI contracts: ownership, strings, `(ptr, len)` buffers, panic/unwind policy, bindgen/cbindgen defaults
- `cxx.md` — Rust↔C++ via `cxx::bridge`: shared vs opaque types, smart pointers, `Result<T>` and exception boundaries
- `pyo3.md` — PyO3 defaults: lifetime/ownership (`Bound<'py, T>` vs `Py<T>`), detach for parallelism, packaging with maturin/abi3
- `napi-rs.md` — Node-API defaults: `cdylib` + build.rs, async surfaces, error mapping, never blocking the event loop
- `wasm-bindgen.md` — WASM/JS defaults: minimizing boundary crossings, serde-wasm-bindgen for complex types, Promise↔Future bridging
- `uniffi.md` — UniFFI defaults: UDL vs proc macros, error enums, generating bindings from `--library` artifacts

## Attribution & license notes

This skill synthesizes guidance from:

- Rustonomicon (rust-lang/nomicon): FFI and unsafe boundaries (MIT OR Apache-2.0)
- Rust Reference (rust-lang/reference): ABI/unwinding/UB rules (MIT OR Apache-2.0)
- Cargo Book (rust-lang/cargo): crate types and build patterns (MIT OR Apache-2.0)
- PyO3 guide (PyO3/pyo3): Python integration and packaging (Apache-2.0)
- napi-rs docs (napi-rs/napi-rs): Node-API addon patterns (MIT)
- wasm-bindgen guide (wasm-bindgen/wasm-bindgen): WASM bindings and deployment targets (MIT OR Apache-2.0)
- cxx book (dtolnay/cxx): Rust↔C++ bridge patterns (MIT OR Apache-2.0)
- UniFFI manual (mozilla/uniffi-rs): multi-language binding generation (MPL-2.0)
