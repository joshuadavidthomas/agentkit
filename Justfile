set dotenv-load := true
set shell := ["bash", "-euo", "pipefail", "-c"]
set unstable := true

# List all available commands
[private]
default:
    @just --list --list-submodules

# ------------------------------------------------------------------------------
# Agents
# ------------------------------------------------------------------------------

# Install agents to harness directories (.opencode/agents, .pi/agents)
agents-install *ARGS:
    ./scripts/install-agents.sh {{ ARGS }}

# Install agents to opencode only
agents-install-opencode:
    @just agents-install --opencode

# Install agents to pi only
agents-install-pi:
    @just agents-install --pi

# ------------------------------------------------------------------------------
# Vendored Dependencies (subtrees)
# ------------------------------------------------------------------------------

# Update pi-subagents from upstream
pi-subagents-update:
    git subtree pull --prefix=runtimes/pi/extensions/pi-subagents \
        https://github.com/nicobailon/pi-subagents.git main --squash
