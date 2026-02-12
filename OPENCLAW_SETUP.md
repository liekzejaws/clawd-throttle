# Setting Up Clawd-Throttle with OpenClaw

This guide walks through integrating clawd-throttle v2.2.0+ with OpenClaw to route all LLM requests through intelligent cost optimization.

## Overview

Clawd-throttle runs as an **HTTP reverse proxy** that OpenClaw routes Anthropic API calls through. It analyzes prompt complexity and selects the cheapest capable model from multiple providers (Anthropic, Google, xAI, DeepSeek, etc.).

**Architecture:**
```
OpenClaw → ANTHROPIC_BASE_URL → clawd-throttle HTTP proxy → LLM providers
```

## Prerequisites

- OpenClaw installed and configured
- Node.js 18+ (`node --version`)
- At least one LLM provider API key
- Root/sudo access (for systemd service setup)

## Step 1: Install Clawd-Throttle

```bash
# Clone or install as an OpenClaw skill
cd /root/clawd/skills  # or your OpenClaw workspace/skills directory
git clone https://github.com/liekzejaws/clawd-throttle.git
cd clawd-throttle

# Install dependencies
npm install
```

## Step 2: Configure API Keys

Create config file:

```bash
mkdir -p ~/.config/clawd-throttle
cat > ~/.config/clawd-throttle/config.json << 'EOF'
{
  "mode": "gigachad",
  "anthropic": {
    "setupToken": "sk-ant-oat01-...",
    "apiKey": "sk-ant-api03-...",
    "preferSetupToken": true
  },
  "google": {
    "apiKey": "AIzaSy..."
  },
  "xai": {
    "apiKey": "xai-..."
  }
}
EOF
```

### Dual-Key Anthropic Setup (Recommended)

Clawd-throttle v2.2+ supports **dual-key failover** for Anthropic:
- **Setup token** (`sk-ant-oat01-...`): Free tier from Claude Max subscription (~547 req/day limit)
- **Enterprise API key** (`sk-ant-api03-...`): Paid fallback for when setup-token is rate-limited

When `preferSetupToken: true`, throttle tries the setup-token first and automatically falls back to the enterprise key on 429/401 errors.

**To get keys:**
- Setup token: Run `claude setup-token` in terminal (requires Claude Code/OpenCode installed)
- Enterprise API key: Purchase credits at console.anthropic.com ($10-20 minimum recommended)

### Minimal Config (Google-only)

```json
{
  "mode": "eco",
  "google": {
    "apiKey": "AIzaSy..."
  }
}
```

### Routing Modes

| Mode | Description | Use Case |
|------|-------------|----------|
| `eco` | Cheapest models (Flash, DeepSeek, Ollama) | Heartbeats, simple tasks, high volume |
| `standard` | Balanced (Haiku, Kimi, Sonnet for complex) | General conversation |
| `gigachad` | Premium (Sonnet, Opus, o3) | Main agent, complex reasoning |

## Step 3: Create Systemd Service

**⚠️ CRITICAL:** Run throttle as a systemd service so it starts on boot and restarts on crashes.

Create `/etc/systemd/system/clawd-throttle-http.service`:

```ini
[Unit]
Description=Clawd Throttle HTTP proxy (LLM routing)
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/root/clawd/skills/clawd-throttle
ExecStart=/usr/bin/npx tsx src/index.ts --http
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
Environment="NODE_ENV=production"

[Install]
WantedBy=multi-user.target
```

**Adjust paths:**
- `WorkingDirectory`: Path to your clawd-throttle installation
- `User`: Your OpenClaw user (typically `root` on VPS)

Enable and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable clawd-throttle-http
sudo systemctl start clawd-throttle-http

# Verify it's running
systemctl status clawd-throttle-http
curl -s http://127.0.0.1:8484/health
```

Expected output:
```json
{"status":"ok","mode":"gigachad","uptime":12}
```

## Step 4: Configure OpenClaw

Edit `~/.openclaw/openclaw.json`:

### Add Environment Variable

```json
{
  "env": {
    "vars": {
      "ANTHROPIC_BASE_URL": "http://127.0.0.1:8484"
    }
  }
}
```

This tells OpenClaw's Anthropic provider to route through the throttle proxy on port 8484.

### Enable Skill (Optional)

```json
{
  "skills": {
    "entries": {
      "clawd-throttle": {
        "enabled": true
      }
    }
  }
}
```

This makes the throttle skill's SKILL.md available to the agent for context.

### ⚠️ DO NOT Add MCP Auth Profile

**WRONG (breaks OpenClaw):**
```json
{
  "auth": {
    "profiles": {
      "throttle:default": {
        "provider": "mcp",
        "serverName": "clawd-throttle",
        ...
      }
    }
  }
}
```

**Why this breaks:** OpenClaw's `auth.profiles` schema only supports real auth providers (`anthropic`, `google`, etc.) with specific auth modes (`token`, `oauth`, `api_key`). Adding MCP server config here causes validation errors and crashes the gateway.

**Correct approach:** Use `ANTHROPIC_BASE_URL` env var (HTTP proxy) as shown above.

## Step 5: Restart OpenClaw

Environment variables are only loaded at startup:

```bash
openclaw gateway stop
openclaw gateway start

# Or if using systemd:
sudo systemctl restart openclaw
```

## Step 6: Verify Routing

### Test the Proxy Directly

```bash
curl http://127.0.0.1:8484/v1/messages \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{"role": "user", "content": "Say hello"}],
    "max_tokens": 20
  }'
