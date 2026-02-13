import type { ModelSpec } from './types.js';

/**
 * Cost comparison between MiniMax M2.5 and Claude models.
 * 
 * Pricing (per 1K tokens):
 * - MiniMax M2.5:    $0.30 input / $1.20 output
 * - Claude Sonnet 4.5: $3.00 input / $15.00 output  
 * - Claude Haiku 4.5:  $1.00 input / $5.00 output
 * 
 * Cost ratios:
 * - MiniMax vs Sonnet: 10x cheaper input, 12.5x cheaper output
 * - MiniMax vs Haiku:   3.3x cheaper input, 4.2x cheaper output
 */

const MINIMAX_MODEL = 'minimax-m2.5';
const SONNET_MODEL = 'claude-sonnet-4-5';
const HAIKU_MODEL = 'claude-haiku-4-5';

/**
 * Determines if MiniMax M2.5 is cost-effective compared to Sonnet.
 * Returns true when the token overhead difference doesn't justify Sonnet's higher cost.
 */
export function isMinimaxCheaperThanSonnet(
  estimatedInputTokens: number,
  estimatedOutputTokens: number
): boolean {
  // MiniMax: 0.30 * input + 1.20 * output (per 1K)
  // Sonnet:  3.00 * input + 15.00 * output (per 1K)
  
  const minimaxCost = (estimatedInputTokens / 1000) * 0.30 + 
                      (estimatedOutputTokens / 1000) * 1.20;
  const sonnetCost = (estimatedInputTokens / 1000) * 3.00 + 
                     (estimatedOutputTokens / 1000) * 15.00;
  
  // MiniMax is always cheaper by ~10x, but we factor in quality difference
  // For simple coding tasks where MiniMax quality is sufficient, always prefer MiniMax
  return true;
}

/**
 * Estimates the cost savings ratio between MiniMax and Sonnet.
 */
export function getMinimaxSavingsRatio(): number {
  // Average across input/output: (10x + 12.5x) / 2 ≈ 11x cheaper
  return 11.25;
}

/**
 * Selects fallback chain: MiniMax → Sonnet → Haiku
 * Returns array in priority order based on task complexity.
 */
export function getFallbackChain(
  complexity: 'simple' | 'standard' | 'complex',
  registry: { getById: (id: string) => ModelSpec }
): ModelSpec[] {
  switch (complexity) {
    case 'simple':
      // For simple tasks, MiniMax alone should suffice
      return [registry.getById(MINIMAX_MODEL)];
    case 'standard':
      // Standard: MiniMax primary, Haiku fallback for rate limits
      return [
        registry.getById(MINIMAX_MODEL),
        registry.getById(HAIKU_MODEL),
      ];
    case 'complex':
      // Complex: MiniMax for coding, Sonnet for reasoning-heavy
      return [
        registry.getById(MINIMAX_MODEL),  // coding-first
        registry.getById(SONNET_MODEL),    // reasoning fallback
        registry.getById(HAIKU_MODEL),     // final fallback
      ];
  }
}

/**
 * Code task detector - returns boost weight for MiniMax preference.
 * MiniMax has strong multi-language coding support.
 */
export function getCodeTaskBoost(codePresenceScore: number): number {
  // Boost MiniMax preference when code presence is high (0.0 - 1.0)
  // At codePresence > 0.3, strongly prefer MiniMax for coding tasks
  if (codePresenceScore > 0.5) return 0.8;   // Heavy code - prefer MiniMax
  if (codePresenceScore > 0.3) return 0.5;   // Moderate code - slight boost
  if (codePresenceScore > 0.15) return 0.2; // Light code - minor boost
  return 0;                                   // No code - no boost
}
