---
# agentkit-leyc
title: Add JSON config file support for ZAI provider API keys
status: completed
type: feature
priority: normal
created_at: 2026-02-12T15:55:42Z
updated_at: 2026-02-12T15:56:46Z
---

Add support for setting CEREBRAS_API_KEY and ZAI_API_KEY in a JSON config file (~/.pi/agent/zai.json), matching the pattern used by the cloudflare-ai-gateway provider.

Currently the ZAI provider only reads API keys from environment variables. This adds a config file as an additional (higher-priority) source.

## Config file format

```json
{
  "cerebrasApiKey": "your-cerebras-key",
  "zaiApiKey": "your-zai-key"
}
```

## Checklist

- [x] Add ZaiConfig interface and config loading to config.ts
- [x] Update resolveProviderApiKey to check config file first, then env vars
- [x] Update index.ts doc comment with config file instructions
- [x] Update README description