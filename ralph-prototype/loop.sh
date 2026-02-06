#!/bin/bash
set -euo pipefail

# Usage: ./loop.sh <worktree-dir> [max_iterations] [reflect_every] [clean_every]
# Examples:
#   ./loop.sh detailed-opus-4.6          # run forever, reflect every 5, clean every 5
#   ./loop.sh detailed-kimi-k2.5 20      # 20 iterations, reflect every 5, clean every 5
#   ./loop.sh intent-opus-4.6 20 3       # 20 iterations, reflect every 3, clean every 5
#   ./loop.sh intent-opus-4.6 20 0       # 20 iterations, never reflect, clean every 5
#   ./loop.sh intent-opus-4.6 20 5 10    # 20 iterations, reflect every 5, clean every 10
#   ./loop.sh intent-opus-4.6 20 5 0     # 20 iterations, reflect every 5, never clean

WORKTREE="${1:?Usage: ./loop.sh <worktree-dir> [max_iterations] [reflect_every] [clean_every]}"
MAX_ITERATIONS="${2:-0}"
REFLECT_EVERY="${3:-5}"
CLEAN_EVERY="${4:-5}"

# Disk space thresholds
DISK_WARN_PERCENT=85
DISK_CRITICAL_PERCENT=95

# Model mapping — fixed for this experiment
case "$WORKTREE" in
detailed-opus-4.6 | intent-opus-4.6)
    PROVIDER="anthropic"
    MODEL_ID="claude-opus-4-6"
    ;;
detailed-gpt-5.3-codex | intent-gpt-5.3-codex)
    PROVIDER="openai-codex"
    MODEL_ID="gpt-5.3-codex"
    ;;
detailed-kimi-k2.5)
    PROVIDER="kimi-coding"
    MODEL_ID="k2p5"
    # PROVIDER="opencode"
    # MODEL_ID="kimi-k2.5-free"
    ;;
*)
    echo "Error: unknown worktree '$WORKTREE'"
    echo "Known worktrees: detailed-opus-4.6, detailed-gpt-5.3-codex, detailed-kimi-k2.5, intent-opus-4.6, intent-gpt-5.3-codex"
    exit 1
    ;;
esac

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WORKTREE_DIR="$SCRIPT_DIR/$WORKTREE"
SESSION_DIR="$WORKTREE_DIR/.pi-sessions"
PROMPT_BUILD="$SCRIPT_DIR/PROMPT.md"
PROMPT_REFLECT="$SCRIPT_DIR/PROMPT_reflect.md"
RALPH_EXT="$SCRIPT_DIR/ralph.ts"

# Share a single target directory across all worktrees.
# Cargo handles concurrent access and different feature sets fine —
# artifacts are keyed by crate name + metadata hash, so different
# branches don't clobber each other. This avoids duplicating ~8GB
# of compiled deps per worktree.
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$REPO_ROOT/target}"

# Verify worktree exists
if [ ! -d "$WORKTREE_DIR" ]; then
    echo "Error: worktree directory not found: $WORKTREE_DIR"
    exit 1
fi

# --- Disk / target cleanup helpers ---

get_disk_usage_percent() {
    df "$WORKTREE_DIR" | awk 'NR==2 {gsub(/%/,""); print $5}'
}

get_target_size() {
    if [ -d "$CARGO_TARGET_DIR" ]; then
        du -sh "$CARGO_TARGET_DIR" 2>/dev/null | cut -f1
    else
        echo "0"
    fi
}

clean_target() {
    if [ ! -d "$CARGO_TARGET_DIR" ]; then
        return
    fi

    local before
    before=$(get_target_size)
    echo "🧹 Cleaning $CARGO_TARGET_DIR (was $before)..."
    (cd "$WORKTREE_DIR" && cargo clean 2>/dev/null) || rm -rf "$CARGO_TARGET_DIR"
    local after
    after=$(get_target_size)
    echo "   target now: $after"
}

