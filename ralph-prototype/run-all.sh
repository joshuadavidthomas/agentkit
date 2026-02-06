#!/bin/bash
set -euo pipefail

# Launch all 5 experiment loops in tmux panes
# Usage: ./run-all.sh [max_iterations]

MAX="${1:-0}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SESSION="djls-eval"

tmux kill-session -t "$SESSION" 2>/dev/null || true

tmux new-session -d -s "$SESSION" -n "evals" \
    "$SCRIPT_DIR/loop.sh detailed-opus-4.6 $MAX"

tmux split-window -t "$SESSION" -h \
    "$SCRIPT_DIR/loop.sh detailed-gpt-5.3-codex $MAX"

tmux split-window -t "$SESSION" -v \
    "$SCRIPT_DIR/loop.sh detailed-kimi-k2.5 $MAX"

tmux select-pane -t "$SESSION":0.0
tmux split-window -t "$SESSION" -v \
    "$SCRIPT_DIR/loop.sh intent-opus-4.6 $MAX"

tmux select-pane -t "$SESSION":0.2
tmux split-window -t "$SESSION" -v \
    "$SCRIPT_DIR/loop.sh intent-gpt-5.3-codex $MAX"

tmux select-layout -t "$SESSION" tiled

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "All 5 experiments launched in tmux: $SESSION"
echo ""
echo "  tmux attach -t $SESSION"
echo "  tmux kill-session -t $SESSION"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
