---
name: clawd-throttle
description: Routes LLM requests to the cheapest capable model across 8 providers (Anthropic, Google, OpenAI, DeepSeek, xAI, Moonshot, Mistral, Ollama) and 25+ models. Scores prompts on 11 dimensions with confidence calibration, supports three routing modes (eco, standard, gigachad), rate-limit awareness, request deduplication, session model pinning, and logs all decisions for cost tracking.
homepage: https://github.com/liekzejaws/clawd-throttle
metadata: {"clawdbot":{"emoji":"\uD83C\uDFCE\uFE0F","requires":{"bins":["node"],"env":["ANTHROPIC_API_KEY","GOOGLE_AI_API_KEY"],"optionalEnv":["XAI_API_KEY","OPENAI_API_KEY","DEEPSEEK_API_KEY","MOONSHOT_API_KEY","MISTRAL_API_KEY"]},"install":[{"id":"clawd-throttle","kind":"node","script":"scripts/setup.ps1","label":"Setup Clawd Throttle (API keys + routing mode)"}]}}
---

# Clawd Throttle

Route every LLM request to the cheapest model that can handle it. Stop
paying Opus prices for "hello" and "summarize this."

Supports **8 providers** and **25+ models**: Anthropic (Claude), Google
(Gemini), OpenAI (GPT / o-series), xAI (Grok), DeepSeek, Moonshot (Kimi),
Mistral, and Ollama (local).

## How It Works

1. Your prompt arrives
2. The classifier scores it on 11 dimensions (token count, code presence,
   reasoning markers, simplicity indicators, multi-step patterns, question
   count, system prompt complexity, conversation depth, agentic task detection,
   technical terms, constraint count) with sigmoid confidence calibration
3. The router maps the resulting tier (simple / standard / complex) to a
   model based on your active mode, configured providers, and confidence level
4. Session pinning keeps the same model within a conversation (never downgrades)
5. Request deduplication prevents duplicate billing on retries
6. Rate-limited providers are automatically skipped for 60 seconds
7. The request is proxied to the correct API
8. The routing decision and cost are logged to a local JSONL file

## Routing Modes

| Mode | Simple | Standard | Complex |
|------|--------|----------|---------|
| **eco** | Grok 4.1 Fast | Gemini Flash | Haiku |
| **standard** | Grok 4.1 Fast | Haiku | Sonnet |
| **gigachad** | Haiku | Sonnet | Opus 4.6 |

Each cell shows the first-choice model. The router tries a preference list
and falls through to the next available provider if the first is not
configured.

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
- Type `/opus`, `/sonnet`, `/haiku`, `/flash`, or `/grok-fast` to force a specific model
- Tool-calling requests get a minimum tier floor of 'standard'
- Sub-agent calls automatically step down one tier from their parent
- Low-confidence classifications (< 0.70) step up one tier automatically

## v2.1 Features

- **Confidence calibration**: Sigmoid distance-from-boundary scoring. Near-boundary
  classifications get low confidence and step up to a better model when unsure.
- **Rate-limit awareness**: Automatic 60-second cooldown when a provider returns 429.
  The router skips rate-limited models and falls through to alternatives.
- **Request deduplication**: SHA-256 hashing of canonical request body with 30-second
  TTL cache. Retried requests return cached responses instead of double-billing.
- **Session pinning**: Send `X-Session-ID` header to pin a model for the conversation.
  Never downgrades within a session; upgrades when complexity increases.
- **SSE heartbeat**: Prevents client/proxy timeouts during slow-starting reasoning models.

## Setup

1. Get at least one API key (Anthropic or Google required; others optional):
   - Anthropic: https://console.anthropic.com/settings/keys
   - Google AI: https://aistudio.google.com/app/apikey
   - xAI: https://console.x.ai
   - OpenAI: https://platform.openai.com/api-keys
   - DeepSeek: https://platform.deepseek.com
   - Moonshot: https://platform.moonshot.cn
   - Mistral: https://console.mistral.ai
2. Run the setup script:
   ```
   npm run setup
   ```
3. Choose your routing mode (eco / standard / gigachad)

## Privacy

- Prompt content is never stored. Only a SHA-256 hash is logged.
- All data stays local in ~/.config/clawd-throttle/
- API keys stored in your local config file
