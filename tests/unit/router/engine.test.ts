import { describe, it, expect } from 'vitest';
import { routeRequest } from '../../../src/router/engine.js';
import { ModelRegistry } from '../../../src/router/model-registry.js';
import type { ClassificationResult } from '../../../src/classifier/types.js';
import type { OverrideResult } from '../../../src/router/types.js';
import path from 'node:path';

const registry = new ModelRegistry(path.resolve('data/model-catalog.json'));
const noOverride: OverrideResult = { kind: 'none' };

function makeClassification(tier: 'simple' | 'standard' | 'complex', score: number): ClassificationResult {
  return {
    tier,
    score,
    dimensions: {
      tokenCount: 0, codePresence: 0, reasoningMarkers: 0,
      simpleIndicators: 0, multiStepPatterns: 0, questionCount: 0,
      systemPromptSignals: 0, conversationDepth: 0,
    },
    classifiedInMs: 0.1,
  };
}

describe('routeRequest', () => {
  describe('eco mode', () => {
    it('routes simple to Flash', () => {
      const result = routeRequest(makeClassification('simple', 0.1), 'eco', noOverride, registry);
      expect(result.model.id).toBe('gemini-2.5-flash');
    });

    it('routes standard to Flash', () => {
      const result = routeRequest(makeClassification('standard', 0.4), 'eco', noOverride, registry);
      expect(result.model.id).toBe('gemini-2.5-flash');
    });

    it('routes complex to Sonnet', () => {
      const result = routeRequest(makeClassification('complex', 0.8), 'eco', noOverride, registry);
      expect(result.model.id).toBe('claude-sonnet-4-5-20250514');
    });
  });

  describe('standard mode', () => {
    it('routes simple to Flash', () => {
      const result = routeRequest(makeClassification('simple', 0.1), 'standard', noOverride, registry);
      expect(result.model.id).toBe('gemini-2.5-flash');
    });

    it('routes standard to Sonnet', () => {
      const result = routeRequest(makeClassification('standard', 0.4), 'standard', noOverride, registry);
      expect(result.model.id).toBe('claude-sonnet-4-5-20250514');
    });

    it('routes complex to Opus', () => {
      const result = routeRequest(makeClassification('complex', 0.8), 'standard', noOverride, registry);
      expect(result.model.id).toBe('claude-opus-4-5-20250514');
    });
  });

  describe('performance mode', () => {
    it('routes simple to Sonnet', () => {
      const result = routeRequest(makeClassification('simple', 0.1), 'performance', noOverride, registry);
      expect(result.model.id).toBe('claude-sonnet-4-5-20250514');
    });

    it('routes standard to Opus', () => {
      const result = routeRequest(makeClassification('standard', 0.4), 'performance', noOverride, registry);
      expect(result.model.id).toBe('claude-opus-4-5-20250514');
    });

    it('routes complex to Opus', () => {
      const result = routeRequest(makeClassification('complex', 0.8), 'performance', noOverride, registry);
      expect(result.model.id).toBe('claude-opus-4-5-20250514');
    });
  });

  describe('overrides', () => {
    it('uses forced model when override is active', () => {
      const override: OverrideResult = { kind: 'force_opus', forcedModelId: 'claude-opus-4-5-20250514' };
      const result = routeRequest(makeClassification('simple', 0.1), 'eco', override, registry);
      expect(result.model.id).toBe('claude-opus-4-5-20250514');
      expect(result.override).toBe('force_opus');
    });

    it('uses normal routing when override is none', () => {
      const result = routeRequest(makeClassification('simple', 0.1), 'eco', noOverride, registry);
      expect(result.override).toBe('none');
      expect(result.model.id).toBe('gemini-2.5-flash');
    });
  });
});