# Also clean up any leftover per-worktree target dirs from before
# the shared target dir was set up.
clean_stale_worktree_targets() {
    local cleaned=0
    for wt in "$SCRIPT_DIR"/*/; do
        if [ -d "$wt/target" ] && [ "$(cd "$wt" && realpath target)" != "$(realpath "$CARGO_TARGET_DIR")" ]; then
            local size
            size=$(du -sh "$wt/target" 2>/dev/null | cut -f1)
            echo "   Removing stale $(basename "$wt")/target ($size)..."
            rm -rf "$wt/target"
            cleaned=1
        fi
    done
    [ "$cleaned" -eq 1 ] && echo ""
}

check_disk_space() {
    local usage
    usage=$(get_disk_usage_percent)

    if [ "$usage" -ge "$DISK_CRITICAL_PERCENT" ]; then
        echo ""
        echo "🚨 CRITICAL: Disk at ${usage}% — cleaning shared target + all stale targets"
        clean_target
        clean_stale_worktree_targets
        local after_usage
        after_usage=$(get_disk_usage_percent)
        echo "   Disk now at ${after_usage}%"
        echo ""

        if [ "$after_usage" -ge "$DISK_CRITICAL_PERCENT" ]; then
            echo "❌ Still at ${after_usage}% after cleaning — bailing out to avoid filling disk"
            exit 1
        fi
    elif [ "$usage" -ge "$DISK_WARN_PERCENT" ]; then
        echo "⚠️  Disk at ${usage}% — cleaning target"
        clean_target
    fi
}

ITERATION=0
CURRENT_BRANCH=$(cd "$WORKTREE_DIR" && git branch --show-current)

DISK_USAGE=$(get_disk_usage_percent)
TARGET_SIZE=$(get_target_size)

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Worktree: $WORKTREE"
echo "Model:    $PROVIDER / $MODEL_ID"
echo "Branch:   $CURRENT_BRANCH"
[ "$MAX_ITERATIONS" -gt 0 ] 2>/dev/null && echo "Max:      $MAX_ITERATIONS iterations"
echo "Reflect:  every $REFLECT_EVERY iterations"
if [ "$CLEAN_EVERY" -gt 0 ] 2>/dev/null; then
    echo "Clean:    every $CLEAN_EVERY iterations"
else
    echo "Clean:    disabled (periodic), still watching disk"
fi
echo "Disk:     ${DISK_USAGE}% used | target/ is $TARGET_SIZE"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Check disk space before even starting
check_disk_space

while true; do
    if [ "$MAX_ITERATIONS" -gt 0 ] 2>/dev/null && [ "$ITERATION" -ge "$MAX_ITERATIONS" ]; then
        echo "Reached max iterations: $MAX_ITERATIONS"
        break
    fi

    ITERATION=$((ITERATION + 1))

    # Decide: build or reflect?
    if [ "$REFLECT_EVERY" -gt 0 ] && [ $((ITERATION % REFLECT_EVERY)) -eq 0 ]; then
        PROMPT_FILE="$PROMPT_REFLECT"
        MODE="reflect"
        THINKING="high"
    else
        PROMPT_FILE="$PROMPT_BUILD"
        MODE="build"
        THINKING="medium"
    fi

    # --- Disk management ---
    # Always check if disk is dangerously full
    check_disk_space

    # Periodic cargo clean
    if [ "$CLEAN_EVERY" -gt 0 ] && [ $((ITERATION % CLEAN_EVERY)) -eq 0 ]; then
        clean_target
    fi

    echo ""
    echo "======================== ITERATION $ITERATION ($MODE) ========================"
    TARGET_SIZE=$(get_target_size)
    DISK_USAGE=$(get_disk_usage_percent)
    echo "$(date '+%Y-%m-%d %H:%M:%S') | $WORKTREE | $PROVIDER/$MODEL_ID | thinking=$THINKING"
    echo "disk: ${DISK_USAGE}% | target/: $TARGET_SIZE"
    echo ""

    PI_OUTPUT=$(
        cd "$WORKTREE_DIR"
        pi -p \
            --provider "$PROVIDER" \
            --model "$MODEL_ID" \
            --thinking "$THINKING" \
            --no-extensions \
            -e "$RALPH_EXT" \
            --session-dir "$SESSION_DIR" \
            @"$PROMPT_FILE"
    )

    # Print stats after pi's final output
    STATS_FILE="$WORKTREE_DIR/.ralph-stats"
    if [ -f "$STATS_FILE" ]; then
        echo ""
        cat "$STATS_FILE"
        rm -f "$STATS_FILE"
    fi
    echo "======================== ITERATION $ITERATION COMPLETE ========================"
    echo ""

    # Check if plan is complete
    if echo "$PI_OUTPUT" | grep -q "PLAN_COMPLETE"; then
        echo "🎉 All milestones complete!"
        break
    fi
done
