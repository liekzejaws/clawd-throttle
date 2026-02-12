import { describe, it, expect } from 'vitest';
import { routeRequest } from '../../../src/router/engine.js';
import { ModelRegistry, loadRoutingTable } from '../../../src/router/model-registry.js';
import type { ClassificationResult } from '../../../src/classifier/types.js';
import type { OverrideResult } from '../../../src/router/types.js';
import type { ThrottleConfig } from '../../../src/config/types.js';
import path from 'node:path';

const registry = new ModelRegistry(path.resolve('data/model-catalog.json'));
const routingTable = loadRoutingTable(path.resolve('data/routing-table.json'));
const noOverride: OverrideResult = { kind: 'none' };

// Config with Anthropic + Google + Ollama configured (backward-compat baseline)
const config = {
  mode: 'standard',
  anthropic: { apiKey: 'test-key', setupToken: '', preferSetupToken: true, baseUrl: 'https://api.anthropic.com', authType: 'auto' },
  google: { apiKey: 'test-key', baseUrl: 'https://generativelanguage.googleapis.com' },
  openai: { apiKey: '', baseUrl: 'https://api.openai.com/v1' },
  deepseek: { apiKey: '', baseUrl: 'https://api.deepseek.com/v1' },
  xai: { apiKey: '', baseUrl: 'https://api.x.ai/v1' },
  moonshot: { apiKey: '', baseUrl: 'https://api.moonshot.ai/v1' },
  mistral: { apiKey: '', baseUrl: 'https://api.mistral.ai/v1' },
  ollama: { apiKey: '', baseUrl: 'http://localhost:11434/v1' },
  logging: { level: 'info', logFilePath: '' },
  classifier: { weightsPath: '', thresholds: { simpleMax: 0.18, complexMin: 0.50 } },
  modelCatalogPath: '',
  routingTablePath: '',
  http: { port: 8484, enabled: false },
} as ThrottleConfig;

function makeClassification(tier: 'simple' | 'standard' | 'complex', score: number, confidence = 0.95): ClassificationResult {
  return {
    tier,
    score,
    confidence,
    dimensions: {
      tokenCount: 0, codePresence: 0, reasoningMarkers: 0,
      simpleIndicators: 0, multiStepPatterns: 0, questionCount: 0,
      systemPromptSignals: 0, conversationDepth: 0,
      agenticTask: 0, technicalTerms: 0, constraintCount: 0, escalationSignals: 0,
    },
    classifiedInMs: 0.1,
  };
}

describe('routeRequest', () => {
  describe('eco mode', () => {
    it('routes simple to Flash (Grok Fast not configured)', () => {
      const result = routeRequest(makeClassification('simple', 0.1), 'eco', noOverride, registry, config, routingTable);
      // Preference: grok-fast (xai, not configured), gemini-2.5-flash (google, configured)
      expect(result.model.id).toBe('gemini-2.5-flash');
    });

    it('routes standard to Flash', () => {
      const result = routeRequest(makeClassification('standard', 0.4), 'eco', noOverride, registry, config, routingTable);
      // Preference: gemini-2.5-flash, grok-fast, gpt-4o-mini, deepseek-chat
      expect(result.model.id).toBe('gemini-2.5-flash');
    });

    it('routes complex to Haiku', () => {
      const result = routeRequest(makeClassification('complex', 0.8), 'eco', noOverride, registry, config, routingTable);
      // Preference: claude-haiku-4-5, deepseek-reasoner, kimi-k2.5, grok-3-mini
      expect(result.model.id).toBe('claude-haiku-4-5');
    });
  });

  describe('standard mode', () => {
    it('routes simple to Flash (Grok Fast not configured)', () => {
      const result = routeRequest(makeClassification('simple', 0.1), 'standard', noOverride, registry, config, routingTable);
      // Preference: grok-fast (xai, not configured), gemini-2.5-flash (google, configured)
      expect(result.model.id).toBe('gemini-2.5-flash');
    });

    it('routes standard to Haiku', () => {
      const result = routeRequest(makeClassification('standard', 0.4), 'standard', noOverride, registry, config, routingTable);
      // Preference: claude-haiku-4-5, grok-fast, gemini-2.5-flash, deepseek-chat
      expect(result.model.id).toBe('claude-haiku-4-5');
    });

    it('routes complex to Sonnet', () => {
      const result = routeRequest(makeClassification('complex', 0.8), 'standard', noOverride, registry, config, routingTable);
      // Preference: claude-sonnet-4-5, claude-haiku-4-5, gpt-5.1, deepseek-reasoner
      expect(result.model.id).toBe('claude-sonnet-4-5');
    });
  });

  describe('gigachad mode', () => {
    it('routes simple to Haiku', () => {
      const result = routeRequest(makeClassification('simple', 0.1), 'gigachad', noOverride, registry, config, routingTable);
      // Preference: claude-haiku-4-5, grok-fast, gemini-2.5-flash
      expect(result.model.id).toBe('claude-haiku-4-5');
    });

    it('routes standard to Sonnet', () => {
      const result = routeRequest(makeClassification('standard', 0.4), 'gigachad', noOverride, registry, config, routingTable);
      // Preference: claude-sonnet-4-5, claude-haiku-4-5, gpt-5.1, grok-4
      expect(result.model.id).toBe('claude-sonnet-4-5');
    });

    it('routes complex to Opus 4.6', () => {
      const result = routeRequest(makeClassification('complex', 0.8), 'gigachad', noOverride, registry, config, routingTable);
      // Preference: claude-opus-4-6, claude-sonnet-4-5, gpt-5.2, o3
      expect(result.model.id).toBe('claude-opus-4-6');
    });
  });

  describe('overrides', () => {
    it('uses forced model when override is active', () => {
      const override: OverrideResult = { kind: 'force_opus', forcedModelId: 'claude-opus-4-6' };
      const result = routeRequest(makeClassification('simple', 0.1), 'eco', override, registry, config, routingTable);
      expect(result.model.id).toBe('claude-opus-4-6');
      expect(result.override).toBe('force_opus');
    });

    it('uses normal routing when override is none', () => {
      const result = routeRequest(makeClassification('standard', 0.4), 'eco', noOverride, registry, config, routingTable);
      expect(result.override).toBe('none');
      expect(result.model.id).toBe('gemini-2.5-flash');
    });
  });

  describe('tool_calling tier floor', () => {
    const toolOverride: OverrideResult = { kind: 'tool_calling' };

    it('bumps simple to standard in eco mode', () => {
      const result = routeRequest(makeClassification('simple', 0.1), 'eco', toolOverride, registry, config, routingTable);
      // Simple → standard floor → eco standard preference list
      expect(result.tier).toBe('standard');
      expect(result.override).toBe('tool_calling');
    });

    it('keeps standard as-is in standard mode', () => {
      const result = routeRequest(makeClassification('standard', 0.4), 'standard', toolOverride, registry, config, routingTable);
      expect(result.tier).toBe('standard');
      expect(result.override).toBe('tool_calling');
    });

    it('keeps complex as-is (already above floor)', () => {
      const result = routeRequest(makeClassification('complex', 0.8), 'gigachad', toolOverride, registry, config, routingTable);
      expect(result.tier).toBe('complex');
      expect(result.model.id).toBe('claude-opus-4-6');
    });

    it('tool_calling + low confidence can step up further', () => {
      // simple → standard (tool floor) → complex (confidence step-up)
      const result = routeRequest(makeClassification('simple', 0.1, 0.40), 'standard', toolOverride, registry, config, routingTable);
      expect(result.tier).toBe('complex');
    });
  });
});
