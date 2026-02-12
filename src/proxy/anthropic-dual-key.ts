import type { ThrottleConfig } from '../config/types.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('anthropic-dual-key');

export type AnthropicKeyType = 'setup-token' | 'enterprise';

interface KeyEntry {
  key: string;
  type: AnthropicKeyType;
}

/**
 * Manages dual Anthropic API keys with transparent failover.
 *
 * Supports two key types:
 * - setup-token: From `claude setup-token`, uses Claude Max subscription ($0 cost), lower rate limits
 * - enterprise: From console.anthropic.com, paid credits, higher rate limits
 *
 * Key selection respects `preferSetupToken` config and per-key cooldowns.
 * When the preferred key is cooling down, the other key is used as primary.
 */
export class AnthropicDualKey {
  private setupTokenCooldownUntil = 0;
  private enterpriseCooldownUntil = 0;
  private readonly cooldownMs: number;

  constructor(
    private config: ThrottleConfig,
    cooldownMs = 60_000,
  ) {
    this.cooldownMs = cooldownMs;
  }

  /**
   * Pick primary + fallback key based on preference + cooldown state.
   *
   * Rules:
   * 1. If preferred key is available and not cooling down → primary
   * 2. If preferred key IS cooling down → use other key as primary (no fallback to cooling key)
   * 3. If only one key configured → primary only, no fallback
   * 4. If neither key configured → primary=null
   */
  selectKeys(): { primary: KeyEntry | null; fallback: KeyEntry | null } {
    const hasSetup = !!this.config.anthropic.setupToken;
    const hasEnterprise = !!this.config.anthropic.apiKey;

    if (!hasSetup && !hasEnterprise) {
      return { primary: null, fallback: null };
    }

    const setupEntry: KeyEntry = { key: this.config.anthropic.setupToken, type: 'setup-token' };
    const enterpriseEntry: KeyEntry = { key: this.config.anthropic.apiKey, type: 'enterprise' };
    const setupCooling = this.isCoolingDown('setup-token');
    const enterpriseCooling = this.isCoolingDown('enterprise');

    // Only one key configured
    if (hasSetup && !hasEnterprise) {
      return { primary: setupEntry, fallback: null };
    }
    if (!hasSetup && hasEnterprise) {
      return { primary: enterpriseEntry, fallback: null };
    }

    // Both configured — use preference + cooldown state
    const preferSetup = this.config.anthropic.preferSetupToken;

    if (preferSetup) {
      if (!setupCooling) {
        return { primary: setupEntry, fallback: enterpriseCooling ? null : enterpriseEntry };
      }
      // Setup is cooling — use enterprise as primary, no fallback to cooling setup
      return { primary: enterpriseEntry, fallback: null };
    } else {
      if (!enterpriseCooling) {
        return { primary: enterpriseEntry, fallback: setupCooling ? null : setupEntry };
      }
      // Enterprise is cooling — use setup as primary, no fallback to cooling enterprise
      return { primary: setupEntry, fallback: null };
    }
  }

  /**
   * Mark a key type as rate-limited with a cooldown period.
   */
  markCooldown(keyType: AnthropicKeyType): void {
    const until = Date.now() + this.cooldownMs;
    if (keyType === 'setup-token') {
      this.setupTokenCooldownUntil = until;
    } else {
      this.enterpriseCooldownUntil = until;
    }
    log.info(`Anthropic ${keyType} rate-limited for ${this.cooldownMs}ms (until ${new Date(until).toISOString()})`);
  }

  /**
   * Check if a key type is currently in cooldown.
   */
  isCoolingDown(keyType: AnthropicKeyType): boolean {
    const until = keyType === 'setup-token'
      ? this.setupTokenCooldownUntil
      : this.enterpriseCooldownUntil;

    if (until === 0) return false;

    if (Date.now() >= until) {
      // Cooldown expired, clear it
      if (keyType === 'setup-token') {
        this.setupTokenCooldownUntil = 0;
      } else {
        this.enterpriseCooldownUntil = 0;
      }
      return false;
    }

    return true;
  }

  /**
   * Get status of both keys for quota reporting.
   */
  getStatus(): {
    setupToken: { available: boolean; coolingDown: boolean };
    enterprise: { available: boolean; coolingDown: boolean };
  } {
    return {
      setupToken: {
        available: !!this.config.anthropic.setupToken,
        coolingDown: this.isCoolingDown('setup-token'),
      },
      enterprise: {
        available: !!this.config.anthropic.apiKey,
        coolingDown: this.isCoolingDown('enterprise'),
      },
    };
  }

  /**
   * Clear all cooldowns (useful for testing).
   */
  clearCooldowns(): void {
    this.setupTokenCooldownUntil = 0;
    this.enterpriseCooldownUntil = 0;
  }
}

// Lazy singleton — created on first use
let instance: AnthropicDualKey | null = null;

export function getAnthropicDualKey(config: ThrottleConfig): AnthropicDualKey {
  if (!instance) {
    instance = new AnthropicDualKey(config);
    const status = instance.getStatus();
    const parts: string[] = [];
    if (status.setupToken.available) parts.push('setup-token ✓');
    if (status.enterprise.available) parts.push('enterprise ✓');
    if (parts.length > 0) {
      log.info(`Anthropic keys: ${parts.join(', ')}`);
    }
  }
  return instance;
}

/**
 * Reset the singleton (for testing only).
 */
export function resetAnthropicDualKey(): void {
  instance = null;
}
