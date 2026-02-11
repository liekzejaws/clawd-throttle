import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SessionStore } from '../../../src/router/session-store.js';

describe('SessionStore', () => {
  let store: SessionStore;

  beforeEach(() => {
    store = new SessionStore(30 * 60 * 1000); // 30 min timeout
  });

  it('returns undefined for unknown session', () => {
    expect(store.get('unknown-session')).toBeUndefined();
  });

  it('pins a new session', () => {
    const result = store.set('sess-1', 'claude-haiku-4-5', 'simple');
    expect(result.modelId).toBe('claude-haiku-4-5');
    expect(result.tier).toBe('simple');
  });

  it('retrieves a pinned session', () => {
    store.set('sess-2', 'claude-sonnet-4-5', 'standard');
    const result = store.get('sess-2');
    expect(result).toBeDefined();
    expect(result!.modelId).toBe('claude-sonnet-4-5');
    expect(result!.tier).toBe('standard');
  });

  it('allows tier upgrades', () => {
    store.set('sess-3', 'claude-haiku-4-5', 'simple');
    const upgraded = store.set('sess-3', 'claude-sonnet-4-5', 'standard');
    expect(upgraded.modelId).toBe('claude-sonnet-4-5');
    expect(upgraded.tier).toBe('standard');
  });

  it('prevents tier downgrades', () => {
    store.set('sess-4', 'claude-sonnet-4-5', 'standard');
    const kept = store.set('sess-4', 'gemini-2.5-flash', 'simple');
    // Should keep the original pin
    expect(kept.modelId).toBe('claude-sonnet-4-5');
    expect(kept.tier).toBe('standard');
  });

  it('keeps same tier (no change)', () => {
    store.set('sess-5', 'claude-haiku-4-5', 'standard');
    const kept = store.set('sess-5', 'claude-sonnet-4-5', 'standard');
    // Same tier → keep existing pin
    expect(kept.modelId).toBe('claude-haiku-4-5');
    expect(kept.tier).toBe('standard');
  });

  it('expires sessions after timeout', () => {
    const shortStore = new SessionStore(100); // 100ms timeout
    shortStore.set('sess-6', 'claude-haiku-4-5', 'simple');

    // Immediately should work
    expect(shortStore.get('sess-6')).toBeDefined();

    // Mock time passage
    vi.useFakeTimers();
    vi.advanceTimersByTime(200);

    expect(shortStore.get('sess-6')).toBeUndefined();
    vi.useRealTimers();
  });

  it('cleanup prunes expired sessions', () => {
    const shortStore = new SessionStore(100); // 100ms timeout
    shortStore.set('sess-7', 'claude-haiku-4-5', 'simple');
    shortStore.set('sess-8', 'claude-sonnet-4-5', 'standard');

    expect(shortStore.size).toBe(2);

    vi.useFakeTimers();
    vi.advanceTimersByTime(200);
    shortStore.cleanup();

    expect(shortStore.size).toBe(0);
    vi.useRealTimers();
  });

  it('tracks session count', () => {
    expect(store.size).toBe(0);
    store.set('a', 'claude-haiku-4-5', 'simple');
    expect(store.size).toBe(1);
    store.set('b', 'claude-sonnet-4-5', 'standard');
    expect(store.size).toBe(2);
  });

  it('clearAll removes all sessions', () => {
    store.set('a', 'claude-haiku-4-5', 'simple');
    store.set('b', 'claude-sonnet-4-5', 'standard');
    store.clearAll();
    expect(store.size).toBe(0);
    expect(store.get('a')).toBeUndefined();
    expect(store.get('b')).toBeUndefined();
  });

  it('allows upgrade from standard to complex', () => {
    store.set('sess-9', 'claude-sonnet-4-5', 'standard');
    const upgraded = store.set('sess-9', 'claude-opus-4-6', 'complex');
    expect(upgraded.modelId).toBe('claude-opus-4-6');
    expect(upgraded.tier).toBe('complex');
  });

  it('prevents downgrade from complex to simple', () => {
    store.set('sess-10', 'claude-opus-4-6', 'complex');
    const kept = store.set('sess-10', 'gemini-2.5-flash', 'simple');
    expect(kept.modelId).toBe('claude-opus-4-6');
    expect(kept.tier).toBe('complex');
  });
});
