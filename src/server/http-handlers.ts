import http from 'node:http';
import crypto from 'node:crypto';
import { performance } from 'node:perf_hooks';
import type { ThrottleConfig } from '../config/types.js';
import type { DimensionWeights } from '../classifier/types.js';
import type { ModelRegistry } from '../router/model-registry.js';
import type { LogWriter } from '../logging/writer.js';
import type { LogReader } from '../logging/reader.js';
import type { ApiProvider } from '../router/types.js';
import { classifyPrompt } from '../classifier/engine.js';
import { routeRequest } from '../router/engine.js';
import { detectOverrides } from '../router/overrides.js';
import { dispatch, streamDispatch } from '../proxy/dispatcher.js';
import { estimateCost } from '../logging/writer.js';
import { computeStats } from '../logging/stats.js';
import { hashPrompt } from '../utils/hash.js';
import { createLogger } from '../utils/logger.js';
import { parseAnthropicRequest, formatAnthropicResponse, transformGoogleSseToAnthropic } from './format-anthropic.js';
import { parseOpenAiRequest, formatOpenAiResponse, transformAnthropicSseToOpenAi, transformGoogleSseToOpenAi, extractAnthropicTokens, extractGoogleTokens } from './format-openai.js';

const log = createLogger('http');

export interface HandlerDeps {
  config: ThrottleConfig;
  registry: ModelRegistry;
  weights: DimensionWeights;
  logWriter: LogWriter;
  logReader: LogReader;
}

// ─── GET /health ───────────────────────────────────────────────────────

export function handleHealth(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  config: ThrottleConfig,
): void {
  sendJson(res, 200, {
    status: 'ok',
    mode: config.mode,
    uptime: Math.round(process.uptime()),
  });
}

// ─── GET /stats ────────────────────────────────────────────────────────

export function handleStats(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  logReader: LogReader,
): void {
  const url = new URL(req.url ?? '/', `http://localhost`);
  const days = parseInt(url.searchParams.get('days') ?? '30', 10) || 30;

  const since = new Date();
  since.setDate(since.getDate() - days);
  const entries = logReader.readSince(since.toISOString());
  const stats = computeStats(entries);

  sendJson(res, 200, stats);
}

// ─── POST /v1/messages (Anthropic format) ──────────────────────────────

export async function handleMessages(
  body: Record<string, unknown>,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  deps: HandlerDeps,
): Promise<void> {
  const { config, registry, weights, logWriter, logReader } = deps;

  const parsed = parseAnthropicRequest(body);
  const forceModel = getForceModel(req);
  const requestId = crypto.randomUUID();

  // Classify and route
  const { decision, classification } = classifyAndRoute(
    parsed.messages, parsed.systemPrompt, forceModel, config, registry, weights, logReader,
  );

  // Set routing headers
  setThrottleHeaders(res, decision.model.id, classification.tier, classification.score, requestId);

  const proxyRequest = {
    provider: decision.model.provider,
    modelId: decision.model.id,
    messages: parsed.messages,
    systemPrompt: parsed.systemPrompt,
    maxTokens: parsed.maxTokens,
    temperature: parsed.temperature,
  };

  if (parsed.stream) {
    await handleStreamingResponse(
      proxyRequest, decision, classification, config, requestId,
      'anthropic', res, logWriter, parsed.messages,
    );
  } else {
    const proxyResponse = await dispatch(proxyRequest, config);
    const cost = estimateCost(decision.model, proxyResponse.inputTokens, proxyResponse.outputTokens);

    writeLogEntry(logWriter, requestId, classification, decision, proxyResponse.inputTokens,
      proxyResponse.outputTokens, cost, proxyResponse.latencyMs, parsed.messages);

    sendJson(res, 200, formatAnthropicResponse(proxyResponse, requestId));
  }
}

// ─── POST /v1/chat/completions (OpenAI format) ─────────────────────────

