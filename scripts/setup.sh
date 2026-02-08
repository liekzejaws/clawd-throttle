#!/bin/bash
set -e

echo ""
echo "=== Clawd Throttle Setup ==="
echo ""

# Check Node.js
if ! command -v node &> /dev/null; then
    echo "Error: Node.js 18+ is required. Install from https://nodejs.org/"
    exit 1
fi

echo "Node.js version: $(node --version)"

# Install dependencies
echo ""
echo "Installing dependencies..."
npm install

echo ""
echo "Dependencies installed."

# Prompt for Anthropic API key
if [ -z "$ANTHROPIC_API_KEY" ]; then
    echo ""
    echo "Anthropic API key is required for Claude Sonnet / Opus."
    echo "Get one at: https://console.anthropic.com/settings/keys"
    echo ""
    read -rp "Enter your Anthropic API Key: " ANTHROPIC_API_KEY
    export ANTHROPIC_API_KEY
else
    echo ""
    echo "Anthropic API key found in environment."
fi

# Prompt for Google AI API key
if [ -z "$GOOGLE_AI_API_KEY" ]; then
    echo ""
    echo "Google AI API key is required for Gemini Flash."
    echo "Get one at: https://aistudio.google.com/app/apikey"
    echo ""
    read -rp "Enter your Google AI API Key: " GOOGLE_AI_API_KEY
    export GOOGLE_AI_API_KEY
else
    echo ""
    echo "Google AI API key found in environment."
fi

# Create config directory
CONFIG_DIR="${CLAWD_THROTTLE_CONFIG_DIR:-$HOME/.config/clawd-throttle}"
mkdir -p "$CONFIG_DIR"
echo ""
echo "Config directory: $CONFIG_DIR"

# Select routing mode
echo ""
echo "Select your default routing mode:"
echo ""
echo "  1. eco          Cheapest. Gemini Flash for most, Sonnet for complex."
echo "  2. standard     Balanced. Flash/Sonnet/Opus by complexity."
echo "  3. performance  Best quality. Sonnet/Opus for everything."
echo ""
read -rp "Enter choice [1/2/3] (default: 2): " CHOICE
case "$CHOICE" in
    1) MODE="eco" ;;
    3) MODE="performance" ;;
    *) MODE="standard" ;;
esac

# Write config.json
cat > "$CONFIG_DIR/config.json" << CONFIGEOF
{
  "mode": "$MODE",
  "anthropic": {
    "apiKey": "$ANTHROPIC_API_KEY",
    "baseUrl": "https://api.anthropic.com"
  },
  "google": {
    "apiKey": "$GOOGLE_AI_API_KEY",
    "baseUrl": "https://generativelanguage.googleapis.com"
  },
  "logging": {
    "level": "info",
    "logFilePath": "$CONFIG_DIR/routing.jsonl"
  },
  "classifier": {
    "weightsPath": "",
    "thresholds": {
      "simpleMax": 0.30,
      "complexMin": 0.65
    }
  },
  "modelCatalogPath": ""
}
CONFIGEOF

echo ""
echo "Configuration saved to: $CONFIG_DIR/config.json"
echo "Routing mode: $MODE"
echo ""
echo "Setup complete! To start the MCP server:"
echo "  npm start"
echo ""
echo "To add to your Claude Desktop config:"
echo "  \"clawd-throttle\": {"
echo "    \"command\": \"npx\","
echo "    \"args\": [\"tsx\", \"src/index.ts\"],"
echo "    \"cwd\": \"$(pwd)\""
echo "  }"
echo ""
