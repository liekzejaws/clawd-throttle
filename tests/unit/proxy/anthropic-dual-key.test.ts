import { describe, it, expect, beforeEach } from 'vitest';
import { AnthropicDualKey } from '../../../src/proxy/anthropic-dual-key.js';
import type { ThrottleConfig } from '../../../src/config/types.js';

function makeConfig(overrides: Partial<ThrottleConfig['anthropic']> = {}): ThrottleConfig {
  return {
    anthropic: {
      apiKey: 'sk-ant-api03-enterprise-key',
      setupToken: 'sk-ant-setup-token-key',
      baseUrl: 'https://api.anthropic.com',
      authType: 'auto',
      preferSetupToken: true,
      ...overrides,
    },
  } as ThrottleConfig;
}

describe('AnthropicDualKey', () => {
  describe('selectKeys', () => {
    it('prefers setup-token when preferSetupToken is true', () => {
      const dk = new AnthropicDualKey(makeConfig({ preferSetupToken: true }));
      const { primary, fallback } = dk.selectKeys();
      expect(primary?.type).toBe('setup-token');
      expect(fallback?.type).toBe('enterprise');
    });

    it('prefers enterprise when preferSetupToken is false', () => {
      const dk = new AnthropicDualKey(makeConfig({ preferSetupToken: false }));
      const { primary, fallback } = dk.selectKeys();
      expect(primary?.type).toBe('enterprise');
      expect(fallback?.type).toBe('setup-token');
    });

    it('returns only setup-token when enterprise is not configured', () => {
      const dk = new AnthropicDualKey(makeConfig({ apiKey: '', preferSetupToken: true }));
      const { primary, fallback } = dk.selectKeys();
      expect(primary?.type).toBe('setup-token');
      expect(fallback).toBeNull();
    });

    it('returns only enterprise when setup-token is not configured', () => {
      const dk = new AnthropicDualKey(makeConfig({ setupToken: '', preferSetupToken: true }));
      const { primary, fallback } = dk.selectKeys();
      expect(primary?.type).toBe('enterprise');
      expect(fallback).toBeNull();
    });

    it('returns null primary when neither key is configured', () => {
      const dk = new AnthropicDualKey(makeConfig({ apiKey: '', setupToken: '' }));
      const { primary, fallback } = dk.selectKeys();
      expect(primary).toBeNull();
      expect(fallback).toBeNull();
    });

    it('switches to enterprise when setup-token is cooling down', () => {
      const dk = new AnthropicDualKey(makeConfig({ preferSetupToken: true }));
      dk.markCooldown('setup-token');
      const { primary, fallback } = dk.selectKeys();
      expect(primary?.type).toBe('enterprise');
      expect(fallback).toBeNull(); // Don't fallback to cooling key
    });

    it('switches to setup-token when enterprise is cooling down', () => {
      const dk = new AnthropicDualKey(makeConfig({ preferSetupToken: false }));
      dk.markCooldown('enterprise');
      const { primary, fallback } = dk.selectKeys();
      expect(primary?.type).toBe('setup-token');
      expect(fallback).toBeNull();
    });

    it('provides no fallback when fallback key is also cooling down', () => {
      const dk = new AnthropicDualKey(makeConfig({ preferSetupToken: true }));
      dk.markCooldown('enterprise');
      const { primary, fallback } = dk.selectKeys();
      expect(primary?.type).toBe('setup-token');
      expect(fallback).toBeNull(); // Enterprise is cooling
    });
  });

  describe('markCooldown', () => {
    it('marks setup-token as cooling down', () => {
      const dk = new AnthropicDualKey(makeConfig());
      expect(dk.isCoolingDown('setup-token')).toBe(false);
      dk.markCooldown('setup-token');
      expect(dk.isCoolingDown('setup-token')).toBe(true);
      expect(dk.isCoolingDown('enterprise')).toBe(false);
    });

    it('marks enterprise as cooling down', () => {
      const dk = new AnthropicDualKey(makeConfig());
      dk.markCooldown('enterprise');
      expect(dk.isCoolingDown('enterprise')).toBe(true);
      expect(dk.isCoolingDown('setup-token')).toBe(false);
    });

    it('tracks both keys independently', () => {
      const dk = new AnthropicDualKey(makeConfig());
      dk.markCooldown('setup-token');
      dk.markCooldown('enterprise');
      expect(dk.isCoolingDown('setup-token')).toBe(true);
      expect(dk.isCoolingDown('enterprise')).toBe(true);
    });
  });

  describe('cooldown expiry', () => {
    it('expires after cooldown period', () => {
      const dk = new AnthropicDualKey(makeConfig(), 50); // 50ms cooldown
      dk.markCooldown('setup-token');
      expect(dk.isCoolingDown('setup-token')).toBe(true);

      // Wait for expiry
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          expect(dk.isCoolingDown('setup-token')).toBe(false);
          resolve();
        }, 60);
      });
    });
  });

  describe('clearCooldowns', () => {
    it('clears all cooldowns', () => {
      const dk = new AnthropicDualKey(makeConfig());
      dk.markCooldown('setup-token');
      dk.markCooldown('enterprise');
      dk.clearCooldowns();
      expect(dk.isCoolingDown('setup-token')).toBe(false);
      expect(dk.isCoolingDown('enterprise')).toBe(false);
    });
  });

  describe('getStatus', () => {
    it('reports available keys', () => {
      const dk = new AnthropicDualKey(makeConfig());
      const status = dk.getStatus();
      expect(status.setupToken.available).toBe(true);
      expect(status.enterprise.available).toBe(true);
      expect(status.setupToken.coolingDown).toBe(false);
      expect(status.enterprise.coolingDown).toBe(false);
    });

    it('reports unavailable keys', () => {
      const dk = new AnthropicDualKey(makeConfig({ apiKey: '', setupToken: '' }));
      const status = dk.getStatus();
      expect(status.setupToken.available).toBe(false);
      expect(status.enterprise.available).toBe(false);
    });

    it('reports cooling down keys', () => {
      const dk = new AnthropicDualKey(makeConfig());
      dk.markCooldown('setup-token');
      const status = dk.getStatus();
      expect(status.setupToken.coolingDown).toBe(true);
      expect(status.enterprise.coolingDown).toBe(false);
    });
  });

  describe('key values', () => {
    it('returns correct key strings', () => {
      const dk = new AnthropicDualKey(makeConfig({
        setupToken: 'sk-ant-setup-123',
        apiKey: 'sk-ant-api03-enterprise-456',
      }));
      const { primary, fallback } = dk.selectKeys();
      expect(primary?.key).toBe('sk-ant-setup-123');
      expect(fallback?.key).toBe('sk-ant-api03-enterprise-456');
    });
  });
});
