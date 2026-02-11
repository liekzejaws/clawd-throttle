import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RateLimiter } from '../../../src/router/rate-limiter.js';

describe('RateLimiter', () => {
  let limiter: RateLimiter;

  beforeEach(() => {
    limiter = new RateLimiter();
  });

  it('returns false for unknown models', () => {
    expect(limiter.isRateLimited('claude-sonnet-4-5')).toBe(false);
  });

  it('marks model as rate-limited', () => {
    limiter.markRateLimited('claude-sonnet-4-5');
    expect(limiter.isRateLimited('claude-sonnet-4-5')).toBe(true);
  });

  it('expires after cooldown period', () => {
    vi.useFakeTimers();
    try {
      limiter.markRateLimited('claude-sonnet-4-5', 60_000);
      expect(limiter.isRateLimited('claude-sonnet-4-5')).toBe(true);

      vi.advanceTimersByTime(59_999);
      expect(limiter.isRateLimited('claude-sonnet-4-5')).toBe(true);

      vi.advanceTimersByTime(1);
      expect(limiter.isRateLimited('claude-sonnet-4-5')).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('tracks multiple models independently', () => {
    limiter.markRateLimited('claude-sonnet-4-5');
    limiter.markRateLimited('gemini-2.5-flash');

    expect(limiter.isRateLimited('claude-sonnet-4-5')).toBe(true);
    expect(limiter.isRateLimited('gemini-2.5-flash')).toBe(true);
    expect(limiter.isRateLimited('claude-haiku-4-5')).toBe(false);
  });

  it('filterAvailable removes rate-limited models', () => {
    limiter.markRateLimited('claude-sonnet-4-5');
    limiter.markRateLimited('gemini-2.5-flash');

    const available = limiter.filterAvailable([
      'claude-sonnet-4-5',
      'gemini-2.5-flash',
      'claude-haiku-4-5',
      'grok-4-1-fast-non-reasoning',
    ]);

    expect(available).toEqual(['claude-haiku-4-5', 'grok-4-1-fast-non-reasoning']);
  });

  it('filterAvailable returns all when none rate-limited', () => {
    const models = ['claude-sonnet-4-5', 'gemini-2.5-flash'];
    expect(limiter.filterAvailable(models)).toEqual(models);
  });

  it('clear removes rate-limit for specific model', () => {
    limiter.markRateLimited('claude-sonnet-4-5');
    limiter.markRateLimited('gemini-2.5-flash');

    limiter.clear('claude-sonnet-4-5');

    expect(limiter.isRateLimited('claude-sonnet-4-5')).toBe(false);
    expect(limiter.isRateLimited('gemini-2.5-flash')).toBe(true);
  });

  it('clearAll removes all rate-limits', () => {
    limiter.markRateLimited('claude-sonnet-4-5');
    limiter.markRateLimited('gemini-2.5-flash');

    limiter.clearAll();

    expect(limiter.isRateLimited('claude-sonnet-4-5')).toBe(false);
    expect(limiter.isRateLimited('gemini-2.5-flash')).toBe(false);
  });

  it('size returns count of active rate-limits', () => {
    expect(limiter.size).toBe(0);

    limiter.markRateLimited('claude-sonnet-4-5');
    limiter.markRateLimited('gemini-2.5-flash');
    expect(limiter.size).toBe(2);
  });

  it('size prunes expired entries', () => {
    vi.useFakeTimers();
    try {
      limiter.markRateLimited('claude-sonnet-4-5', 1000);
      limiter.markRateLimited('gemini-2.5-flash', 5000);

      vi.advanceTimersByTime(2000);
      expect(limiter.size).toBe(1); // sonnet expired, flash still active
    } finally {
      vi.useRealTimers();
    }
  });

  it('supports custom cooldown periods', () => {
    vi.useFakeTimers();
    try {
      limiter.markRateLimited('claude-sonnet-4-5', 5000); // 5s cooldown

      vi.advanceTimersByTime(4999);
      expect(limiter.isRateLimited('claude-sonnet-4-5')).toBe(true);

      vi.advanceTimersByTime(1);
      expect(limiter.isRateLimited('claude-sonnet-4-5')).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
