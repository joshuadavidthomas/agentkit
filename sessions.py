#!/usr/bin/env python3
"""
Summarize pi session logs for a worktree.

Usage:
    ./sessions.py <worktree-dir>              # summarize all sessions
    ./sessions.py <worktree-dir> --last 3     # last 3 sessions only
    ./sessions.py <worktree-dir> --errors     # errors only
    ./sessions.py <worktree-dir> --stats      # just the numbers
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter
from dataclasses import dataclass
from dataclasses import field
from pathlib import Path


@dataclass
class ToolError:
    tool: str
    text: str
    turn: int


@dataclass
class SessionSummary:
    path: Path
    timestamp: str = ""
    model: str = ""
    provider: str = ""
    turns: int = 0
    tool_calls: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    cache_read: int = 0
    cache_write: int = 0
    cost: float = 0.0
    errors: list[ToolError] = field(default_factory=list)
    tools_used: Counter = field(default_factory=Counter)
    files_read: list[str] = field(default_factory=list)
    files_written: list[str] = field(default_factory=list)


def parse_session(path: Path) -> SessionSummary:
    summary = SessionSummary(path=path)
    turn = 0

    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
            except json.JSONDecodeError:
                continue

            entry_type = entry.get("type")

            if entry_type == "session":
                summary.timestamp = entry.get("timestamp", "")
                continue

            if entry_type != "message":
                continue

            msg = entry.get("message", {})
            role = msg.get("role")

            if role == "assistant":
                turn += 1
                usage = msg.get("usage", {})
                summary.input_tokens += usage.get("input", 0)
                summary.output_tokens += usage.get("output", 0)
                summary.cache_read += usage.get("cacheRead", 0)
                summary.cache_write += usage.get("cacheWrite", 0)
                cost = usage.get("cost", {})
                summary.cost += cost.get("total", 0)

                if not summary.model:
                    summary.model = msg.get("model", "")
                    summary.provider = msg.get("provider", "")

                # Count tool calls in content
                for block in msg.get("content", []):
                    if block.get("type") == "toolCall":
                        summary.tool_calls += 1
                        tool_name = block.get("name", "")
                        summary.tools_used[tool_name] += 1

                        args = block.get("arguments", {})
                        if tool_name == "read":
                            summary.files_read.append(args.get("path", ""))
                        elif tool_name == "write":
                            summary.files_written.append(args.get("path", ""))
                        elif tool_name == "edit":
                            summary.files_written.append(args.get("path", ""))

            elif role == "toolResult":
                if msg.get("isError"):
                    text_parts = []
                    for block in msg.get("content", []):
                        if block.get("type") == "text":
                            text_parts.append(block.get("text", ""))
                    error_text = " ".join(text_parts)

                    # Skip non-errors
                    stripped = error_text.strip()
                    # grep/rg no matches (exit code 1, no/minimal output)
                    if not stripped:
                        continue
                    if re.match(r"^(.*\s+)?Command exited with code 1$", stripped):
                        continue
                    # Exit code 2 with just the exit message (e.g., grep usage error)
                    if stripped == "Command exited with code 2":
                        continue

                    # Skip inspector rebuild warnings (not actual errors)
                    if "Building Python inspector" in error_text and "Successfully built" in error_text:
                        continue

                    summary.errors.append(
                        ToolError(
                            tool=msg.get("toolName", ""),
                            text=error_text[:500],
                            turn=turn,
                        )
                    )

    summary.turns = turn
    return summary


def fmt_tokens(n: int) -> str:
    if n >= 1_000_000:
        return f"{n / 1_000_000:.1f}m"
    if n >= 1_000:
        return f"{n // 1_000}k"
    return str(n)


def classify_error(error: ToolError) -> str:
    text = error.text.lower()
    if "enoent" in text or "no such file" in text:
        return "file-not-found"
    if "error[e" in text:
        # Extract the specific error code
        match = re.search(r"error\[(e\d+)\]", text)
        if match:
            return f"compile-{match.group(1).upper()}"
        return "compile-error"
    if "warning:" in text and ("clippy" in text or "#[warn" in text):
        return "clippy-warning"
    if text.startswith("error:") and "error[e" not in text:
        return "clippy-warning"
    if "cannot find" in text or "not found" in text:
        return "not-found"
    if "mismatched types" in text or "type mismatch" in text:
        return "type-error"
    if "unresolved" in text:
        return "unresolved-import"
    return "other"


def extract_rust_error_essence(text: str) -> str:
    """Extract the key part of a Rust compiler error."""
    # Look for error[EXXXX]: message
    match = re.search(r"(error\[E\d+\]:.*?)(?:\n|$)", text)
    if match:
        return match.group(1).strip()
    # Look for error: message
    match = re.search(r"(error:.*?)(?:\n|$)", text)
    if match:
        return match.group(1).strip()
    # Look for warning: message
    match = re.search(r"(warning:.*?)(?:\n|$)", text)
    if match:
        return match.group(1).strip()
    return text[:200].replace("\n", " ").strip()


def print_session(summary: SessionSummary, verbose: bool = False) -> None:
    ts = summary.timestamp[:19].replace("T", " ") if summary.timestamp else "unknown"
    print(f"\n{'─' * 70}")
    print(f"  {ts}  {summary.provider}/{summary.model}")
    print(
        f"  turns={summary.turns}  tools={summary.tool_calls}  "
        f"↑{fmt_tokens(summary.input_tokens)} ↓{fmt_tokens(summary.output_tokens)}  "
        f"cache: r={fmt_tokens(summary.cache_read)} w={fmt_tokens(summary.cache_write)}  "
        f"${summary.cost:.3f}"
    )

    if summary.errors:
        error_classes = Counter(classify_error(e) for e in summary.errors)
        print(f"  errors={len(summary.errors)}: {dict(error_classes)}")

        if verbose:
            for err in summary.errors:
                cls = classify_error(err)
                essence = extract_rust_error_essence(err.text)
                print(f"    turn {err.turn} [{err.tool}] ({cls}): {essence}")

    if verbose and summary.tools_used:
        tools_str = ", ".join(
            f"{name}={count}" for name, count in summary.tools_used.most_common()
        )
        print(f"  tools: {tools_str}")


def print_aggregate(summaries: list[SessionSummary]) -> None:
    total_turns = sum(s.turns for s in summaries)
    total_tools = sum(s.tool_calls for s in summaries)
    total_input = sum(s.input_tokens for s in summaries)
    total_output = sum(s.output_tokens for s in summaries)
    total_cost = sum(s.cost for s in summaries)
    total_errors = sum(len(s.errors) for s in summaries)

    print(f"\n{'━' * 70}")
    print(f"  TOTAL: {len(summaries)} sessions")
    print(
        f"  turns={total_turns}  tools={total_tools}  "
        f"↑{fmt_tokens(total_input)} ↓{fmt_tokens(total_output)}  "
        f"${total_cost:.3f}"
    )
    print(f"  errors={total_errors}")

    all_errors = [e for s in summaries for e in s.errors]
    if all_errors:
        error_classes = Counter(classify_error(e) for e in all_errors)
        print(f"  error breakdown: {dict(error_classes)}")

        patterns = Counter(f"{e.tool}:{classify_error(e)}" for e in all_errors)
        repeated = [(p, c) for p, c in patterns.most_common() if c > 1]
        if repeated:
            print("  repeated patterns:")
            for pattern, count in repeated:
                print(f"    {pattern}: {count}x")

    print(f"{'━' * 70}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Summarize pi session logs")
    parser.add_argument("worktree", help="Worktree directory name")
    parser.add_argument("--last", type=int, default=0, help="Only last N sessions")
    parser.add_argument(
        "--errors", action="store_true", help="Show only sessions with errors"
    )
    parser.add_argument(
        "--stats", action="store_true", help="Show only aggregate stats"
    )
    parser.add_argument(
        "--verbose", "-v", action="store_true", help="Show individual errors"
    )
    parser.add_argument(
        "--for-agent",
        action="store_true",
        help="Output optimized for LLM consumption (reflect pass)",
    )
    args = parser.parse_args()

    worktree_path = Path(args.worktree)
    if worktree_path.is_absolute():
        session_dir = worktree_path / ".pi-sessions"
    else:
        script_dir = Path(__file__).parent
        session_dir = script_dir / args.worktree / ".pi-sessions"

    if not session_dir.exists():
        print(f"No sessions found at {session_dir}", file=sys.stderr)
        sys.exit(1)

    session_files = sorted(session_dir.rglob("*.jsonl"))
    if not session_files:
        print(f"No .jsonl files in {session_dir}", file=sys.stderr)
        sys.exit(1)

    if args.last > 0:
        session_files = session_files[-args.last :]

    summaries = [parse_session(f) for f in session_files]

    if args.errors:
        summaries = [s for s in summaries if s.errors]

    if args.for_agent:
        print_agent_summary(summaries)
    elif args.stats:
        print_aggregate(summaries)
    else:
        for s in summaries:
            print_session(s, verbose=args.verbose)
        if len(summaries) > 1:
            print_aggregate(summaries)


def print_agent_summary(summaries: list[SessionSummary]) -> None:
    """Output optimized for the reflect agent — actionable, not raw."""
    total_cost = sum(s.cost for s in summaries)
    total_errors = sum(len(s.errors) for s in summaries)
    total_turns = sum(s.turns for s in summaries)

    print("# Session Review")
    print(f"\n{len(summaries)} sessions, {total_turns} turns, ${total_cost:.2f} total, {total_errors} real errors")
    print(f"(grep/rg no-match and inspector rebuild warnings are filtered out)")

    # Compile errors grouped by error code — the most actionable thing
    all_errors = [e for s in summaries for e in s.errors]

    if all_errors:
        print("\n## Errors by Type")
        by_class: dict[str, list[ToolError]] = {}
        for e in all_errors:
            cls = classify_error(e)
            by_class.setdefault(cls, []).append(e)

        for cls, errors in sorted(by_class.items(), key=lambda x: -len(x[1])):
            print(f"\n### {cls} ({len(errors)}x)")
            # Show unique error essences
            essences = []
            for e in errors:
                essence = extract_rust_error_essence(e.text)
                if essence not in essences:
                    essences.append(essence)
            for essence in essences[:8]:
                print(f"  - {essence}")
            if len(essences) > 8:
                print(f"  - ...and {len(essences) - 8} more unique errors")
    else:
        print("\n## No real errors found — all sessions clean!")

    # Files read repeatedly — always show this
    all_reads = [f for s in summaries for f in s.files_read]
    if all_reads:
        read_counts = Counter(all_reads)
        repeated_reads = [(f, c) for f, c in read_counts.most_common() if c > 3]
        if repeated_reads:
            print(f"\n## Files read 4+ times across sessions")
            print("(Consider documenting these paths in AGENTS.md)")
            for filepath, count in repeated_reads[:15]:
                short = "/".join(filepath.split("/")[-3:])
                print(f"  - {short}: {count}x")

    # Files written — shows what was actively worked on
    all_writes = [f for s in summaries for f in s.files_written]
    if all_writes:
        write_counts = Counter(all_writes)
        top_writes = write_counts.most_common(10)
        if top_writes:
            print(f"\n## Most-modified files")
            for filepath, count in top_writes:
                short = "/".join(filepath.split("/")[-3:])
                print(f"  - {short}: {count} edits")


if __name__ == "__main__":
    main()
