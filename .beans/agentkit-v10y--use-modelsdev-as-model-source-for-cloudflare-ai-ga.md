---
# agentkit-v10y
title: Use models.dev as model source for cloudflare-ai-gateway provider
status: completed
type: feature
priority: normal
created_at: 2026-02-12T16:20:27Z
updated_at: 2026-02-12T16:24:00Z
---

Replace hardcoded model definitions in the cloudflare-ai-gateway provider with data from models.dev (https://models.dev/api.json), the same source OpenCode uses.

Previously hardcoded 6 models; now sources 65 from models.dev.

## Approach

Three-layer model resolution: runtime fetch → disk cache → embedded snapshot.

1. Fetch from `https://models.dev/api.json` at startup (async, non-blocking)
2. Cache extracted cloudflare-ai-gateway models to `~/.cache/pi/cloudflare-ai-gateway-models.json`
3. Embedded snapshot as fallback for offline/first-run
4. Transform models.dev schema to pi's ProviderModelConfig format

## Checklist

- [x] Create models.ts with fetch, cache, transform, and snapshot logic
- [x] Update index.ts to use dynamic model loading
- [x] Remove hardcoded MODELS array
- [x] Update test.ts to use dynamic models
- [x] Update README description