export async function handleChatCompletions(
  body: Record<string, unknown>,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  deps: HandlerDeps,
): Promise<void> {
  const { config, registry, weights, logWriter, logReader } = deps;

  const parsed = parseOpenAiRequest(body);
  const forceModel = getForceModel(req);
  const requestId = crypto.randomUUID();

  const { decision, classification } = classifyAndRoute(
    parsed.messages, parsed.systemPrompt, forceModel, config, registry, weights, logReader,
  );

  setThrottleHeaders(res, decision.model.id, classification.tier, classification.score, requestId);

  const proxyRequest = {
    provider: decision.model.provider,
    modelId: decision.model.id,
    messages: parsed.messages,
    systemPrompt: parsed.systemPrompt,
    maxTokens: parsed.maxTokens,
    temperature: parsed.temperature,
  };

  if (parsed.stream) {
    await handleStreamingResponse(
      proxyRequest, decision, classification, config, requestId,
      'openai', res, logWriter, parsed.messages,
    );
  } else {
    const proxyResponse = await dispatch(proxyRequest, config);
    const cost = estimateCost(decision.model, proxyResponse.inputTokens, proxyResponse.outputTokens);

    writeLogEntry(logWriter, requestId, classification, decision, proxyResponse.inputTokens,
      proxyResponse.outputTokens, cost, proxyResponse.latencyMs, parsed.messages);

    sendJson(res, 200, formatOpenAiResponse(proxyResponse, requestId));
  }
}

// ─── Streaming ─────────────────────────────────────────────────────────

async function handleStreamingResponse(
  proxyRequest: { provider: ApiProvider; modelId: string; messages: Array<{ role: string; content: string }>; systemPrompt?: string; maxTokens: number; temperature?: number },
  decision: ReturnType<typeof routeRequest>,
  classification: ReturnType<typeof classifyPrompt>,
  config: ThrottleConfig,
  requestId: string,
  clientFormat: 'anthropic' | 'openai',
  res: http.ServerResponse,
  logWriter: LogWriter,
  messages: Array<{ role: string; content: string }>,
): Promise<void> {
  const streamResult = await streamDispatch(proxyRequest, config);

  // Set SSE headers
  res.writeHead(200, {
    ...getThrottleHeadersObj(decision.model.id, classification.tier, classification.score, requestId),
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  const accumulator = { inputTokens: 0, outputTokens: 0 };
  const upstreamProvider = decision.model.provider;

  if (!streamResult.response.body) {
    res.end();
    return;
  }

  const reader = streamResult.response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let isFirstGoogleChunk = true;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Process complete SSE events from buffer
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? ''; // Keep incomplete last line in buffer

      let currentEvent = '';
      let currentData = '';

      for (const line of lines) {
        if (line.startsWith('event: ')) {
          currentEvent = line.slice(7).trim();
        } else if (line.startsWith('data: ')) {
          currentData = line.slice(6);
        } else if (line === '') {
          // Empty line = end of SSE event
          if (currentData) {
            processStreamChunk(
              upstreamProvider, clientFormat, currentEvent, currentData,
              requestId, decision.model.id, res, accumulator, isFirstGoogleChunk,
            );
            isFirstGoogleChunk = false;
          }
          currentEvent = '';
          currentData = '';
        }
      }
    }
  } catch (err) {
    log.error('Stream error', err);
  } finally {
    // Flush any remaining buffer
    if (buffer.trim()) {
      const remaining = buffer.trim();
      if (remaining.startsWith('data: ')) {
        processStreamChunk(
          upstreamProvider, clientFormat, '', remaining.slice(6),
          requestId, decision.model.id, res, accumulator, isFirstGoogleChunk,
        );
      }
    }

    res.end();

    // Write log entry after stream completes
    const latencyMs = Math.round(performance.now() - streamResult.startMs);
    const cost = estimateCost(decision.model, accumulator.inputTokens, accumulator.outputTokens);
    writeLogEntry(logWriter, requestId, classification, decision,
      accumulator.inputTokens, accumulator.outputTokens, cost, latencyMs, messages);
  }
}

