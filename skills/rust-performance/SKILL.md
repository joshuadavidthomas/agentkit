---
name: rust-performance
description: "Use when optimizing or reviewing Rust for performance: profiling (perf/flamegraph/samply), benchmarking, allocation hotspots, HashMap/Vec efficiency, iterator/collect overhead, bounds checks, build profile (--release, LTO), and clippy perf lints."
---

# Rust Performance Rulebook

Optimize like a Rust engineer: measure first, change the right thing, and keep the result readable.

Your default mode is not micro-optimization. Your default mode is: build correctly, profile to find hot code, then apply high-impact patterns (algorithm/data structure/allocation).

**Authority:** Rust Performance Book (nnethercote), Effective Rust Items 20/29/30, clippy “Perf” lints.

## Entry Questions (answer these before changing code)

1. Is this code actually hot (shows up in a profiler or benchmark)? If not, stop.
2. Are you comparing release builds? If not, stop.
3. Is the problem algorithmic (O(n²) vs O(n)) / data-structure choice / allocation rate? Fix that before touching micro-details.

If you need tool setup commands, use [references/profiling-and-benchmarking.md](references/profiling-and-benchmarking.md).

## CRITICAL (do these first)

### 1. Always measure in `--release`

Dev builds are for debugging; they are not representative. Release builds commonly produce **10–100×** speedups over dev.

```bash
# WRONG (dev build)
cargo run

# RIGHT (release build)
cargo run --release
```

**Authority:** Rust Performance Book “Build Configuration”.

### 2. Profile first; optimize hot paths only

Do not “clean up clones” or “switch to unsafe” without data. Find the hot function(s), then either (a) make them faster or (b) call them less.

**Authority:** Rust Performance Book “General Tips” + “Profiling”; Effective Rust Item 20 (don’t over-optimize).

### 3. Treat allocations as a primary performance metric

If you see `malloc/free` hot in a profiler, treat “reduce allocation rate” as a first-class goal.

Rules of thumb that are actually worth tokens:
- Preallocate `Vec`/`String` when you can estimate size.
- Avoid allocating intermediate collections just to iterate them again.
- Avoid `format!` in hot paths when a borrowed string or `write!` into an existing buffer works.

**Authority:** Rust Performance Book “Heap Allocations”.

### 4. Make Clippy your performance reviewer

Run clippy and treat its performance lints as the default refactor path.

```bash
cargo clippy --release
```

If you intentionally deviate, document why.

**Authority:** Rust Performance Book “Linting”; Effective Rust Item 29.

## HIGH (typical wins)

### 5. Preallocate growth to avoid repeated reallocation and memcpy

```rust
// WRONG: repeated growth reallocations
let mut out = Vec::new();
for x in xs {
    out.push(f(x));
}

// RIGHT: one allocation
let mut out = Vec::with_capacity(xs.len());
for x in xs {
    out.push(f(x));
}
```

Prefer iterator forms when they carry a good `size_hint()`:

```rust
let out: Vec<_> = xs.iter().map(|x| f(x)).collect();
```

**Authority:** Rust Performance Book “Heap Allocations” (`Vec` growth); clippy perf lints frequently steer to iterator forms.

### 6. Avoid intermediate `collect()` when you can keep the iterator

```rust
// WRONG: allocates a Vec just to iterate again
let tmp: Vec<_> = xs.iter().map(f).collect();
let sum: i64 = tmp.iter().map(g).sum();

// RIGHT: fuse the pipeline
let sum: i64 = xs.iter().map(f).map(g).sum();
```

If the caller can consume an iterator, return `impl Iterator<Item = T>` instead of a `Vec<T>`.

**Authority:** Rust Performance Book “Iterators”; Rust Book ch 13 (iterators).

### 7. Use the right standard collection operation (many are asymptotic wins)

```rust
// WRONG: O(n) remove preserving order
v.remove(i);

// RIGHT: O(1) remove when order does not matter
v.swap_remove(i);

// RIGHT: bulk delete in one pass
v.retain(|x| keep(x));
```

**Authority:** Rust Performance Book “Standard Library Types”.

### 8. Use `HashMap`/`HashSet` capacity and `Entry` to avoid repeated work

