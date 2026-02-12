# Cloudflare AI Gateway Provider Extension

A custom provider extension for pi coding agent that routes requests through [Cloudflare AI Gateway](https://developers.cloudflare.com/ai-gateway/).

## Features

- **OpenAI-compatible endpoint** - Uses Cloudflare's `/compat/chat/completions` endpoint
- **Multiple upstream providers** - Access OpenAI, Anthropic, Workers AI, and more through a single gateway
- **Dynamic routing** - Configure fallbacks, rate limits, and A/B tests in the Cloudflare dashboard
- **Caching** - Automatic response caching for faster requests and cost savings
- **Unified billing** - Option to use Cloudflare's unified billing or BYOK (Bring Your Own Key)
- **Dedicated config file** - Store gateway configuration in `~/.pi/agent/cloudflare-ai-gateway.json`
- **Flexible auth** - API key can be set via `auth.json`, environment variable, or omitted for BYOK

## Setup

### 1. Create Cloudflare AI Gateway

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. Select your account
3. Go to **AI** > **AI Gateway**
4. Click **Create Gateway**
5. Enter a gateway name (max 64 characters)

### 2. Get Account ID

From the [Cloudflare Dashboard](https://dash.cloudflare.com/), find your Account ID in the right sidebar.

### 3. Create Config File

Create `~/.pi/agent/cloudflare-ai-gateway.json` with your account ID and gateway name:

```json
{
  "accountId": "your-account-id",
  "gatewayName": "your-gateway-name"
}
```

### 4. Configure Authentication

Choose one authentication method:

#### Option A: Cloudflare API Token (Authenticated Gateway)

Create a Cloudflare API token with permissions:
- `AI Gateway - Read`
- `AI Gateway - Edit`

Then add to `~/.pi/agent/auth.json`:

```json
{
  "cloudflare-ai-gateway": {
    "type": "api_key",
    "key": "your-cloudflare-api-token"
  }
}
```

Or set environment variable:
```bash
export CLOUDFLARE_AI_GATEWAY_TOKEN=your-cloudflare-api-token
```

#### Option B: BYOK (Store keys in Cloudflare)

Store your upstream provider API keys in the Cloudflare AI Gateway dashboard (OpenAI, Anthropic, etc.). No local API key needed.

#### Option C: Request Headers (Provider keys)

Pass upstream provider keys in request headers. Set via environment variables:
```bash
export OPENAI_API_KEY=sk-...
export ANTHROPIC_API_KEY=sk-ant-...
```

## Configuration Summary

| File | Purpose |
|------|---------|
| `~/.pi/agent/cloudflare-ai-gateway.json` | Gateway configuration (accountId, gatewayName) |
| `~/.pi/agent/auth.json` | API key for authenticated gateway (optional) |
| Environment variables | Override any config value |

### Environment Variables

All config values can be set via environment variables (takes precedence over config files):

```bash
export CLOUDFLARE_ACCOUNT_ID=your-account-id
export CLOUDFLARE_AI_GATEWAY_NAME=your-gateway-name
export CLOUDFLARE_AI_GATEWAY_TOKEN=your-token  # optional
```

## Usage

### Run pi with the extension

```bash
# From pi-mono root
pi -e ./packages/coding-agent/examples/extensions/custom-provider-cloudflare-ai-gateway
```

### Select a model

```
/model cloudflare-ai-gateway/gpt-4o
```

Or specify at startup:

```bash
pi -e ./packages/coding-agent/examples/extensions/custom-provider-cloudflare-ai-gateway --model cloudflare-ai-gateway/gpt-4o
```

## Available Models

The extension includes models from multiple providers:

### OpenAI (via AI Gateway)
- `gpt-4o` - GPT-4o with vision
- `gpt-4o-mini` - Fast, cost-effective GPT-4o-mini

### Anthropic (via AI Gateway)
- `claude-sonnet-4` - Claude Sonnet 4 with reasoning
- `claude-opus-4` - Claude Opus 4 with reasoning

### Workers AI (Cloudflare's inference platform)
- `@cf/meta/llama-3.3-70b-instruct-fp8-fast` - Llama 3.3 70B
- `@cf/deepseek/deepseek-r1-distill-qwen-32b` - DeepSeek R1 (reasoning model)

**Note:** Edit `index.ts` to add/remove models based on your gateway configuration.

## Cloudflare AI Gateway Features

### Caching
Enable caching in your gateway settings for faster responses and cost savings.

### Dynamic Routing
Configure complex routing scenarios:
- Fallback providers if primary fails
- Rate limiting
- Budget controls
- A/B testing different models

See: [Dynamic Routing docs](https://developers.cloudflare.com/ai-gateway/features/dynamic-routing/)

### Monitoring
View request logs, costs, and performance metrics in the Cloudflare dashboard.

## Customization

### Adding New Models

Edit the `MODELS` array in `index.ts`:

```typescript
{
  id: "your-model-id",  // Must match gateway routing config
  name: "Display Name",
  reasoning: false,     // Set to true if model supports extended thinking
  input: ["text", "image"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 128000,
  maxTokens: 4096
}
```

### Using Provider-Specific Endpoints

If you need provider-specific endpoints instead of the unified OpenAI-compatible one, modify the `baseUrl`:

```typescript
// For Anthropic-specific endpoint:
baseUrl: `https://gateway.ai.cloudflare.com/v1/${CLOUDFLARE_ACCOUNT_ID}/${CLOUDFLARE_AI_GATEWAY_NAME}/anthropic`

// For OpenAI-specific endpoint:
baseUrl: `https://gateway.ai.cloudflare.com/v1/${CLOUDFLARE_ACCOUNT_ID}/${CLOUDFLARE_AI_GATEWAY_NAME}/openai`
```

## Troubleshooting

### "Configuration not found" warning
Ensure `~/.pi/agent/cloudflare-ai-gateway.json` exists with `accountId` and `gatewayName` fields, or set `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_AI_GATEWAY_NAME` environment variables.

### "Unauthorized" errors
- Check that your token has `AI Gateway - Read` and `AI Gateway - Edit` permissions
- Verify the token is set in `auth.json` or the `CLOUDFLARE_AI_GATEWAY_TOKEN` environment variable

### "Model not found" errors
- Ensure the model ID in `index.ts` matches your gateway's routing configuration
- Check that the upstream provider key is stored in Cloudflare (BYOK) or you're using unified billing

### Check gateway logs
View request logs in Cloudflare Dashboard > AI > AI Gateway > [Your Gateway] > Logs

## Resources

- [Cloudflare AI Gateway Docs](https://developers.cloudflare.com/ai-gateway/)
- [Unified API Reference](https://developers.cloudflare.com/ai-gateway/usage/chat-completion/)
- [Dynamic Routing](https://developers.cloudflare.com/ai-gateway/features/dynamic-routing/)
