---
# agentkit-a79z
title: Fix model picker current-model matching to include provider
status: in-progress
type: bug
priority: normal
created_at: 2026-02-06T16:27:28Z
updated_at: 2026-02-06T16:30:04Z
---

In the /agents model picker, the isCurrentModel function matches only on model ID, ignoring the provider. This causes all providers with the same model ID (e.g. gpt-5.2-codex from github-copilot, openai-codex, opencode) to show a checkmark when only the matching provider should be checked.

The fix: when currentModel has a provider/ prefix, also fuzzy-match the provider name so only the correct provider+model combination gets the checkmark.