```rust
use std::collections::HashMap;

// WRONG: double lookup
if !map.contains_key(&k) {
    map.insert(k, 1);
}

// RIGHT: one lookup
*map.entry(k).or_insert(0) += 1;
```

If you know approximate size up front, use `HashMap::with_capacity`.

**Authority:** Rust Performance Book “Heap Allocations” (hash tables grow like Vec); standard library `Entry` API.

### 9. If hashing is hot, consider a faster hasher (only when safe)

Default hashing prioritizes collision resistance; it can be slow for short keys. If profiling shows hashing hot and HashDoS is not a concern, prefer a faster hasher (e.g. `rustc_hash`, `ahash`) and enforce it consistently.

**Authority:** Rust Performance Book “Hashing”; clippy `disallowed_types` can enforce decisions.

### 10. Use lazy fallbacks (`*_or_else`) when the fallback is expensive

```rust
// WRONG: constructs error/default eagerly
let x = opt.ok_or(expensive_error());

// RIGHT: only constructs on None
let x = opt.ok_or_else(|| expensive_error());
```

**Authority:** Rust Performance Book “Standard Library Types” (`Option::ok_or_else`).

## MEDIUM (often real, but prove it)

### 11. Help the compiler eliminate bounds checks in hot loops (stay safe by default)

Prefer iteration over indexing. If indexing is required, structure code so lengths are obvious (slice once, assert ranges).

```rust
// WRONG: repeated bounds checks in a hot loop
for i in 0..v.len() {
    sum += v[i];
}

// RIGHT: iterator form
for x in &v {
    sum += *x;
}
```

Only consider `get_unchecked` under **rust-unsafe** rules (documented invariants, measured win).

**Authority:** Rust Performance Book “Bounds Checks”.

### 12. Prefer `iter().copied()` for small `Copy` items when it improves codegen

```rust
let sum: i32 = xs.iter().copied().sum();
```

This is a “trust but verify” optimization; confirm in a benchmark or by inspecting machine code.

**Authority:** Rust Performance Book “Iterators” (`copied`).

### 13. Use build profile knobs intentionally (binary/workspace root only)

These do not belong in leaf crates inside a workspace: Cargo reads profile settings from the workspace root.

Common knobs:
- `codegen-units = 1` (often better runtime, slower builds)
- `lto = "thin"|"fat"` (can be 10–20% or more on some programs)

**Authority:** Rust Performance Book “Build Configuration”; Cargo profile rules.

### 14. Consider an alternative allocator only if allocation is hot

Switching allocators is a real lever for some workloads, but it is not a default.

**Authority:** Rust Performance Book “Build Configuration” (allocators) + “Heap Allocations” (profile first).

## LOW (micro-optimizations; do last)

### 15. `#[inline]` and other hints are not performance proofs

Inline hints can help or hurt depending on code size and call frequency. Apply only on measured hot paths.

**Authority:** Rust Performance Book “Inlining”.

## Common Agent Failure Modes

- “Optimized” code measured in dev builds → always re-measure in `--release`.
- Removing allocations in cold code → ignore unless profiling shows it matters.
- Premature `unsafe` for bounds checks → don’t. Use safe restructuring first; unsafe requires a written invariant and a measured win.
- Changing three things at once → make one change, measure, then proceed.

## Cross-References

- **rust-ownership** — Eliminating clones by borrowing; API signatures that avoid copies.
- **rust-async** — Performance in async code (don’t block, don’t hold locks across `.await`, backpressure).
- **rust-traits** — Static vs dynamic dispatch tradeoffs (monomorphization vs vtables).
- **rust-testing** — Criterion, iai-callgrind, benchmarking discipline.

## Review Checklist

1. Are you measuring a realistic workload in `--release` (and not accidentally benchmarking optimizer-constant-folded toy inputs)?
2. Do you have a profile showing the hot functions (or allocation sites) you are targeting?
3. Did you change algorithm/data structure choices before micro-tuning?
4. Did you reduce allocations on the hot path (preallocate, avoid intermediate `collect`, avoid hot `format!`)?
5. Did you apply Clippy perf suggestions (or explicitly justify exceptions)?
6. Did you change one variable at a time and record before/after numbers?
7. Did you keep safety and correctness intact (no `unsafe` without invariants and evidence)?
