import type { ClassificationResult } from '../classifier/types.js';
import type { RoutingMode } from '../config/types.js';
import type { RoutingDecision, OverrideResult } from './types.js';
import type { ModelRegistry } from './model-registry.js';

const FLASH = 'gemini-2.5-flash';
const SONNET = 'claude-sonnet-4-5-20250514';
const OPUS = 'claude-opus-4-5-20250514';

const ROUTING_TABLE: Record<RoutingMode, Record<string, string>> = {
  eco: {
    simple: FLASH,
    standard: FLASH,
    complex: SONNET,
  },
  standard: {
    simple: FLASH,
    standard: SONNET,
    complex: OPUS,
  },
  performance: {
    simple: SONNET,
    standard: OPUS,
    complex: OPUS,
  },
};

export function routeRequest(
  classification: ClassificationResult,
  mode: RoutingMode,
  override: OverrideResult,
  registry: ModelRegistry,
): RoutingDecision {
  // If an override is active, use the forced model
  if (override.kind !== 'none' && override.forcedModelId) {
    const model = registry.getById(override.forcedModelId);
    return {
      model,
      tier: classification.tier,
      mode,
      override: override.kind,
      reasoning: `Override ${override.kind}: forced to ${model.displayName}`,
    };
  }

  // Normal routing via the table
  const modelId = ROUTING_TABLE[mode]![classification.tier];
  if (!modelId) {
    throw new Error(`No routing entry for mode=${mode}, tier=${classification.tier}`);
  }

  const model = registry.getById(modelId);

  return {
    model,
    tier: classification.tier,
    mode,
    override: 'none',
    reasoning: `Mode=${mode}, Tier=${classification.tier}, Score=${classification.score.toFixed(3)} => ${model.displayName}`,
  };
}
