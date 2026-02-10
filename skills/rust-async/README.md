# rust-async

Async patterns and Tokio for Rust. Covers the cooperative multitasking model, spawning tasks, channel selection, blocking vs non-blocking decisions, shared state patterns, graceful shutdown, cancellation safety, and sync↔async bridging.

## Scope

Use this skill when writing async/await code with Tokio, choosing between channel types, hitting Send/Sync errors on futures, deciding how to handle blocking operations in async context, or designing production patterns like graceful shutdown and backpressure. The entry question is **CPU-bound or I/O-bound?** — the answer determines the entire approach.

## References in this skill

Deep dives live in `references/`:
- `channels-and-select.md` — Channel type details, the actor pattern, `select!` usage, cancellation safety in select, cycle avoidance
- `blocking-and-bridging.md` — `spawn_blocking` vs `rayon` vs dedicated threads, sync→async and async→sync bridging, runtime configuration
- `production-patterns.md` — Graceful shutdown (`CancellationToken`, `TaskTracker`), timeouts, retry with backoff, backpressure, cancellation safety reference, `JoinSet`

## Attribution & license notes

This skill synthesizes guidance from:

- [Actors with Tokio](https://ryhl.io/blog/actors-with-tokio/) by Alice Ryhl — actor pattern, handle/task separation, shutdown, cycles
- [Async Book](https://rust-lang.github.io/async-book/) — futures, tasks, async/await mechanics, pinning, cancellation
- [Async: What is blocking?](https://ryhl.io/blog/async-what-is-blocking/) by Alice Ryhl — the core rule of async (blocking threshold, spawn_blocking vs rayon vs dedicated thread)
- [Rust Atomics and Locks](https://marabos.nl/atomics/) by Mara Bos — threading and synchronization primitives (MIT OR Apache-2.0)
- [Shared mutable state in Rust](https://ryhl.io/blog/shared-mutable-state/) by Alice Ryhl — wrapper struct pattern, when to use which mutex, async considerations
- [Tokio Tutorial](https://tokio.rs/tokio/tutorial) — spawning, channels, shared state, graceful shutdown (MIT)
- [tokio-util](https://docs.rs/tokio-util/) — `CancellationToken`, `TaskTracker` (MIT)