function processStreamChunk(
  upstreamProvider: ApiProvider,
  clientFormat: 'anthropic' | 'openai',
  event: string,
  data: string,
  requestId: string,
  modelId: string,
  res: http.ServerResponse,
  accumulator: { inputTokens: number; outputTokens: number },
  isFirstGoogleChunk: boolean,
): void {
  // Always extract token counts regardless of format translation
  if (upstreamProvider === 'anthropic') {
    const tokens = extractAnthropicTokens(event, data);
    if (tokens.inputTokens !== undefined) accumulator.inputTokens = tokens.inputTokens;
    if (tokens.outputTokens !== undefined) accumulator.outputTokens = tokens.outputTokens;
  } else {
    const tokens = extractGoogleTokens(data);
    if (tokens.inputTokens !== undefined) accumulator.inputTokens = tokens.inputTokens;
    if (tokens.outputTokens !== undefined) accumulator.outputTokens = tokens.outputTokens;
  }

  // Format translation
  if (clientFormat === 'anthropic') {
    if (upstreamProvider === 'anthropic') {
      // Passthrough: rebuild the SSE event
      if (event) {
        res.write(`event: ${event}\ndata: ${data}\n\n`);
      } else {
        res.write(`data: ${data}\n\n`);
      }
    } else {
      // Google -> Anthropic format translation
      const translated = transformGoogleSseToAnthropic(data, requestId, isFirstGoogleChunk);
      if (translated) res.write(translated);
    }
  } else {
    // Client wants OpenAI format
    if (upstreamProvider === 'anthropic') {
      const translated = transformAnthropicSseToOpenAi(event, data, requestId, modelId);
      if (translated) res.write(translated);
    } else {
      const translated = transformGoogleSseToOpenAi(data, requestId, modelId);
      if (translated) res.write(translated);
    }
  }
}

// ─── Shared helpers ────────────────────────────────────────────────────

function classifyAndRoute(
  messages: Array<{ role: string; content: string }>,
  systemPrompt: string | undefined,
  forceModel: string | undefined,
  config: ThrottleConfig,
  registry: ModelRegistry,
  weights: DimensionWeights,
  logReader: LogReader,
) {
  const lastUserMsg = messages.filter(m => m.role === 'user').pop();
  if (!lastUserMsg) throw new Error('No user message found');

  const override = detectOverrides(messages, forceModel, undefined, logReader);
  const classification = classifyPrompt(lastUserMsg.content, {
    messageCount: messages.length,
    systemPrompt,
  }, weights, config.classifier.thresholds);

  const decision = routeRequest(classification, config.mode, override, registry);

  return { decision, classification };
}

function getForceModel(req: http.IncomingMessage): string | undefined {
  const header = req.headers['x-throttle-force-model'];
  const value = Array.isArray(header) ? header[0] : header;
  if (value === 'opus' || value === 'sonnet' || value === 'flash') {
    return value;
  }
  return undefined;
}

function setThrottleHeaders(
  res: http.ServerResponse,
  modelId: string,
  tier: string,
  score: number,
  requestId: string,
): void {
  // Headers will be set when writeHead is called (for streaming)
  // or set before sendJson (for non-streaming).
  // For non-streaming, set them directly.
  res.setHeader('X-Throttle-Model', modelId);
  res.setHeader('X-Throttle-Tier', tier);
  res.setHeader('X-Throttle-Score', score.toFixed(3));
  res.setHeader('X-Throttle-Request-Id', requestId);
}

function getThrottleHeadersObj(
  modelId: string,
  tier: string,
  score: number,
  requestId: string,
): Record<string, string> {
  return {
    'X-Throttle-Model': modelId,
    'X-Throttle-Tier': tier,
    'X-Throttle-Score': score.toFixed(3),
    'X-Throttle-Request-Id': requestId,
  };
}

function writeLogEntry(
  logWriter: LogWriter,
  requestId: string,
  classification: ReturnType<typeof classifyPrompt>,
  decision: ReturnType<typeof routeRequest>,
  inputTokens: number,
  outputTokens: number,
  cost: number,
  latencyMs: number,
  messages: Array<{ role: string; content: string }>,
): void {
  const lastUserMsg = messages.filter(m => m.role === 'user').pop();
  logWriter.append({
    requestId,
    timestamp: new Date().toISOString(),
    promptHash: hashPrompt(lastUserMsg?.content ?? ''),
    compositeScore: classification.score,
    tier: classification.tier,
    selectedModel: decision.model.id,
    provider: decision.model.provider,
    mode: decision.mode,
    override: decision.override,
    inputTokens,
    outputTokens,
    estimatedCostUsd: cost,
    latencyMs,
  });
}

export function sendJson(res: http.ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data, null, 2);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

export function sendError(res: http.ServerResponse, status: number, type: string, message: string): void {
  sendJson(res, status, { error: { type, message } });
}
