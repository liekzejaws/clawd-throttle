# Clawd Throttle Setup Script (Windows)
Write-Host ""
Write-Host "=== Clawd Throttle Setup ===" -ForegroundColor Cyan
Write-Host "Universal LLM Cost Optimizer — 8 providers, 30+ models"
Write-Host ""

# Check Node.js
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "Error: Node.js 18+ is required. Install from https://nodejs.org/" -ForegroundColor Red
    exit 1
}

$nodeVersion = node --version
Write-Host "Node.js version: $nodeVersion"

# Install dependencies
Write-Host ""
Write-Host "Installing dependencies..." -ForegroundColor Yellow
npm install
if ($LASTEXITCODE -ne 0) {
    Write-Host "Error: npm install failed" -ForegroundColor Red
    exit 1
}
Write-Host "Dependencies installed." -ForegroundColor Green

# --- Provider API Keys (all optional) ---
Write-Host ""
Write-Host "Configure your LLM providers (all optional — press Enter to skip):" -ForegroundColor Yellow
Write-Host "You only need ONE provider to get started." -ForegroundColor White
Write-Host ""

# Anthropic
if (-not $env:ANTHROPIC_API_KEY) {
    Write-Host "[Anthropic] Claude Opus, Sonnet, Haiku" -ForegroundColor Cyan
    Write-Host "  Get a key at: https://console.anthropic.com/settings/keys" -ForegroundColor Gray
    $key = Read-Host "  ANTHROPIC_API_KEY"
    if ($key) { $env:ANTHROPIC_API_KEY = $key }
} else {
    Write-Host "[Anthropic] Key found in environment." -ForegroundColor Green
}

# Google
if (-not $env:GOOGLE_AI_API_KEY) {
    Write-Host "[Google] Gemini 2.5 Pro, Flash, Flash-Lite" -ForegroundColor Cyan
    Write-Host "  Get a key at: https://aistudio.google.com/app/apikey" -ForegroundColor Gray
    $key = Read-Host "  GOOGLE_AI_API_KEY"
    if ($key) { $env:GOOGLE_AI_API_KEY = $key }
} else {
    Write-Host "[Google] Key found in environment." -ForegroundColor Green
}

# OpenAI
if (-not $env:OPENAI_API_KEY) {
    Write-Host "[OpenAI] GPT-5.2, GPT-5.1, GPT-5-mini, o3" -ForegroundColor Cyan
    Write-Host "  Get a key at: https://platform.openai.com/api-keys" -ForegroundColor Gray
    $key = Read-Host "  OPENAI_API_KEY"
    if ($key) { $env:OPENAI_API_KEY = $key }
} else {
    Write-Host "[OpenAI] Key found in environment." -ForegroundColor Green
}

# DeepSeek
if (-not $env:DEEPSEEK_API_KEY) {
    Write-Host "[DeepSeek] DeepSeek-Chat, DeepSeek-Reasoner" -ForegroundColor Cyan
    Write-Host "  Get a key at: https://platform.deepseek.com/api-keys" -ForegroundColor Gray
    $key = Read-Host "  DEEPSEEK_API_KEY"
    if ($key) { $env:DEEPSEEK_API_KEY = $key }
} else {
    Write-Host "[DeepSeek] Key found in environment." -ForegroundColor Green
}

# xAI
if (-not $env:XAI_API_KEY) {
    Write-Host "[xAI] Grok-4, Grok-3, Grok-3-mini" -ForegroundColor Cyan
    Write-Host "  Get a key at: https://console.x.ai/" -ForegroundColor Gray
    $key = Read-Host "  XAI_API_KEY"
    if ($key) { $env:XAI_API_KEY = $key }
} else {
    Write-Host "[xAI] Key found in environment." -ForegroundColor Green
}

# Moonshot
if (-not $env:MOONSHOT_API_KEY) {
    Write-Host "[Moonshot] Kimi K2.5, K2-thinking" -ForegroundColor Cyan
    Write-Host "  Get a key at: https://platform.moonshot.ai/console/api-keys" -ForegroundColor Gray
    $key = Read-Host "  MOONSHOT_API_KEY"
    if ($key) { $env:MOONSHOT_API_KEY = $key }
} else {
    Write-Host "[Moonshot] Key found in environment." -ForegroundColor Green
}

# Mistral
if (-not $env:MISTRAL_API_KEY) {
    Write-Host "[Mistral] Mistral Large, Small, Codestral" -ForegroundColor Cyan
    Write-Host "  Get a key at: https://console.mistral.ai/api-keys" -ForegroundColor Gray
    $key = Read-Host "  MISTRAL_API_KEY"
    if ($key) { $env:MISTRAL_API_KEY = $key }
} else {
    Write-Host "[Mistral] Key found in environment." -ForegroundColor Green
}

