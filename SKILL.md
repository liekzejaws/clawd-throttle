---
name: clawd-throttle
description: Automatically routes LLM requests to the cheapest capable model based on prompt complexity. Scores prompts on 8 dimensions in under 1ms, supports three routing modes (eco, standard, performance), and logs all decisions for cost tracking. Handles Anthropic (Claude Sonnet/Opus) and Google (Gemini Flash) APIs.
homepage: https://github.com/liekzejaws/clawd-throttle
metadata: {"clawdbot":{"emoji":"\u{1F3CE}\u{FE0F}","requires":{"bins":["node"],"env":["ANTHROPIC_API_KEY","GOOGLE_AI_API_KEY"]},"install":[{"id":"clawd-throttle","kind":"node","script":"scripts/setup.ps1","label":"Setup Clawd Throttle (API keys + routing mode)"}]}}
---

# Clawd Throttle

Route every LLM request to the cheapest model that can handle it. Stop
paying Opus prices for "hello" and "summarize this."

## How It Works

1. Your prompt arrives
2. The classifier scores it on 8 dimensions (token count, code presence,
   reasoning markers, simplicity indicators, multi-step patterns, question
   count, system prompt complexity, conversation depth) in under 1 millisecond
3. The router maps the resulting tier (simple / standard / complex) to a
   model based on your active mode
4. The request is proxied to the correct API (Anthropic or Google)
5. The routing decision and cost are logged to a local JSONL file

## Routing Modes

| Mode | Simple | Standard | Complex |
|------|--------|----------|---------|
| eco | Gemini Flash | Gemini Flash | Sonnet |
| standard | Gemini Flash | Sonnet | Opus |
| performance | Sonnet | Opus | Opus |

## Available Commands

| Command | What It Does |
|---------|-------------|
| `route_request` | Send a prompt and get a response from the cheapest capable model |
| `classify_prompt` | Analyze prompt complexity without making an LLM call |
| `get_routing_stats` | View cost savings and model distribution stats |
| `get_config` | View current configuration (keys redacted) |
| `set_mode` | Change routing mode at runtime |
| `get_recent_routing_log` | Inspect recent routing decisions |

## Overrides

- Heartbeats and summaries always route to the cheapest model
- Type `/opus`, `/sonnet`, or `/flash` to force a specific model
- Sub-agent calls automatically step down one tier from their parent

## Setup

1. Get API keys:
   - Anthropic: https://console.anthropic.com/settings/keys
   - Google AI: https://aistudio.google.com/app/apikey
2. Run the setup script:
   ```
   npm run setup
   ```
3. Choose your routing mode (eco / standard / performance)

## Privacy

- Prompt content is never stored. Only a SHA-256 hash is logged.
- All data stays local in ~/.config/clawd-throttle/
- API keys stored in your local config file
