# rust-performance

Performance optimization defaults for Rust. Covers profiling and benchmarking discipline, allocation reduction, container and iterator patterns, hashing choices, bounds-check elimination patterns, and build configuration knobs.

## Scope

Use this skill when you are optimizing Rust code, investigating a regression, reviewing PRs for performance pitfalls (allocation churn, HashMap misuse, intermediate collects), or configuring build/profiling settings for realistic measurements.

## References in this skill

Deep dives live in `references/`:
- `profiling-and-benchmarking.md` — practical profiling/benchmark setup (perf/flamegraph/samply, release debug line tables, frame pointers, black_box)
- `allocation-and-data-structures.md` — allocation hotspots, Vec/String/HashMap capacity patterns, Entry API, faster hashers and their threat-model caveats

## Attribution & license notes

This skill synthesizes guidance from:
- The Rust Performance Book by Nicholas Nethercote (MIT OR Apache-2.0): https://nnethercote.github.io/perf-book/
- Effective Rust by David Drysdale (content in `reference/effective-rust/`)
- Rust Clippy documentation and the Clippy “Perf” lint group: https://rust-lang.github.io/rust-clippy/master/
- The Rust Programming Language (Rust Book), especially iterator guidance (ch 13): https://doc.rust-lang.org/book/

The dot-skills “Rust performance optimization guidelines” (pproenca/dot-skills) is used as structural inspiration for impact-ranked rule presentation.
