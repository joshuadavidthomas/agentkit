---
# agentkit-v8xu
title: Fix model string parsing to split provider/model for pi CLI
status: completed
type: bug
priority: normal
created_at: 2026-02-06T16:22:18Z
updated_at: 2026-02-06T16:22:55Z
---

The execution.ts file passes model strings like 'openai/gpt-5.1-codex' directly to '--model', but pi CLI expects separate '--provider' and '--model' flags. Need to split 'provider/model-id' format into '--provider provider --model model-id' when the string contains a '/'.