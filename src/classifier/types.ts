export type ComplexityTier = 'simple' | 'standard' | 'complex';

export type DimensionKey =
  | 'tokenCount' | 'codePresence' | 'reasoningMarkers' | 'simpleIndicators'
  | 'multiStepPatterns' | 'questionCount' | 'systemPromptSignals'
  | 'conversationDepth' | 'agenticTask' | 'technicalTerms'
  | 'constraintCount' | 'escalationSignals' | 'multiLanguageCode';

export type DimensionScores = Record<DimensionKey, number>;
export type DimensionWeights = Record<DimensionKey, number>;

export interface ClassificationMeta {
  messageCount?: number;
  systemPrompt?: string;
}

export interface ClassificationResult {
  tier: ComplexityTier;
  score: number;
  confidence: number;
  dimensions: DimensionScores;
  classifiedInMs: number;
}
