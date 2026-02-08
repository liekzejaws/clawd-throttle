# Clawd Throttle

Route every LLM request to the cheapest model that can handle it.

Clawd Throttle is an OpenClaw skill (MCP server) that classifies prompt complexity in under 1ms and routes to the cheapest capable model across Anthropic and Google APIs.

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

## Routing Modes

| Mode | Simple | Standard | Complex |
|------|--------|----------|---------|
| **eco** | Gemini Flash | Gemini Flash | Sonnet |
| **standard** | Gemini Flash | Sonnet | Opus |
| **performance** | Sonnet | Opus | Opus |

## How It Works

1. Prompt arrives via `route_request` MCP tool
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
