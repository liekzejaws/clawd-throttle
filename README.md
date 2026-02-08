# Clawd Throttle

Route every LLM request to the cheapest model that can handle it.

Clawd Throttle is an OpenClaw skill (MCP server) and HTTP reverse proxy that classifies prompt complexity in under 1ms and routes to the cheapest capable model across Anthropic and Google APIs.

## Quick Start

```bash
# 1. Clone and install
npm install

# 2. Run setup (prompts for API keys and mode)
npm run setup          # Windows
npm run setup:unix     # macOS/Linux

# 3. Add to your MCP client config
```

```json
{
  "clawd-throttle": {
    "command": "npx",
    "args": ["tsx", "src/index.ts"],
    "cwd": "/path/to/clawd-throttle"
  }
}
```

## HTTP Proxy Mode

Clawd Throttle can run as an HTTP reverse proxy that accepts OpenAI and Anthropic API formats. Any client that can point at a custom base URL works without code changes — just swap the URL.

### Starting the Proxy

```bash
# Via environment variable
CLAWD_THROTTLE_HTTP=true npm start

# Via CLI flag (runs both HTTP + MCP stdio)
npm start -- --http

# HTTP only (no MCP stdio transport)
npm start -- --http-only

# Custom port (default: 8484)
CLAWD_THROTTLE_HTTP_PORT=9090 CLAWD_THROTTLE_HTTP=true npm start
```

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/v1/messages` | Anthropic Messages API format |
| POST | `/v1/chat/completions` | OpenAI Chat Completions format |
| GET | `/health` | Health check with uptime and mode |
| GET | `/stats` | Routing stats (optional `?days=N`, default 30) |

### Examples

**Anthropic format:**
```bash
curl http://localhost:8484/v1/messages \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{"role": "user", "content": "hello"}],
    "max_tokens": 100
  }'
```

**OpenAI format:**
```bash
curl http://localhost:8484/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      {"role": "system", "content": "You are helpful."},
      {"role": "user", "content": "Explain monads in Haskell"}
    ],
    "max_tokens": 1000
  }'
```

**Streaming:**
```bash
curl --no-buffer http://localhost:8484/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{"role": "user", "content": "Write a haiku"}],
    "max_tokens": 100,
    "stream": true
  }'
```

**Force a specific model:**
```bash
curl http://localhost:8484/v1/messages \
  -H "Content-Type: application/json" \
  -H "X-Throttle-Force-Model: opus" \
  -d '{
    "messages": [{"role": "user", "content": "hello"}],
    "max_tokens": 100
  }'
```

**Health check:**
```bash
curl http://localhost:8484/health
# {"status":"ok","mode":"standard","uptime":42.5}
```

**Stats:**
```bash
curl http://localhost:8484/stats?days=7
```

### Response Headers

Every proxied response includes routing metadata headers:

| Header | Description |
|--------|-------------|
| `X-Throttle-Model` | The model that handled the request |
| `X-Throttle-Tier` | Classified tier: simple, standard, or complex |
| `X-Throttle-Score` | Raw classifier score (0.00–1.00) |

### Client Configuration

Point any OpenAI-compatible client at the proxy:

```python
# Python (openai SDK)
import openai
client = openai.OpenAI(base_url="http://localhost:8484/v1", api_key="unused")
response = client.chat.completions.create(
    model="auto",
    messages=[{"role": "user", "content": "hello"}],
)
```

```typescript
// TypeScript (Anthropic SDK)
import Anthropic from '@anthropic-ai/sdk';
const client = new Anthropic({
  baseURL: 'http://localhost:8484',
  apiKey: 'unused',
});
```

## Routing Modes

| Mode | Simple | Standard | Complex |
|------|--------|----------|---------|
| **eco** | Gemini Flash | Gemini Flash | Sonnet |
| **standard** | Gemini Flash | Sonnet | Opus |
| **performance** | Sonnet | Opus | Opus |

## How It Works

1. Prompt arrives via `route_request` MCP tool or HTTP proxy endpoint
2. Classifier scores it on 8 dimensions in <1ms:
   - Token count, code presence, reasoning markers, simplicity indicators
   - Multi-step patterns, question count, system prompt signals, conversation depth
3. Composite score maps to a tier: simple (<=0.30), standard, or complex (>=0.65)
4. Routing table selects model based on active mode + tier
5. Request proxied to Anthropic or Google API
6. Decision logged to JSONL for cost tracking

## MCP Tools

| Tool | Description |
|------|-------------|
| `route_request` | Send prompt to cheapest capable model, get response + routing metadata |
| `classify_prompt` | Analyze complexity without API call (diagnostic) |
| `get_routing_stats` | Cost savings, model distribution, tier breakdown |
| `set_mode` | Change routing mode at runtime |
| `get_config` | View config (keys redacted) |
| `get_recent_routing_log` | Inspect recent routing decisions |

## Overrides

- **Heartbeats/summaries**: "ping", "summarize this" -> always cheapest
- **Force model**: `/opus`, `/sonnet`, `/flash` prefix or `forceModel` parameter
- **Sub-agents**: Pass `parentRequestId` to step down one tier (Opus->Sonnet->Flash)

## CLI Stats

```bash
npm run stats                     # Last 30 days, table format
npm run stats -- -d 7             # Last 7 days
npm run stats -- -f json          # JSON output
```

## Configuration

Config file: `~/.config/clawd-throttle/config.json`

Environment variables override config file:
- `ANTHROPIC_API_KEY` - Anthropic API key
- `GOOGLE_AI_API_KEY` - Google AI API key
- `CLAWD_THROTTLE_MODE` - eco, standard, or performance
- `CLAWD_THROTTLE_LOG_LEVEL` - debug, info, warn, error
- `CLAWD_THROTTLE_HTTP` - set to `true` to enable the HTTP proxy
- `CLAWD_THROTTLE_HTTP_PORT` - HTTP proxy port (default: 8484)

## Requirements

- Node.js 18+
- Anthropic API key (for Claude Sonnet/Opus)
- Google AI API key (for Gemini Flash)

## Privacy

- Prompt content is never stored - only SHA-256 hashes in logs
- All data stays local in `~/.config/clawd-throttle/`
- API keys stored in your local config file

## Development

```bash
npm run dev          # Watch mode
npm test             # Run tests
npm run stats        # View routing stats
```
