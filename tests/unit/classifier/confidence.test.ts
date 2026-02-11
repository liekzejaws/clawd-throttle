import { describe, it, expect } from 'vitest';
import { calibrateConfidence, classifyPrompt, loadWeights } from '../../../src/classifier/engine.js';
import path from 'node:path';

const weights = loadWeights(path.resolve('data/classifier-weights.json'));
const thresholds = { simpleMax: 0.18, complexMin: 0.50 };

describe('calibrateConfidence', () => {
  it('returns ~0.50 at exact boundary (simpleMax)', () => {
    const confidence = calibrateConfidence(0.18, 'simple', thresholds);
    expect(confidence).toBeCloseTo(0.50, 1);
  });

  it('returns ~0.50 at exact boundary (complexMin)', () => {
    const confidence = calibrateConfidence(0.50, 'complex', thresholds);
    expect(confidence).toBeCloseTo(0.50, 1);
  });

  it('returns high confidence far below simpleMax', () => {
    // score=0.0, distance from simpleMax = 0.18
    const confidence = calibrateConfidence(0.0, 'simple', thresholds);
    expect(confidence).toBeGreaterThan(0.85);
  });

  it('returns high confidence far above complexMin', () => {
    // score=0.8, distance from complexMin = 0.30
    const confidence = calibrateConfidence(0.8, 'complex', thresholds);
    expect(confidence).toBeGreaterThan(0.95);
  });

  it('returns low confidence near simpleMax from standard side', () => {
    // score=0.19 in standard tier, barely above 0.18
    const confidence = calibrateConfidence(0.19, 'standard', thresholds);
    expect(confidence).toBeLessThan(0.70);
  });

  it('returns high confidence in middle of standard range', () => {
    // score=0.34, midpoint of [0.18, 0.50], distance = min(0.16, 0.16) = 0.16
    const confidence = calibrateConfidence(0.34, 'standard', thresholds);
    expect(confidence).toBeGreaterThan(0.80);
  });

  it('returns low confidence near complexMin from standard side', () => {
    // score=0.49 in standard tier, barely below 0.50
    const confidence = calibrateConfidence(0.49, 'standard', thresholds);
    expect(confidence).toBeLessThan(0.70);
  });
});

describe('classifyPrompt confidence integration', () => {
  it('includes confidence field in result', () => {
    const result = classifyPrompt('hello', {}, weights, thresholds);
    expect(result).toHaveProperty('confidence');
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });

  it('greetings get high confidence (far from boundary)', () => {
    const result = classifyPrompt('hello', {}, weights, thresholds);
    expect(result.tier).toBe('simple');
    expect(result.confidence).toBeGreaterThan(0.80);
  });

  it('complex prompts get reasonable confidence', () => {
    const text = `I need you to architect a complete microservices system.
1. Design user auth with OAuth2
2. Create API gateway with rate limiting
3. Implement event-driven communication
Explain the trade-offs step by step. Debug potential race conditions.`;
    const result = classifyPrompt(text, {
      messageCount: 15,
      systemPrompt: 'You are a senior architect. You must provide structured JSON responses.',
    }, weights, thresholds);
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });
});
