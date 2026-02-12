# Custom Provider: ZAI

A custom provider extension that exposes ZAI-family models from two upstream hosts:

- **Cerebras-hosted models** (requires `CEREBRAS_API_KEY`)
- **ZAI-hosted models** (requires `ZAI_API_KEY`)

Model availability is determined strictly by which provider API keys are present.

## Features

- **Key-based model availability**
  - `CEREBRAS_API_KEY` => Cerebras model set
  - `ZAI_API_KEY` => ZAI model set
  - Both keys => both model sets
- **Model-driven endpoint routing**
  - `zai-custom/<model-id>` is enough to choose the right base URL and API key
- **Reasoning + sampling knobs**
  - Supports `temperature`, `top_p`, and `clear_thinking`

## Configuration

### API Keys

API keys can be set via a JSON config file or environment variables. The config file takes precedence.

**Config file** (`~/.pi/agent/zai.json`):

```json
{
  "cerebrasApiKey": "your-cerebras-key",
  "zaiApiKey": "your-zai-key"
}
```

**Environment variables** (fallback):

| Variable           | Description                         |
|--------------------|-------------------------------------|
| `CEREBRAS_API_KEY` | Required for Cerebras-hosted models |
| `ZAI_API_KEY`      | Required for ZAI-hosted models      |

### Sampling Knobs

| Variable                       | Description              | Default |
|--------------------------------|--------------------------|---------|
| `PI_TEMPERATURE`               | Generic temperature      | 0.9     |
| `PI_ZAI_CUSTOM_TOP_P`          | Top-p sampling parameter | 0.95    |
| `PI_ZAI_CUSTOM_CLEAR_THINKING` | Clear thinking output    | false   |

These can also be passed as runtime options: `temperature`, `top_p` / `topP`, `clear_thinking` / `clearThinking`.

## Usage

The provider is registered as `zai-custom`.

```bash
# Option 1: Config file (create ~/.pi/agent/zai.json as above)

# Option 2: Environment variables
export CEREBRAS_API_KEY="your-cerebras-key"
export ZAI_API_KEY="your-zai-key"
```

## Model IDs (use these with `zai-custom/<model-id>`)

| model_id      | Hosted by | Enabled when key is present | Example selector           |
|---------------|-----------|-----------------------------|----------------------------|
| `zai-glm-4.7` | Cerebras  | `CEREBRAS_API_KEY`          | `zai-custom/zai-glm-4.7`   |
| `glm-4.7`     | ZAI       | `ZAI_API_KEY`               | `zai-custom/glm-4.7`       |
| `glm-5`       | ZAI       | `ZAI_API_KEY`               | `zai-custom/glm-5`         |

## Model Matrix

### Cerebras-hosted

**GLM-4.7 Cerebras** (`zai-glm-4.7`)
- Endpoint: `https://api.cerebras.ai/v1`
- Reasoning: false
- Context Window: 131,072 tokens
- Max Output: 40,000 tokens
- Input Cost: $0.00 / 1M tokens
- Output Cost: $0.00 / 1M tokens
- Cache Read: $0.00 / 1M tokens

### ZAI-hosted

**GLM 4.7 ZAI** (`glm-4.7`)
- Endpoint: `https://api.z.ai/api/coding/paas/v4`
- Reasoning: true
- Context Window: 204,800 tokens
- Max Output: 131,072 tokens
- Input Cost: $0.60 / 1M tokens
- Output Cost: $2.20 / 1M tokens
- Cache Read: $0.11 / 1M tokens

**GLM-5 (ZAI)** (`glm-5`)
- Endpoint: `https://api.z.ai/api/coding/paas/v4`
- Reasoning: true
- Context Window: 200,000 tokens
- Max Output: 128,000 tokens
- Input Cost: $0.15 / 1M tokens
- Output Cost: $0.60 / 1M tokens
- Cache Read: $0.00 / 1M tokens
