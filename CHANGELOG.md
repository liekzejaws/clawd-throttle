# Changelog

## [2.2.0] - 2026-02-12

### Added
- **Dual-key Anthropic failover**: Configure both setup-token (free) and enterprise API key. Throttle automatically falls back from setup-token → enterprise on 429/401 errors with 60s cooldown per key.
- **OpenClaw HTTP proxy integration**: Full guide for routing OpenClaw through throttle via `ANTHROPIC_BASE_URL` environment variable.
- **Systemd service template**: `clawd-throttle-http.service` for auto-start on boot.
- **Comprehensive setup documentation**: `OPENCLAW_SETUP.md` with step-by-step instructions, common pitfalls, and troubleshooting.

### Changed
- Config schema: `anthropic.setupToken` and `anthropic.apiKey` both supported, with `preferSetupToken` flag.
- Improved logging: Dual-key status shown at startup, failover events logged.

### Fixed
- Rate-limit handling: 60-second cooldown prevents retry spam on exhausted keys.
- Auth error handling: 401 errors now trigger same failover as 429.

### Documentation
- Added `OPENCLAW_SETUP.md` - Integration guide for OpenClaw
- Added `clawd-throttle-http.service` - Systemd service template
- Updated README with HTTP proxy usage examples
- Documented MCP auth profile pitfall (DO NOT add throttle under auth.profiles)

## [2.1.0] - 2026-02-11

### Added
- Session model pinning
- Request deduplication (30s TTL)
- Rate-limit awareness (60s cooldown)
- Sigmoid confidence calibration
- 11-dimension classifier (up from 8)

### Changed
- Routing table format (backward compatible)
- Improved classification accuracy

## [2.0.0] - 2026-02-10

### Added
- HTTP reverse proxy mode
- Multi-provider support (8 providers, 30+ models)
- Cost tracking and stats endpoint
- ClawHub publication

### Changed
- Complete rewrite from v1.x
- New classifier engine
- Preference-list routing

## [1.0.0] - 2026-02-09

### Added
- Initial release
- Basic routing for Anthropic only
- MCP server implementation
