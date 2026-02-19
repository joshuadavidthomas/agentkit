---
# agentkit-f6y4
title: Usage-aware model selection for scouts
status: in-progress
type: feature
priority: normal
created_at: 2026-02-19T22:43:51Z
updated_at: 2026-02-19T22:43:54Z
---

Integrate vibeusage data into scout model selection so subagents prefer providers with more quota headroom.

## Design

### Data flow
1. `usage-cache.ts` shells out to `vibeusage --json` and caches the parsed result in memory with a 5-minute TTL
2. `model-selection.ts` calls the cache, maps pi provider names to vibeusage provider names, and scores candidates by remaining quota
3. If vibeusage isn't installed, times out, or fails, fall back to current heuristic (zero-cost degradation)

### vibeusage JSON format (multi-provider)
```json
{
  "providers": {
    "claude": {
      "periods": [
        { "name": "Session (5h)", "utilization": 45, "remaining": 55, "period_type": "session" },
        { "name": "All Models", "utilization": 72, "remaining": 28, "period_type": "weekly" }
      ],
      "source": "oauth", "cached": false
    },
    "codex": { ... },
    "gemini": { ... },
    "copilot": { ... }
  },
  "errors": {}
}
```

### Provider name mapping (pi → vibeusage)
- `anthropic` → `claude`
- `openai`, `openai-codex` → `codex`
- `google`, `google-vertex`, `google-antigravity`, `google-gemini-cli` → `gemini`
- `github-copilot` → `copilot`

### Scoring logic
For each available model, look up its provider's usage. Use the tightest (most-utilized) non-session period as the score. Lower utilization = better score. Apply a threshold (e.g., >85% utilization = deprioritize, >95% = skip). Among equally-available providers, prefer the current model preference ordering (cheap/fast models first).

### Files to create/modify
- `pi-extensions/scouts/usage-cache.ts` — new: vibeusage subprocess + in-memory TTL cache
- `pi-extensions/scouts/model-selection.ts` — modify: accept usage data, integrate into selection logic

## Checklist
- [x] Create `usage-cache.ts` with subprocess call + TTL cache
- [x] Add provider name mapping
- [x] Update `model-selection.ts` to accept and use usage data
- [x] Update `scout-core.ts` to await async model selection
- [x] Handle vibeusage-not-installed gracefully (returns null → original heuristic)
- [ ] Test with vibeusage available and unavailable