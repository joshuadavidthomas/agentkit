#!/usr/bin/env bash

set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"

# Unified skills directory
SKILLS_DIR="$HOME/.agents/skills"

# Install skills
mkdir -p "$SKILLS_DIR"
for skill in "$REPO_DIR/skills/"*/; do
    [[ -d "$skill" ]] || continue
    skill_name=$(basename "$skill")
    ln -sfn "$skill" "$SKILLS_DIR/$skill_name"
    echo "Linked $skill_name -> $SKILLS_DIR/"
done

# Install agents (transform from superset format to harness-specific)
AGENTS_SRC="$REPO_DIR/agents"
TRANSFORM="$REPO_DIR/scripts/transform-agent.ts"
OPENCODE_AGENTS_DIR="$HOME/.config/opencode/agents"
PI_AGENTS_DIR="$HOME/.pi/agent/agents"

if [[ -d "$AGENTS_SRC" ]]; then
    mkdir -p "$OPENCODE_AGENTS_DIR" "$PI_AGENTS_DIR"

    for agent in "$AGENTS_SRC"/*.md; do
        [[ -f "$agent" ]] || continue
        name=$(basename "$agent")
        [[ "$name" == "README.md" ]] && continue

        bun run "$TRANSFORM" "$agent" opencode >"$OPENCODE_AGENTS_DIR/$name"
        bun run "$TRANSFORM" "$agent" pi >"$PI_AGENTS_DIR/$name"
        echo "Installed agent: $name"
    done
fi

# Pi extensions
PI_EXTENSIONS_DIR="$HOME/.pi/agent/extensions"
PI_EXTENSIONS_SRC="$REPO_DIR/runtimes/pi/extensions"

if [[ -d "$PI_EXTENSIONS_SRC" ]]; then
    mkdir -p "$PI_EXTENSIONS_DIR"
    for ext in "$PI_EXTENSIONS_SRC"/*; do
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
