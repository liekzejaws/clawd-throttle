import type { ComplexityTier } from '../classifier/types.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('session-store');

interface SessionEntry {
  modelId: string;
  tier: ComplexityTier;
  lastUsedAt: number;
  lastFailedAt?: number;
}

const TIER_RANK: Record<ComplexityTier, number> = {
  simple: 0,
  standard: 1,
  complex: 2,
};

/**
 * SessionStore provides model pinning for multi-turn conversations.
 * When a session ID is present, the same model is reused for consistency.
 * Upgrades are allowed (never downgrade within a session), and sessions
 * expire after 30 minutes of inactivity.
 *
 * Inspired by ClawRouter's session consistency mechanism.
 */
export class SessionStore {
  private sessions = new Map<string, SessionEntry>();
  private readonly timeoutMs: number;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(timeoutMs = 30 * 60 * 1000) { // 30 minutes default
    this.timeoutMs = timeoutMs;
  }

  /**
   * Get the pinned model for a session, if it exists and hasn't expired.
   * Returns undefined if no pin exists or the session has expired.
   */
  get(sessionId: string): { modelId: string; tier: ComplexityTier } | undefined {
    const entry = this.sessions.get(sessionId);
    if (!entry) return undefined;

    // Check expiration
    if (Date.now() - entry.lastUsedAt > this.timeoutMs) {
      this.sessions.delete(sessionId);
      log.debug(`Session expired: ${sessionId}`);
      return undefined;
    }

    return { modelId: entry.modelId, tier: entry.tier };
  }

  /**
   * Update or create a session pin. If the new tier is higher than the
   * existing tier, the pin is upgraded. If equal or lower, the existing
   * pin is kept (never downgrade).
   *
   * Returns the effective model and tier (may be the existing pin if no upgrade).
   */
  set(
    sessionId: string,
    modelId: string,
    tier: ComplexityTier,
  ): { modelId: string; tier: ComplexityTier } {
    const existing = this.get(sessionId);

    if (existing) {
      // Only upgrade, never downgrade
      if (TIER_RANK[tier] > TIER_RANK[existing.tier]) {
        log.info(`Session ${sessionId}: upgrading ${existing.tier} → ${tier} (${existing.modelId} → ${modelId})`);
        this.sessions.set(sessionId, {
          modelId,
          tier,
          lastUsedAt: Date.now(),
        });
        return { modelId, tier };
      }

      // Keep existing pin, just update lastUsedAt
      this.sessions.set(sessionId, {
        modelId: existing.modelId,
        tier: existing.tier,
        lastUsedAt: Date.now(),
      });
      return existing;
    }

    // New session
    log.info(`Session ${sessionId}: pinned to ${modelId} (${tier})`);
    this.sessions.set(sessionId, {
      modelId,
      tier,
      lastUsedAt: Date.now(),
    });
    return { modelId, tier };
  }

  /**
   * Mark a session as having experienced a failure.
   * On the next request, this will trigger tier escalation.
   */
  markFailed(sessionId: string): void {
    const entry = this.sessions.get(sessionId);
    if (entry) {
      entry.lastFailedAt = Date.now();
      log.info(`Session ${sessionId}: marked failed (will escalate next request)`);
    }
  }

  /**
   * Check if a session has a recent failure within the given window.
   * Clears the failure flag after reading (one-shot escalation).
   */
  hasRecentFailure(sessionId: string, withinMs = 5 * 60 * 1000): boolean {
    const entry = this.sessions.get(sessionId);
    if (!entry?.lastFailedAt) return false;

    const isRecent = Date.now() - entry.lastFailedAt <= withinMs;
    if (isRecent) {
      // Clear the flag so it only triggers once
      entry.lastFailedAt = undefined;
    }
    return isRecent;
  }

  /**
   * Start periodic cleanup of expired sessions (every 5 minutes).
   */
  startCleanup(): void {
    if (this.cleanupTimer) return;
    this.cleanupTimer = setInterval(() => this.cleanup(), 5 * 60 * 1000);
    // Don't prevent process exit
    if (this.cleanupTimer.unref) this.cleanupTimer.unref();
  }

  /**
   * Stop periodic cleanup.
   */
  stopCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  /**
   * Prune all expired sessions.
   */
  cleanup(): void {
    const now = Date.now();
    let pruned = 0;
    for (const [id, entry] of this.sessions) {
      if (now - entry.lastUsedAt > this.timeoutMs) {
        this.sessions.delete(id);
        pruned++;
      }
    }
    if (pruned > 0) {
      log.debug(`Session cleanup: pruned ${pruned} expired sessions, ${this.sessions.size} remaining`);
    }
  }

  /**
   * Get the number of active sessions.
   */
  get size(): number {
    return this.sessions.size;
  }

  /**
   * Clear all sessions (useful for testing).
   */
  clearAll(): void {
    this.sessions.clear();
  }
}
