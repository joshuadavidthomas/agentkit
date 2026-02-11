# rust-atomics

Atomic synchronization and memory-ordering defaults for Rust. Covers atomic-vs-lock decisions, ordering selection (`Relaxed`/`Acquire`/`Release`/`AcqRel`/`SeqCst`), compare-exchange loops, publication edges, and common unsound concurrency patterns.

## Scope

Use this skill when you are:

- choosing between atomics and higher-level synchronization (`Mutex`, `RwLock`, channels)
- writing or reviewing `Ordering` arguments on atomic operations
- implementing CAS retry loops (`compare_exchange` / `compare_exchange_weak`)
- debugging visibility bugs that appear only under contention or on weaker memory models
- reviewing lock-free patterns for UB boundaries and `Send`/`Sync` proof obligations

## References in this skill

Deep dives live in `references/`:

- `ordering-cheatsheet.md` — intent → ordering defaults and valid `compare_exchange` pairings
- `patterns-from-rust-atomics-and-locks.md` — concrete source-backed examples mapped to practical patterns
- `ownership-handoff-deadlocks.md` — exclusivity-barrier deadlocks caused by accidental extra ownership
- `ub-boundaries.md` — UB boundaries, aliasing/data-race hazards, and unsafe concurrency checklist

## Attribution & license notes

This skill synthesizes guidance from:

- [_Rust Atomics and Locks_](https://marabos.nl/atomics/) by Mara Bos and its companion code in `reference/rust-atomics-and-locks` (repo states code may be used for any purpose; attribution appreciated).
- [Rust standard library docs](https://doc.rust-lang.org/std/sync/atomic/) for atomic API contracts and ordering constraints.
- [Rustonomicon](https://doc.rust-lang.org/nomicon/atomics.html) for low-level memory-model and unsafe concurrency guidance.
- [Rust Reference: behavior considered undefined](https://doc.rust-lang.org/reference/behavior-considered-undefined.html) for UB ground truth.
- [The Rust Book: `Send` and `Sync`](https://doc.rust-lang.org/book/ch16-04-extensible-concurrency-sync-and-send.html) and interior mutability background.
