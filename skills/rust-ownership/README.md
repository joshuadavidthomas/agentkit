# rust-ownership

Ownership, borrowing, and lifetimes skill for Rust. Encodes the design thinking
behind the borrow checker — when to borrow, when to own, when to clone, and how to
choose smart pointers. Activated by borrow checker errors (E0382, E0505, E0597, etc.)
and function signature design questions.

The `SKILL.md` provides an error-to-design-question table, function signature rules,
a smart pointer decision tree, lifetime essentials, guidance on when clone is fine,
and a 10-point review checklist. The `references/` directory contains deep-dive content
on smart pointers, lifetime patterns, and function signature design.

## Attribution & License

This skill synthesizes guidance from the following sources:

- [The Rust Programming Language](https://doc.rust-lang.org/book/) (Chapters 4, 10, 15) — Official Rust book. Licensed under [MIT](https://opensource.org/licenses/MIT) OR [Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0).
- [Rust Reference](https://doc.rust-lang.org/reference/) — Lifetime elision rules, subtyping. Licensed under [MIT](https://opensource.org/licenses/MIT) OR [Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0).
- [Rust API Guidelines](https://github.com/rust-lang/api-guidelines) — C-CALLER-CONTROL, C-CONV. Licensed under [MIT](https://opensource.org/licenses/MIT) OR [Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0).
- [Effective Rust](https://www.lurklurk.org/effective-rust/) by David Drysdale — Items on references, lifetimes, smart pointers. Licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
- ["Common Rust Lifetime Misconceptions"](https://github.com/pretzelhammer/rust-blog/blob/master/posts/common-rust-lifetime-misconceptions.md) by pretzelhammer — The 10 misconceptions that trip everyone up. Licensed under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).
- ["Tour of Rust's Standard Library Traits"](https://github.com/pretzelhammer/rust-blog/blob/master/posts/tour-of-rusts-standard-library-traits.md) by pretzelhammer — Clone, Copy, Deref, AsRef, Borrow, From/Into, ToOwned. Licensed under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).
- [The Rust Performance Book](https://nnethercote.github.io/perf-book/) by Nicholas Nethercote — Heap allocation guidance. Licensed under [MIT](https://opensource.org/licenses/MIT) OR [Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0).
