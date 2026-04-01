#!/usr/bin/env bash
#
# Convert compound engineering agents into pi-native skills.
#
# Usage:
#   scripts/convert-compound-engineering.sh          # clone/update + convert
#   scripts/convert-compound-engineering.sh --clean   # remove generated skills
#
# Source repo is cached at $XDG_CACHE_HOME/agentkit/compound-engineering-plugin.
# Generated skills land in skills/compound-engineering/ (symlinked by install.sh).

set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CACHE_DIR="${XDG_CACHE_HOME:-$HOME/.cache}/agentkit"
SOURCE_REPO="https://github.com/EveryInc/compound-engineering-plugin.git"
SOURCE_DIR="$CACHE_DIR/compound-engineering-plugin"
AGENTS_DIR="$SOURCE_DIR/plugins/compound-engineering/agents"
OUTPUT_DIR="$REPO_DIR/skills/compound-engineering"

# Agents to convert (relative to AGENTS_DIR, without .md)
KEEP_AGENTS=(
  "research/repo-research-analyst"
  "research/best-practices-researcher"
  "research/framework-docs-researcher"
  "research/git-history-analyzer"
  "review/architecture-strategist"
  "review/code-simplicity-reviewer"
  "review/security-sentinel"
  "review/performance-oracle"
  "review/pattern-recognition-specialist"
  "review/kieran-python-reviewer"
  "review/kieran-typescript-reviewer"
  "review/julik-frontend-races-reviewer"
  "workflow/bug-reproduction-validator"
  "workflow/spec-flow-analyzer"
  "workflow/pr-comment-resolver"
)

clean() {
  if [[ -d "$OUTPUT_DIR" ]]; then
    rm -rf "$OUTPUT_DIR"
    echo "Removed $OUTPUT_DIR"
  fi
  # Remove symlink installed by install.sh
  local skills_dir="$HOME/.agents/skills"
  if [[ -L "$skills_dir/compound-engineering" ]]; then
    rm "$skills_dir/compound-engineering"
    echo "Removed symlink: $skills_dir/compound-engineering"
  fi
  echo "Clean complete."
}

clone_or_update() {
  mkdir -p "$CACHE_DIR"
  if [[ -d "$SOURCE_DIR/.git" ]]; then
    echo "Updating source repo..."
    git -C "$SOURCE_DIR" pull --ff-only --quiet 2>/dev/null || true
  else
    echo "Cloning source repo..."
    git clone --quiet "$SOURCE_REPO" "$SOURCE_DIR"
  fi
}

# Strip YAML frontmatter and <examples> block, return body text
extract_body() {
  local file="$1"
  awk '
    BEGIN { in_front=0; in_examples=0; past_front=0 }
    /^---$/ && !past_front { in_front = !in_front; if (!in_front) past_front=1; next }
    in_front { next }
    /^<examples>/ { in_examples=1; next }
    /^<\/examples>/ { in_examples=0; next }
    in_examples { next }
    past_front { print }
  ' "$file" | sed '/./,$!d'
}

# Read a frontmatter field from a file
read_frontmatter() {
  local file="$1" field="$2"
  awk -v field="$field" '
    BEGIN { in_front=0 }
    /^---$/ { in_front = !in_front; next }
    in_front && $0 ~ "^"field":" {
      sub("^"field":[ ]*", "")
      gsub(/^["'\'']|["'\'']$/, "")
      print
      exit
    }
  ' "$file"
}

# Apply content transformations for pi compatibility
transform_body() {
  local body="$1"
  # Remove "Note: The current year is 2026" lines (pi handles this)
  body=$(echo "$body" | sed '/^\*\*Note: The current year is 2026\.\*\*/d')
  # Replace Context7 references with librarian scout
  body=$(echo "$body" | sed 's/Context7 MCP/the librarian scout/g; s/Context7/the librarian scout/g; s/Use Context7/Use the librarian scout/g; s/use Context7/use the librarian scout/g')
  # Replace "use the Task tool to launch" with "use"
  body=$(echo "$body" | sed 's/use the Task tool to launch //g; s/Use the Task tool to launch //g')
  # Replace Claude Code-specific tool references
  body=$(echo "$body" | sed 's/Grep tool/rg/g; s/Glob tool/fd/g; s/the built-in Grep tool (or `ast-grep`/rg (or `ast-grep`/g')
  # Remove CLAUDE.md references (pi uses AGENTS.md)
  body=$(echo "$body" | sed 's/CLAUDE\.md/AGENTS.md/g')
  # Remove "use the X agent" phrasing
  body=$(echo "$body" | sed 's/use the [a-z-]*-agent //g')
  # Remove compound-engineering-specific artifact references
  body=$(echo "$body" | sed '/docs\/plans\/\*\.md.*docs\/solutions\/\*\.md.*compound-engineering/d')
  body=$(echo "$body" | sed '/compound-engineering pipeline artifacts/d')
  # Remove "bundle show" Ruby-specific instructions
  body=$(echo "$body" | sed '/bundle show/d')
  echo "$body"
}

convert_agent() {
  local agent_path="$1"
  local agent_file="$AGENTS_DIR/$agent_path.md"

  if [[ ! -f "$agent_file" ]]; then
    echo "  WARNING: $agent_file not found, skipping"
    return
  fi

  local name description
  name=$(read_frontmatter "$agent_file" "name")
  description=$(read_frontmatter "$agent_file" "description")

  local skill_name="$name"
  local skill_dir="$OUTPUT_DIR/$skill_name"

  mkdir -p "$skill_dir"

  # Extract and transform body
  local body
  body=$(extract_body "$agent_file")
  body=$(transform_body "$body")

  # Write SKILL.md
  cat > "$skill_dir/SKILL.md" << SKILLEOF
---
name: $skill_name
description: $description
---

$body
SKILLEOF

  echo "  Converted: $name → $skill_name"
}

convert_all() {
  echo "Converting agents to pi skills..."
  mkdir -p "$OUTPUT_DIR"

  for agent in "${KEEP_AGENTS[@]}"; do
    convert_agent "$agent"
  done

  echo ""
  echo "Converted ${#KEEP_AGENTS[@]} agents to $OUTPUT_DIR"
  echo "Run install.sh to symlink into ~/.agents/skills/"
}

# Main
case "${1:-}" in
  --clean)
    clean
    ;;
  *)
    clone_or_update
    convert_all
    ;;
esac
