import fs from 'node:fs';
import { performance } from 'node:perf_hooks';
import type {
  ClassificationResult,
  ClassificationMeta,
  DimensionScores,
  DimensionWeights,
  ComplexityTier,
} from './types.js';
import {
  scoreTokenCount,
  scoreCodePresence,
  scoreReasoningMarkers,
  scoreSimpleIndicators,
  scoreMultiStepPatterns,
  scoreQuestionCount,
  scoreSystemPromptSignals,
  scoreConversationDepth,
  scoreAgenticTask,
  scoreTechnicalTerms,
  scoreConstraintCount,
  scoreEscalationSignals,
} from './dimensions.js';

const DEFAULT_WEIGHTS: DimensionWeights = {
  tokenCount: 0.10,
  codePresence: 0.20,
  reasoningMarkers: 0.22,
  simpleIndicators: -0.15,
  multiStepPatterns: 0.18,
  questionCount: 0.06,
  systemPromptSignals: 0.09,
  conversationDepth: 0.10,
  agenticTask: 0.02,
  technicalTerms: 0.05,
  constraintCount: 0.03,
  escalationSignals: 0.12,
};

export function loadWeights(weightsPath: string): DimensionWeights {
  if (!weightsPath || !fs.existsSync(weightsPath)) {
    return { ...DEFAULT_WEIGHTS };
  }
  const raw = fs.readFileSync(weightsPath, 'utf-8');
  return JSON.parse(raw) as DimensionWeights;
}

/**
 * Sigmoid confidence calibration — inspired by ClawRouter.
 * Maps distance-from-nearest-boundary into a 0–1 confidence score.
 * Near-boundary classifications get low confidence (~0.50),
 * far-from-boundary ones get high confidence (~1.0).
 */
export function calibrateConfidence(
  composite: number,
  tier: ComplexityTier,
  thresholds: { simpleMax: number; complexMin: number },
  steepness = 10,
): number {
  let distance: number;

  if (tier === 'simple') {
    // Distance from simpleMax boundary (how far below)
    distance = thresholds.simpleMax - composite;
  } else if (tier === 'complex') {
    // Distance from complexMin boundary (how far above)
    distance = composite - thresholds.complexMin;
  } else {
    // Standard tier: distance from nearest boundary
    distance = Math.min(
      composite - thresholds.simpleMax,
      thresholds.complexMin - composite,
    );
  }

  // Sigmoid: 1 / (1 + e^(-steepness * distance))
  return 1 / (1 + Math.exp(-steepness * distance));
}

export function classifyPrompt(
  text: string,
  meta: ClassificationMeta,
  weights: DimensionWeights,
  thresholds: { simpleMax: number; complexMin: number },
): ClassificationResult {
  const t0 = performance.now();

  const dimensions: DimensionScores = {
    tokenCount: scoreTokenCount(text),
    codePresence: scoreCodePresence(text),
    reasoningMarkers: scoreReasoningMarkers(text),
    simpleIndicators: scoreSimpleIndicators(text),
    multiStepPatterns: scoreMultiStepPatterns(text),
    questionCount: scoreQuestionCount(text),
    systemPromptSignals: scoreSystemPromptSignals(meta.systemPrompt),
    conversationDepth: scoreConversationDepth(meta.messageCount),
    agenticTask: scoreAgenticTask(text),
    technicalTerms: scoreTechnicalTerms(text),
    constraintCount: scoreConstraintCount(text),
    escalationSignals: scoreEscalationSignals(text),
  };

  let composite = 0;
  const keys = Object.keys(weights) as (keyof DimensionWeights)[];
  for (const key of keys) {
    composite += dimensions[key] * weights[key];
  }

  composite = Math.max(0, Math.min(1, composite));

  let tier: ComplexityTier;
  if (composite <= thresholds.simpleMax) {
    tier = 'simple';
  } else if (composite >= thresholds.complexMin) {
    tier = 'complex';
  } else {
    tier = 'standard';
  }

  const confidence = calibrateConfidence(composite, tier, thresholds);

  const t1 = performance.now();

  return {
    tier,
    score: composite,
    confidence,
    dimensions,
    classifiedInMs: t1 - t0,
  };
}
