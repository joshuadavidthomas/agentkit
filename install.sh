#!/usr/bin/env bash

set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"

# Convert compound engineering agents to pi skills (generates skills/compound-engineering/)
if [[ -x "$REPO_DIR/scripts/convert-compound-engineering.sh" ]]; then
    bash "$REPO_DIR/scripts/convert-compound-engineering.sh"
fi

# Unified skills directory
SKILLS_DIR="$HOME/.agents/skills"

# Install skills
mkdir -p "$SKILLS_DIR"

# Remove stale links from this repo (skills removed or renamed since last install)
for existing in "$SKILLS_DIR"/*; do
    [[ -L "$existing" ]] || continue
    target=$(readlink "$existing")
    [[ "$target" == "$REPO_DIR/skills/"* ]] || continue

    skill_name=$(basename "$existing")
    if [[ ! -d "$REPO_DIR/skills/$skill_name" ]]; then
        rm "$existing"
        echo "Removed stale skill link: $skill_name"
    fi
done

for skill in "$REPO_DIR/skills"/*; do
    [[ -d "$skill" ]] || continue
    skill_name=$(basename "$skill")
    ln -sfn "$skill" "$SKILLS_DIR/$skill_name"
    echo "Linked $skill_name -> $SKILLS_DIR/"
done

# Clean up retired agent files (replaced by scouts extension)
PI_AGENTS_DIR="$HOME/.pi/agent/agents"
RETIRED_AGENTS="code-analyzer.md code-locator.md code-pattern-finder.md web-searcher.md"
if [[ -d "$PI_AGENTS_DIR" ]]; then
    for retired in $RETIRED_AGENTS; do
        if [[ -f "$PI_AGENTS_DIR/$retired" ]]; then
            rm "$PI_AGENTS_DIR/$retired"
            echo "Removed retired agent: $retired"
        fi
    done
fi

# Pi prompt templates
PI_PROMPTS_DIR="$HOME/.pi/agent/prompts"
PI_PROMPTS_SRC="$REPO_DIR/pi-prompts"

if [[ -d "$PI_PROMPTS_SRC" ]]; then
    mkdir -p "$PI_PROMPTS_DIR"

    # Remove stale prompt links from this repo
    for existing in "$PI_PROMPTS_DIR"/*; do
        [[ -L "$existing" ]] || continue
        target=$(readlink "$existing")
        [[ "$target" == "$PI_PROMPTS_SRC/"* ]] || continue

        prompt_name=$(basename "$existing")
        if [[ ! -f "$PI_PROMPTS_SRC/$prompt_name" ]]; then
            rm "$existing"
            echo "Removed stale prompt link: $prompt_name"
        fi
    done

    for prompt in "$PI_PROMPTS_SRC"/*.md; do
        [[ -e "$prompt" ]] || continue
        prompt_name=$(basename "$prompt")
        ln -sfn "$prompt" "$PI_PROMPTS_DIR/$prompt_name"
        echo "Linked $prompt_name -> $PI_PROMPTS_DIR/"
    done
fi

# Pi extensions
PI_EXTENSIONS_DIR="$HOME/.pi/agent/extensions"
PI_EXTENSIONS_SRC="$REPO_DIR/pi-extensions"

# Extensions to skip (retired in favor of scouts)
SKIP_EXTENSIONS="pi-subagents"

if [[ -d "$PI_EXTENSIONS_SRC" ]]; then
    mkdir -p "$PI_EXTENSIONS_DIR"
    for ext in "$PI_EXTENSIONS_SRC"/*; do
        [[ -e "$ext" ]] || continue
        ext_name=$(basename "$ext")
        if echo "$SKIP_EXTENSIONS" | grep -qw "$ext_name"; then
            # Remove stale symlink if it exists
            if [[ -L "$PI_EXTENSIONS_DIR/$ext_name" ]]; then
                rm "$PI_EXTENSIONS_DIR/$ext_name"
                echo "Removed retired extension: $ext_name"
            fi
            continue
        fi
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
