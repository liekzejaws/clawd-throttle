import { describe, it, expect, beforeEach } from 'vitest';
import { detectOverrides } from '../../../src/router/overrides.js';
import { LogReader } from '../../../src/logging/reader.js';
import { LogWriter } from '../../../src/logging/writer.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('detectOverrides', () => {
  let logReader: LogReader;
  let logWriter: LogWriter;
  let tmpLogFile: string;

  beforeEach(() => {
    tmpLogFile = path.join(os.tmpdir(), `clawd-throttle-test-${Date.now()}.jsonl`);
    logReader = new LogReader(tmpLogFile);
    logWriter = new LogWriter(tmpLogFile);
  });

  describe('heartbeat detection', () => {
    it('detects ping as heartbeat', () => {
      const result = detectOverrides([{ role: 'user', content: 'ping' }], undefined, undefined, logReader);
      expect(result.kind).toBe('heartbeat');
      expect(result.forcedModelId).toBe('gemini-2.5-flash');
    });

    it('detects summarize as heartbeat', () => {
      const result = detectOverrides([{ role: 'user', content: 'summarize this' }], undefined, undefined, logReader);
      expect(result.kind).toBe('heartbeat');
    });

    it('does not detect normal text as heartbeat', () => {
      const result = detectOverrides([{ role: 'user', content: 'Write a function' }], undefined, undefined, logReader);
      expect(result.kind).toBe('none');
    });
  });

  describe('force commands', () => {
    it('detects forceModel parameter', () => {
      const result = detectOverrides([{ role: 'user', content: 'hello' }], 'opus', undefined, logReader);
      expect(result.kind).toBe('force_opus');
      expect(result.forcedModelId).toBe('claude-opus-4-5-20250514');
    });

    it('detects /opus prefix', () => {
      const result = detectOverrides([{ role: 'user', content: '/opus write code' }], undefined, undefined, logReader);
      expect(result.kind).toBe('force_opus');
    });

    it('detects /sonnet prefix', () => {
      const result = detectOverrides([{ role: 'user', content: '/sonnet quick question' }], undefined, undefined, logReader);
      expect(result.kind).toBe('force_sonnet');
    });

    it('detects /flash prefix', () => {
      const result = detectOverrides([{ role: 'user', content: '/flash hello' }], undefined, undefined, logReader);
      expect(result.kind).toBe('force_flash');
    });
  });

  describe('sub-agent step-down', () => {
    it('steps down from Opus to Sonnet', () => {
      const parentId = 'test-parent-id';
      logWriter.append({
        requestId: parentId,
        timestamp: new Date().toISOString(),
        promptHash: 'abc',
        compositeScore: 0.8,
        tier: 'complex',
        selectedModel: 'claude-opus-4-5-20250514',
        provider: 'anthropic',
        mode: 'standard',
        override: 'none',
        inputTokens: 100,
        outputTokens: 200,
        estimatedCostUsd: 0.01,
        latencyMs: 500,
      });

      const result = detectOverrides(
        [{ role: 'user', content: 'sub task' }],
        undefined,
        parentId,
        logReader,
      );
      expect(result.kind).toBe('sub_agent_stepdown');
      expect(result.forcedModelId).toBe('claude-sonnet-4-5-20250514');
    });

    it('steps down from Sonnet to Flash', () => {
      const parentId = 'test-parent-sonnet';
      logWriter.append({
        requestId: parentId,
        timestamp: new Date().toISOString(),
        promptHash: 'abc',
        compositeScore: 0.5,
        tier: 'standard',
        selectedModel: 'claude-sonnet-4-5-20250514',
        provider: 'anthropic',
        mode: 'standard',
        override: 'none',
        inputTokens: 100,
        outputTokens: 200,
        estimatedCostUsd: 0.01,
        latencyMs: 500,
      });

      const result = detectOverrides(
        [{ role: 'user', content: 'sub task' }],
        undefined,
        parentId,
        logReader,
      );
      expect(result.kind).toBe('sub_agent_stepdown');
      expect(result.forcedModelId).toBe('gemini-2.5-flash');
    });

    it('inherits Flash (already cheapest)', () => {
      const parentId = 'test-parent-flash';
      logWriter.append({
        requestId: parentId,
        timestamp: new Date().toISOString(),
        promptHash: 'abc',
        compositeScore: 0.1,
        tier: 'simple',
        selectedModel: 'gemini-2.5-flash',
        provider: 'google',
        mode: 'eco',
        override: 'none',
        inputTokens: 50,
        outputTokens: 100,
        estimatedCostUsd: 0.001,
        latencyMs: 200,
      });

      const result = detectOverrides(
        [{ role: 'user', content: 'sub task' }],
        undefined,
        parentId,
        logReader,
      );
      expect(result.kind).toBe('sub_agent_inherit');
      expect(result.forcedModelId).toBe('gemini-2.5-flash');
    });
  });

  describe('priority order', () => {
    it('heartbeat takes priority over force commands', () => {
      const result = detectOverrides([{ role: 'user', content: 'ping' }], 'opus', undefined, logReader);
      expect(result.kind).toBe('heartbeat');
    });
  });
});
