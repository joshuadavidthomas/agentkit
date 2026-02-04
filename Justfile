set dotenv-load := true
set shell := ["bash", "-euo", "pipefail", "-c"]
set unstable := true

# List all available commands
[private]
default:
    @just --list --list-submodules

# Install everything (skills, agents, extensions)
install:
    ./install.sh

# Update pi-subagents from upstream
pi-subagents-update:
    git subtree pull --prefix=runtimes/pi/extensions/pi-subagents \
        https://github.com/nicobailon/pi-subagents.git main --squash
