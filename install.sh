#!/usr/bin/env bash

set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"

# Skill directories for each runtime
SKILL_TARGETS=(
    "$HOME/.claude/skills"         # Claude Code
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

# dcg config and packs
DCG_DIR="$HOME/.config/dcg"
DCG_SRC="$REPO_DIR/dcg"

if [[ -d "$DCG_SRC" ]]; then
    mkdir -p "$DCG_DIR/packs"

    # Config
    if [[ -f "$DCG_SRC/config.toml" ]]; then
        ln -sfn "$DCG_SRC/config.toml" "$DCG_DIR/config.toml"
        echo "Linked config.toml -> $DCG_DIR/"
    fi

    # Packs
    for pack in "$DCG_SRC"/*.yaml; do
        [[ -e "$pack" ]] || continue
        pack_name=$(basename "$pack")
        ln -sfn "$pack" "$DCG_DIR/packs/$pack_name"
        echo "Linked $pack_name -> $DCG_DIR/packs/"
    done
fi