# Ollama
Write-Host "[Ollama] Local models (no API key needed)" -ForegroundColor Cyan
if (-not $env:OLLAMA_BASE_URL) {
    Write-Host "  Default: http://localhost:11434/v1" -ForegroundColor Gray
    $ollamaUrl = Read-Host "  OLLAMA_BASE_URL (press Enter for default)"
    if ($ollamaUrl) { $env:OLLAMA_BASE_URL = $ollamaUrl }
} else {
    Write-Host "  Base URL: $env:OLLAMA_BASE_URL" -ForegroundColor Green
}

# Count configured providers
$configuredCount = 0
if ($env:ANTHROPIC_API_KEY)  { $configuredCount++ }
if ($env:GOOGLE_AI_API_KEY)  { $configuredCount++ }
if ($env:OPENAI_API_KEY)     { $configuredCount++ }
if ($env:DEEPSEEK_API_KEY)   { $configuredCount++ }
if ($env:XAI_API_KEY)        { $configuredCount++ }
if ($env:MOONSHOT_API_KEY)   { $configuredCount++ }
if ($env:MISTRAL_API_KEY)    { $configuredCount++ }
# Ollama is always available
$configuredCount++

Write-Host ""
Write-Host "$configuredCount provider(s) configured (including Ollama)." -ForegroundColor Green

# Create config directory
$configDir = Join-Path $env:USERPROFILE ".config\clawd-throttle"
if (-not (Test-Path $configDir)) {
    New-Item -ItemType Directory -Path $configDir -Force | Out-Null
    Write-Host ""
    Write-Host "Created config directory: $configDir" -ForegroundColor Green
}

# Select routing mode
Write-Host ""
Write-Host "Select your default routing mode:" -ForegroundColor Yellow
Write-Host ""
Write-Host "  1. eco          Cheapest models first. Great for high-volume, simple tasks." -ForegroundColor White
Write-Host "  2. standard     Balanced. Cost-effective mix of quality and savings." -ForegroundColor White
Write-Host "  3. performance  Best quality. Premium models for complex reasoning." -ForegroundColor White
Write-Host ""
$choice = Read-Host "Enter choice [1/2/3] (default: 2)"
$mode = switch ($choice) {
    "1" { "eco" }
    "3" { "performance" }
    default { "standard" }
}

# Write config.json (only includes keys that were provided)
$logFilePath = Join-Path $configDir "routing.jsonl"
$configObj = @{
    mode = $mode
    logging = @{
        level = "info"
        logFilePath = $logFilePath
    }
    classifier = @{
        weightsPath = ""
        thresholds = @{
            simpleMax = 0.30
            complexMin = 0.65
        }
    }
    modelCatalogPath = ""
}

# Add provider keys that were set
if ($env:ANTHROPIC_API_KEY)  { $configObj.anthropic  = @{ apiKey = $env:ANTHROPIC_API_KEY;  baseUrl = "https://api.anthropic.com" } }
if ($env:GOOGLE_AI_API_KEY)  { $configObj.google     = @{ apiKey = $env:GOOGLE_AI_API_KEY;  baseUrl = "https://generativelanguage.googleapis.com" } }
if ($env:OPENAI_API_KEY)     { $configObj.openai     = @{ apiKey = $env:OPENAI_API_KEY;     baseUrl = "https://api.openai.com/v1" } }
if ($env:DEEPSEEK_API_KEY)   { $configObj.deepseek   = @{ apiKey = $env:DEEPSEEK_API_KEY;   baseUrl = "https://api.deepseek.com/v1" } }
if ($env:XAI_API_KEY)        { $configObj.xai        = @{ apiKey = $env:XAI_API_KEY;        baseUrl = "https://api.x.ai/v1" } }
if ($env:MOONSHOT_API_KEY)   { $configObj.moonshot   = @{ apiKey = $env:MOONSHOT_API_KEY;   baseUrl = "https://api.moonshot.ai/v1" } }
if ($env:MISTRAL_API_KEY)    { $configObj.mistral    = @{ apiKey = $env:MISTRAL_API_KEY;    baseUrl = "https://api.mistral.ai/v1" } }
if ($env:OLLAMA_BASE_URL)    { $configObj.ollama     = @{ apiKey = "";                       baseUrl = $env:OLLAMA_BASE_URL } }

$configObj | ConvertTo-Json -Depth 3 | Set-Content (Join-Path $configDir "config.json") -Encoding UTF8

Write-Host ""
Write-Host "Configuration saved to: $(Join-Path $configDir 'config.json')" -ForegroundColor Green
Write-Host "Routing mode: $mode" -ForegroundColor Green
Write-Host ""
Write-Host "Setup complete! To start:" -ForegroundColor Cyan
Write-Host "  npm start               # MCP stdio server" -ForegroundColor White
Write-Host "  npm start -- --http     # MCP + HTTP proxy" -ForegroundColor White
Write-Host "  npm start -- --http-only # HTTP proxy only" -ForegroundColor White
Write-Host ""
