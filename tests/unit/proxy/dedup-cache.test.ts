import { describe, it, expect, beforeEach } from 'vitest';
import { DedupCache } from '../../../src/proxy/dedup-cache.js';
import type { CachedResponse } from '../../../src/proxy/dedup-cache.js';

describe('DedupCache', () => {
  let cache: DedupCache;

  beforeEach(() => {
    cache = new DedupCache(30_000); // 30s TTL
  });

  describe('computeKey', () => {
    it('produces consistent keys for identical messages', () => {
      const messages = [{ role: 'user', content: 'hello' }];
      const key1 = cache.computeKey(messages);
      const key2 = cache.computeKey(messages);
      expect(key1).toBe(key2);
      expect(key1).toHaveLength(16);
    });

    it('produces different keys for different messages', () => {
      const key1 = cache.computeKey([{ role: 'user', content: 'hello' }]);
      const key2 = cache.computeKey([{ role: 'user', content: 'goodbye' }]);
      expect(key1).not.toBe(key2);
    });

    it('includes system prompt in key', () => {
      const messages = [{ role: 'user', content: 'hello' }];
      const key1 = cache.computeKey(messages, 'You are helpful');
      const key2 = cache.computeKey(messages, 'You are brief');
      expect(key1).not.toBe(key2);
    });

    it('strips OpenClaw timestamp prefixes', () => {
      const key1 = cache.computeKey([{ role: 'user', content: 'hello world' }]);
      const key2 = cache.computeKey([{ role: 'user', content: '[MON 2026-02-10 14:30 EST] hello world' }]);
      expect(key1).toBe(key2);
    });

    it('handles different day abbreviations in timestamps', () => {
      const key1 = cache.computeKey([{ role: 'user', content: 'test' }]);
      const key2 = cache.computeKey([{ role: 'user', content: '[TUE 2026-02-11 09:00 UTC] test' }]);
      expect(key1).toBe(key2);
    });
  });

  describe('getCompleted', () => {
    it('returns undefined for unknown key', () => {
      expect(cache.getCompleted('unknown')).toBeUndefined();
    });

    it('returns cached response within TTL', () => {
      const response: CachedResponse = {
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: '{"result": "ok"}',
        completedAt: Date.now(),
      };
      const key = 'test-key-123456';
      cache.complete(key, response);
      expect(cache.getCompleted(key)).toEqual(response);
    });

    it('returns undefined for expired entry', () => {
      const response: CachedResponse = {
        status: 200,
        headers: {},
        body: 'ok',
        completedAt: Date.now() - 60_000, // 60s ago, past 30s TTL
      };
      // Manually inject expired entry
      cache.complete('expired-key', response);
      // Override completedAt to simulate expiration
      const result = cache.getCompleted('expired-key');
      // Since we set completedAt to now during complete(), create a fresh cache with short TTL
      const shortCache = new DedupCache(1); // 1ms TTL
      shortCache.complete('short-key', {
        status: 200,
        headers: {},
        body: 'ok',
        completedAt: Date.now() - 10, // 10ms ago
      });
      // Should be expired with 1ms TTL
      expect(shortCache.getCompleted('short-key')).toBeUndefined();
    });
  });

  describe('markInflight', () => {
    it('returns isWaiting: false for new key', () => {
      const result = cache.markInflight('new-key');
      expect(result.isWaiting).toBe(false);
    });

    it('returns isWaiting: true for existing in-flight key', () => {
      cache.markInflight('inflight-key');
      const result = cache.markInflight('inflight-key');
      expect(result.isWaiting).toBe(true);
      if (result.isWaiting) {
        expect(result.promise).toBeInstanceOf(Promise);
      }
      // Clean up (internal no-op catch prevents unhandled rejection)
      cache.removeInflight('inflight-key');
    });
  });

  describe('complete', () => {
    it('resolves in-flight waiters', async () => {
      // First request marks in-flight
      cache.markInflight('waiter-key');

      // Second request joins as waiter
      const waiterResult = cache.markInflight('waiter-key');
      expect(waiterResult.isWaiting).toBe(true);

      const response: CachedResponse = {
        status: 200,
        headers: {},
        body: 'result',
        completedAt: Date.now(),
      };

      // Complete the request — should resolve the waiter
      cache.complete('waiter-key', response);

      if (waiterResult.isWaiting) {
        const resolved = await waiterResult.promise;
        expect(resolved).toEqual(response);
      }
    });

    it('caches the response for subsequent getCompleted calls', () => {
      const response: CachedResponse = {
        status: 200,
        headers: {},
        body: 'cached',
        completedAt: Date.now(),
      };
      cache.complete('cache-key', response);
      expect(cache.getCompleted('cache-key')).toEqual(response);
    });
  });

  describe('removeInflight', () => {
    it('rejects waiters on error', async () => {
      cache.markInflight('error-key');
      const waiterResult = cache.markInflight('error-key');

      cache.removeInflight('error-key', new Error('upstream failed'));

      if (waiterResult.isWaiting) {
        await expect(waiterResult.promise).rejects.toThrow('upstream failed');
      }
    });

    it('is safe to call for non-existent key', () => {
      // Should not throw
      cache.removeInflight('nonexistent-key');
    });
  });

  describe('size tracking', () => {
    it('tracks completed entries', () => {
      expect(cache.completedSize).toBe(0);
      cache.complete('a', { status: 200, headers: {}, body: '', completedAt: Date.now() });
      expect(cache.completedSize).toBe(1);
      cache.complete('b', { status: 200, headers: {}, body: '', completedAt: Date.now() });
      expect(cache.completedSize).toBe(2);
    });

    it('tracks in-flight entries', () => {
      expect(cache.inflightSize).toBe(0);
      cache.markInflight('x');
      expect(cache.inflightSize).toBe(1);
      cache.complete('x', { status: 200, headers: {}, body: '', completedAt: Date.now() });
      expect(cache.inflightSize).toBe(0);
    });
  });

  describe('clearAll', () => {
    it('removes all entries', () => {
      cache.complete('a', { status: 200, headers: {}, body: '', completedAt: Date.now() });
      cache.markInflight('b');
      cache.clearAll();
      expect(cache.completedSize).toBe(0);
      expect(cache.inflightSize).toBe(0);
    });
  });

  describe('concurrent deduplication', () => {
    it('only one request processes, others wait and get same result', async () => {
      const key = cache.computeKey([{ role: 'user', content: 'deduplicate me' }]);

      // First request starts processing
      const first = cache.markInflight(key);
      expect(first.isWaiting).toBe(false);

      // Second and third requests arrive
      const second = cache.markInflight(key);
      const third = cache.markInflight(key);
      expect(second.isWaiting).toBe(true);
      expect(third.isWaiting).toBe(true);

      // First request completes
      const response: CachedResponse = {
        status: 200,
        headers: { 'x-model': 'claude-sonnet-4-5' },
        body: '{"content": "hello"}',
        completedAt: Date.now(),
      };
      cache.complete(key, response);

      // Both waiters should resolve with same response
      if (second.isWaiting && third.isWaiting) {
        const [r2, r3] = await Promise.all([second.promise, third.promise]);
        expect(r2).toEqual(response);
        expect(r3).toEqual(response);
      }

      // Subsequent lookup should return from completed cache
      expect(cache.getCompleted(key)).toEqual(response);
    });
  });
});
