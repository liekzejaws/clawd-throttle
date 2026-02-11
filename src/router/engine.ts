import type { ClassificationResult } from '../classifier/types.js';
import type { ComplexityTier } from '../classifier/types.js';
import type { RoutingMode } from '../config/types.js';
import type { ThrottleConfig } from '../config/types.js';
import type { RoutingDecision, OverrideResult } from './types.js';
import type { ModelRegistry, RoutingTable } from './model-registry.js';

const TIER_ORDER: ComplexityTier[] = ['simple', 'standard', 'complex'];

export function routeRequest(
  classification: ClassificationResult,
  mode: RoutingMode,
  override: OverrideResult,
  registry: ModelRegistry,
  config: ThrottleConfig,
  routingTable: RoutingTable,
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

  // Tool-calling tier floor: tools need at least 'standard' tier capability
  let effectiveTier = classification.tier;
  if (override.kind === 'tool_calling') {
    const currentIdx = TIER_ORDER.indexOf(effectiveTier);
    const standardIdx = TIER_ORDER.indexOf('standard');
    if (currentIdx < standardIdx) {
      effectiveTier = 'standard';
    }
  }

  // Confidence step-up: if low confidence (< 0.70) and not already at highest tier,
  // route to next tier up for safety (inspired by ClawRouter's sigmoid calibration)
  if (classification.confidence < 0.70 && effectiveTier !== 'complex') {
    const idx = TIER_ORDER.indexOf(effectiveTier);
    effectiveTier = TIER_ORDER[idx + 1] ?? effectiveTier;
  }

  // Preference-list routing: pick first available model
  const preferenceList = routingTable[mode]?.[effectiveTier];
  if (!preferenceList || preferenceList.length === 0) {
    throw new Error(`No routing entry for mode=${mode}, tier=${effectiveTier}`);
  }

  const stepped = effectiveTier !== classification.tier;
  const overrideKind = override.kind === 'tool_calling' ? 'tool_calling' : 'none';
  const model = registry.resolvePreference(preferenceList, config);
  if (model) {
    const notes: string[] = [];
    if (override.kind === 'tool_calling') notes.push('tool_calling tier floor');
    if (stepped && classification.confidence < 0.70) notes.push(`confidence step-up from ${classification.tier} (confidence=${classification.confidence.toFixed(2)})`);
    const stepNote = notes.length > 0 ? ` (${notes.join(', ')})` : '';
    return {
      model,
      tier: effectiveTier,
      mode,
      override: overrideKind,
      reasoning: `Mode=${mode}, Tier=${effectiveTier}, Score=${classification.score.toFixed(3)}${stepNote} => ${model.displayName}`,
    };
  }

  // Fallback: try ANY available model (cheapest first)
  const fallback = registry.getCheapestAvailable(config);
  if (!fallback) {
    throw new Error('No models available — configure at least one provider API key');
  }

  return {
    model: fallback,
    tier: effectiveTier,
    mode,
    override: 'none',
    reasoning: `Fallback: no preferred model available for mode=${mode}, tier=${effectiveTier}. Using ${fallback.displayName}`,
  };
}
