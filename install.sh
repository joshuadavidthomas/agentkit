#!/usr/bin/env bash

set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"

# Skill directories for each runtime
SKILL_TARGETS=(
    "$HOME/.claude/skills"        # Claude Code
    "$HOME/.config/opencode/skill" # OpenCode
    "$HOME/.pi/agent/skills"       # Pi
    "$HOME/.codex/skills"          # Codex
)

# Install skills
for target in "${SKILL_TARGETS[@]}"; do
    mkdir -p "$target"
    for skill in "$REPO_DIR/skills/"*/; do
        skill_name=$(basename "$skill")
        ln -sfn "$skill" "$target/$skill_name"
        echo "Linked $skill_name -> $target/"
    done
done

# Pi extensions
PI_EXTENSIONS_DIR="$HOME/.pi/agent/extensions"
PI_EXTENSIONS_SRC="$REPO_DIR/runtimes/pi/extensions"

if [[ -d "$PI_EXTENSIONS_SRC" ]]; then
    mkdir -p "$PI_EXTENSIONS_DIR"
    for ext in "$PI_EXTENSIONS_SRC"/*.ts; do
        [[ -e "$ext" ]] || continue
        ext_name=$(basename "$ext")
        ln -sfn "$ext" "$PI_EXTENSIONS_DIR/$ext_name"
        echo "Linked $ext_name -> $PI_EXTENSIONS_DIR/"
    done
fi
