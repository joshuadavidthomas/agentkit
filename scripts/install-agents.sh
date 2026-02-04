#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_DIR="$SCRIPT_DIR/../agents"
TRANSFORM="$SCRIPT_DIR/transform-agent.ts"

# Default output locations (global)
OPENCODE_DIR="${OPENCODE_DIR:-$HOME/.config/opencode/agents}"
PI_DIR="${PI_DIR:-$HOME/.pi/agent/agents}"

usage() {
  echo "Usage: $0 [--opencode] [--pi] [--all]"
  echo ""
  echo "Options:"
  echo "  --opencode    Install to $OPENCODE_DIR"
  echo "  --pi          Install to $PI_DIR"
  echo "  --all         Install to both (default)"
  echo ""
  echo "Environment variables:"
  echo "  OPENCODE_DIR  Override opencode output dir (default: ~/.config/opencode/agents)"
  echo "  PI_DIR        Override pi output dir (default: ~/.pi/agent/agents)"
  exit 1
}

install_opencode=false
install_pi=false

# Parse args
if [[ $# -eq 0 ]]; then
  install_opencode=true
  install_pi=true
else
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --opencode) install_opencode=true ;;
      --pi) install_pi=true ;;
      --all) install_opencode=true; install_pi=true ;;
      --help|-h) usage ;;
      *) echo "Unknown option: $1"; usage ;;
    esac
    shift
  done
fi

count=0

for file in "$SOURCE_DIR"/*.md; do
  [[ -f "$file" ]] || continue
  name=$(basename "$file")
  
  # Skip README
  [[ "$name" == "README.md" ]] && continue
  
  if $install_opencode; then
    mkdir -p "$OPENCODE_DIR"
    bun run "$TRANSFORM" "$file" opencode > "$OPENCODE_DIR/$name"
    echo "✓ opencode: $name"
  fi
  
  if $install_pi; then
    mkdir -p "$PI_DIR"
    bun run "$TRANSFORM" "$file" pi > "$PI_DIR/$name"
    echo "✓ pi: $name"
  fi
  
  ((count++)) || true
done

echo ""
echo "Installed $count agents"
