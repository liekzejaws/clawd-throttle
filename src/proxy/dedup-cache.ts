import { createHash } from 'node:crypto';
import { createLogger } from '../utils/logger.js';

const log = createLogger('dedup-cache');

/**
 * A cached response stored after a request completes.
 */
export interface CachedResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
  completedAt: number;
}

/**
 * In-flight request tracking: resolvers waiting for same-keyed requests.
 */
interface InflightEntry {
  promise: Promise<CachedResponse>;
  resolve: (response: CachedResponse) => void;
  reject: (error: Error) => void;
}

/**
 * DedupCache prevents duplicate requests from being classified, routed,
 * and billed twice within a short window. Inspired by ClawRouter's
 * response deduplication.
 *
 * SHA-256 hash of canonical request body → 30-second TTL cache.
 * If the same hash arrives while the first is in-flight, callers
 * await the first response and return the cached result.
 */
export class DedupCache {
  private completed = new Map<string, CachedResponse>();
  private inflight = new Map<string, InflightEntry>();
  private readonly ttlMs: number;

  constructor(ttlMs = 30_000) {
    this.ttlMs = ttlMs;
  }

  /**
   * Compute a canonical dedup key from messages and optional system prompt.
   * Strips OpenClaw timestamp prefixes like [DAY YYYY-MM-DD HH:MM TZ].
   * Returns first 16 hex chars of SHA-256.
   */
  computeKey(messages: Array<{ role: string; content: string }>, systemPrompt?: string): string {
    // Canonical form: sorted by role then content, timestamps stripped
    const canonical = messages.map(m => ({
      role: m.role,
      content: m.content.replace(/^\[(?:MON|TUE|WED|THU|FRI|SAT|SUN)\s\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}\s\w+\]\s*/i, ''),
    }));

    const payload = JSON.stringify({
      system: systemPrompt ?? '',
      messages: canonical,
    });

    return createHash('sha256').update(payload, 'utf-8').digest('hex').slice(0, 16);
  }

  /**
   * Check for a completed (cached) response. Returns undefined if not found or expired.
   */
  getCompleted(key: string): CachedResponse | undefined {
    const entry = this.completed.get(key);
    if (!entry) return undefined;

    // Check TTL
    if (Date.now() - entry.completedAt > this.ttlMs) {
      this.completed.delete(key);
      return undefined;
    }

    log.info(`Dedup cache hit: ${key}`);
    return entry;
  }

  /**
   * Check if a request with this key is already in-flight.
   * If yes, returns the promise to await. If no, creates a new in-flight entry
   * and returns undefined (caller should proceed with the request).
   */
  markInflight(key: string): { isWaiting: true; promise: Promise<CachedResponse> } | { isWaiting: false } {
    const existing = this.inflight.get(key);
    if (existing) {
      log.info(`Dedup in-flight join: ${key}`);
      return { isWaiting: true, promise: existing.promise };
    }

    // Create new in-flight entry
    let resolve!: (response: CachedResponse) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<CachedResponse>((res, rej) => {
      resolve = res;
      reject = rej;
    });

    // Prevent unhandled rejection warnings — waiters attach their own handlers
    promise.catch(() => {});

    this.inflight.set(key, { promise, resolve, reject });
    return { isWaiting: false };
  }

  /**
   * Mark a request as completed. Caches the response and resolves any waiters.
   */
  complete(key: string, response: CachedResponse): void {
    const entry = this.inflight.get(key);
    if (entry) {
      entry.resolve(response);
      this.inflight.delete(key);
    }

    this.completed.set(key, response);
    log.debug(`Dedup cached: ${key}`);

    // Prune old completed entries
    this.prune();
  }

  /**
   * Remove an in-flight entry on error (don't cache errors).
   */
  removeInflight(key: string, error?: Error): void {
    const entry = this.inflight.get(key);
    if (entry) {
      entry.reject(error ?? new Error('Request failed'));
      this.inflight.delete(key);
    }
  }

  /**
   * Prune expired completed entries.
   */
  private prune(): void {
    const now = Date.now();
    for (const [key, entry] of this.completed) {
      if (now - entry.completedAt > this.ttlMs) {
        this.completed.delete(key);
      }
    }
  }

  /**
   * Number of completed (cached) entries.
   */
  get completedSize(): number {
    return this.completed.size;
  }

  /**
   * Number of in-flight entries.
   */
  get inflightSize(): number {
    return this.inflight.size;
  }

  /**
   * Clear all state (useful for testing).
   */
  clearAll(): void {
    // Reject any pending in-flight promises
    for (const [, entry] of this.inflight) {
      entry.reject(new Error('Cache cleared'));
    }
    this.inflight.clear();
    this.completed.clear();
  }
}
