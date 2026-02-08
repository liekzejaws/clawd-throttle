# Clawd Throttle Setup Script (Windows)
Write-Host ""
Write-Host "=== Clawd Throttle Setup ===" -ForegroundColor Cyan
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

# Prompt for Anthropic API key
if (-not $env:ANTHROPIC_API_KEY) {
    Write-Host ""
    Write-Host "Anthropic API key is required for Claude Sonnet / Opus." -ForegroundColor Yellow
    Write-Host "Get one at: https://console.anthropic.com/settings/keys" -ForegroundColor White
    Write-Host ""
    $apiKey = Read-Host "Enter your Anthropic API Key"
    $env:ANTHROPIC_API_KEY = $apiKey
} else {
    Write-Host ""
    Write-Host "Anthropic API key found in environment." -ForegroundColor Green
}

# Prompt for Google AI API key
if (-not $env:GOOGLE_AI_API_KEY) {
    Write-Host ""
    Write-Host "Google AI API key is required for Gemini Flash." -ForegroundColor Yellow
    Write-Host "Get one at: https://aistudio.google.com/app/apikey" -ForegroundColor White
    Write-Host ""
    $googleKey = Read-Host "Enter your Google AI API Key"
    $env:GOOGLE_AI_API_KEY = $googleKey
} else {
    Write-Host ""
    Write-Host "Google AI API key found in environment." -ForegroundColor Green
}

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
Write-Host "  1. eco          Cheapest. Gemini Flash for most tasks, Sonnet for complex." -ForegroundColor White
Write-Host "  2. standard     Balanced. Flash for simple, Sonnet for standard, Opus for complex." -ForegroundColor White
Write-Host "  3. performance  Best quality. Sonnet for simple, Opus for everything else." -ForegroundColor White
Write-Host ""
$choice = Read-Host "Enter choice [1/2/3] (default: 2)"
$mode = switch ($choice) {
    "1" { "eco" }
    "3" { "performance" }
    default { "standard" }
}

# Write config.json
$logFilePath = Join-Path $configDir "routing.jsonl"
$configContent = @"
{
  "mode": "$mode",
  "anthropic": {
    "apiKey": "$($env:ANTHROPIC_API_KEY)",
    "baseUrl": "https://api.anthropic.com"
  },
  "google": {
    "apiKey": "$($env:GOOGLE_AI_API_KEY)",
    "baseUrl": "https://generativelanguage.googleapis.com"
  },
  "logging": {
    "level": "info",
    "logFilePath": "$($logFilePath -replace '\\', '\\\\')"
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
"@
$configContent | Set-Content (Join-Path $configDir "config.json") -Encoding UTF8

Write-Host ""
Write-Host "Configuration saved to: $(Join-Path $configDir 'config.json')" -ForegroundColor Green
Write-Host "Routing mode: $mode" -ForegroundColor Green
Write-Host ""
Write-Host "Setup complete! To start the MCP server:" -ForegroundColor Cyan
Write-Host "  npm start" -ForegroundColor White
Write-Host ""
Write-Host "To add to your Claude Desktop config:" -ForegroundColor Cyan
Write-Host '  "clawd-throttle": {' -ForegroundColor White
Write-Host '    "command": "npx",' -ForegroundColor White
Write-Host '    "args": ["tsx", "src/index.ts"],' -ForegroundColor White
Write-Host "    `"cwd`": `"$(Get-Location)`"" -ForegroundColor White
Write-Host '  }' -ForegroundColor White
Write-Host ""