```

### Check Routing Logs

```bash
tail -f ~/.config/clawd-throttle/routing.jsonl
```

Each request logs:
- `selectedModel`: Which model was chosen
- `tier`: simple/standard/complex
- `compositeScore`: Classifier confidence (0.00-1.00)
- `estimatedCostUsd`: Incremental cost
- `latencyMs`: Response time

### View Stats

```bash
curl -s http://127.0.0.1:8484/stats | jq
```

Example output:
```json
{
  "totalRequests": 247,
  "totalCostUsd": 0.52,
  "costIfAlwaysPremium": 18.45,
  "estimatedSavingsUsd": 17.93,
  "savingsPercent": 97.2,
  "modelDistribution": {
    "gemini-2.5-flash": {"count": 189, "costUsd": 0.08},
    "claude-sonnet-4-5": {"count": 51, "costUsd": 0.41},
    "grok-3": {"count": 7, "costUsd": 0.03}
  }
}
```

## Common Issues

### 1. OpenClaw Not Using Proxy

**Symptom:** No new entries in `routing.jsonl`

**Fix:** Ensure OpenClaw was restarted after adding `ANTHROPIC_BASE_URL`. Environment variables don't update in running processes.

```bash
# Check if env var is set in running process
ps aux | grep openclaw
cat /proc/$(pgrep -f openclaw)/environ | tr '\0' '\n' | grep ANTHROPIC
```

### 2. Throttle Service Not Starting

**Symptom:** `systemctl status clawd-throttle-http` shows `failed`

**Debug:**
```bash
journalctl -u clawd-throttle-http -n 50
```

Common causes:
- Missing dependencies: Run `npm install` in throttle directory
- Wrong `WorkingDirectory` in service file
- Port 8484 already in use: `netstat -tlnp | grep 8484`

### 3. Rate Limiting on Setup Token

**Symptom:** Logs show many 429 errors from Anthropic

**Fix:** Setup-token has ~547 req/day limit. Add enterprise API key to config:

```json
{
  "anthropic": {
    "setupToken": "sk-ant-oat01-...",
    "apiKey": "sk-ant-api03-...",
    "preferSetupToken": true
  }
}
```

Restart throttle: `sudo systemctl restart clawd-throttle-http`

### 4. No Cost Savings

**Symptom:** All requests go to Sonnet/Opus even for simple prompts

**Fix:** Check mode in config. `gigachad` mode prefers premium models. Switch to `standard`:

```json
{"mode": "standard"}
```

Or use MCP tool to change at runtime:
```bash
curl http://127.0.0.1:8484/v1/messages \
  -H "Content-Type: application/json" \
  -H "X-Throttle-Set-Mode: standard" \
  -d '{"messages":[{"role":"user","content":"test"}],"max_tokens":10}'
```

## Start Order

Always start throttle **before** OpenClaw:

```bash
sudo systemctl start clawd-throttle-http
sudo systemctl start openclaw
```

Or enable both to auto-start on boot:

```bash
sudo systemctl enable clawd-throttle-http openclaw
```

## Maintenance

### View Logs

```bash
# Throttle logs
journalctl -u clawd-throttle-http -f

# OpenClaw logs
journalctl -u openclaw -f

# Routing decisions
tail -f ~/.config/clawd-throttle/routing.jsonl | jq
```

### Update Throttle

```bash
cd /root/clawd/skills/clawd-throttle
git pull
npm install
sudo systemctl restart clawd-throttle-http
```

### Change Mode

Edit `~/.config/clawd-throttle/config.json`, change `"mode": "..."`, then:

```bash
sudo systemctl restart clawd-throttle-http
```

## Files Created

| Path | Purpose |
|------|---------|
| `/etc/systemd/system/clawd-throttle-http.service` | Auto-start throttle on boot |
| `~/.config/clawd-throttle/config.json` | API keys and routing mode |
| `~/.config/clawd-throttle/routing.jsonl` | Request log (one JSON per line) |
| `~/.openclaw/openclaw.json` | OpenClaw config (`ANTHROPIC_BASE_URL` + skill) |

## Cost Tracking

Routing log includes cost per request. Analyze with:

```bash
# Total cost this month
jq -s 'map(.estimatedCostUsd) | add' ~/.config/clawd-throttle/routing.jsonl

# Most expensive prompts
jq -s 'sort_by(.estimatedCostUsd) | reverse | .[0:10]' \
  ~/.config/clawd-throttle/routing.jsonl

# Model distribution
jq -s 'group_by(.selectedModel) | map({model: .[0].selectedModel, count: length})' \
  ~/.config/clawd-throttle/routing.jsonl
```

## Security Notes

- Throttle binds to `127.0.0.1:8484` (localhost only) by default
- To expose externally: Set `CLAWD_THROTTLE_HTTP_HOST=0.0.0.0` (⚠️ add auth!)
- API keys stored in `~/.config/clawd-throttle/config.json` (chmod 600)
- Prompt content never logged (only SHA-256 hashes)

## Next Steps

- Monitor first week of routing decisions via `routing.jsonl`
- Adjust mode if cost/quality balance isn't right
- Add more provider API keys to improve routing options
- Set up weekly cost reports (see Cost Tracking above)

## Support

- Issues: https://github.com/liekzejaws/clawd-throttle/issues
- Discussion: OpenClaw Discord
- Version: `cat package.json | jq -r .version`
