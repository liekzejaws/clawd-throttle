import { createLogger } from '../utils/logger.js';

const log = createLogger('rate-limiter');

/**
 * Tracks rate-limited models with time-based cooldowns.
 * Inspired by ClawRouter's retry logic — when a provider returns 429,
 * the model is marked rate-limited for a cooldown period and skipped
 * in preference list resolution.
 */
export class RateLimiter {
  private cooldowns = new Map<string, number>(); // modelId → expiresAt (Date.now() + cooldownMs)

  /**
   * Mark a model as rate-limited for the specified cooldown period.
   */
  markRateLimited(modelId: string, cooldownMs = 60_000): void {
    const expiresAt = Date.now() + cooldownMs;
    this.cooldowns.set(modelId, expiresAt);
    log.info(`Rate-limited: ${modelId} for ${cooldownMs}ms (until ${new Date(expiresAt).toISOString()})`);
  }

  /**
   * Check if a model is currently rate-limited.
   * Auto-prunes expired entries.
   */
  isRateLimited(modelId: string): boolean {
    const expiresAt = this.cooldowns.get(modelId);
    if (expiresAt === undefined) return false;

    if (Date.now() >= expiresAt) {
      this.cooldowns.delete(modelId);
      log.debug(`Rate-limit expired: ${modelId}`);
      return false;
    }

    return true;
  }

  /**
   * Filter a list of model IDs, removing any that are currently rate-limited.
   * Returns the subset that is available.
   */
  filterAvailable(modelIds: string[]): string[] {
    return modelIds.filter(id => !this.isRateLimited(id));
  }

  /**
   * Clear a specific model's rate-limit status (e.g., on successful request).
   */
  clear(modelId: string): void {
    this.cooldowns.delete(modelId);
  }

  /**
   * Clear all rate-limit state.
   */
  clearAll(): void {
    this.cooldowns.clear();
  }

  /**
   * Get the number of currently rate-limited models.
   */
  get size(): number {
    // Prune expired entries first
    const now = Date.now();
    for (const [id, expiresAt] of this.cooldowns) {
      if (now >= expiresAt) this.cooldowns.delete(id);
    }
    return this.cooldowns.size;
  }
}

// Singleton instance used across the application
export const rateLimiter = new RateLimiter();
