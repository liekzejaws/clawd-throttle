import http from 'node:http';
import crypto from 'node:crypto';
import { performance } from 'node:perf_hooks';
import type { ThrottleConfig } from '../config/types.js';
import type { DimensionWeights, ComplexityTier } from '../classifier/types.js';
import type { ModelRegistry, RoutingTable } from '../router/model-registry.js';
import type { LogWriter } from '../logging/writer.js';
import type { LogReader } from '../logging/reader.js';
import type { ApiProvider } from '../router/types.js';
import type { ProxyResponse } from '../proxy/types.js';
import type { ParsedRequest } from './parsed-request.js';
import { classifyPrompt } from '../classifier/engine.js';
import { routeRequest } from '../router/engine.js';
import { detectOverrides, FORCE_MODEL_MAP } from '../router/overrides.js';
import { dispatch, streamDispatch } from '../proxy/dispatcher.js';
import { estimateCost } from '../logging/writer.js';
import { computeStats } from '../logging/stats.js';
import { hashPrompt } from '../utils/hash.js';
import { createLogger } from '../utils/logger.js';
import { DedupCache } from '../proxy/dedup-cache.js';
import { SessionStore } from '../router/session-store.js';
import { parseAnthropicRequest, formatAnthropicResponse, transformGoogleSseToAnthropic, transformOpenAiSseToAnthropic } from './format-anthropic.js';
import { parseOpenAiRequest, formatOpenAiResponse, transformAnthropicSseToOpenAi, transformGoogleSseToOpenAi, extractAnthropicTokens, extractGoogleTokens, extractOpenAiCompatTokens } from './format-openai.js';

const log = createLogger('http');

export interface HandlerDeps {
  config: ThrottleConfig;
  registry: ModelRegistry;
  weights: DimensionWeights;
  logWriter: LogWriter;
  logReader: LogReader;
  routingTable: RoutingTable;
  dedupCache: DedupCache;
  sessionStore: SessionStore;
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
  deps: HandlerDeps,
): void {
  const url = new URL(req.url ?? '/', `http://localhost`);
  const days = parseInt(url.searchParams.get('days') ?? '30', 10) || 30;

  const since = new Date();
  since.setDate(since.getDate() - days);
  const entries = deps.logReader.readSince(since.toISOString());

  const baseline = deps.registry.getMostExpensive();
  const stats = computeStats(entries, baseline);

  sendJson(res, 200, stats);
}

// ─── POST /v1/messages (Anthropic format) ──────────────────────────────

export async function handleMessages(
  body: Record<string, unknown>,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  deps: HandlerDeps,
): Promise<void> {
  const anthropicVersion = getHeader(req, 'anthropic-version');
  const anthropicBeta = getHeader(req, 'anthropic-beta');

  return handleApiRequest(body, req, res, deps, {
    parse: parseAnthropicRequest,
    formatResponse: formatAnthropicResponse,
    clientFormat: 'anthropic',
    buildProxyExtras: (decision) => decision.model.provider === 'anthropic' ? {
      rawBody: body,
      anthropicVersion,
      anthropicBeta,
    } : {},
  });
}

// ─── POST /v1/chat/completions (OpenAI format) ─────────────────────────

export async function handleChatCompletions(
  body: Record<string, unknown>,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  deps: HandlerDeps,
): Promise<void> {
  return handleApiRequest(body, req, res, deps, {
    parse: parseOpenAiRequest,
    formatResponse: formatOpenAiResponse,
    clientFormat: 'openai',
    buildProxyExtras: () => ({}),
  });
}

// ─── Unified API request handler ───────────────────────────────────────

interface ApiRequestOptions {
  parse: (body: Record<string, unknown>) => ParsedRequest;
  formatResponse: (response: ProxyResponse, requestId: string) => Record<string, unknown>;
  clientFormat: 'anthropic' | 'openai';
  buildProxyExtras: (decision: ReturnType<typeof routeRequest>) => Record<string, unknown>;
}

async function handleApiRequest(
  body: Record<string, unknown>,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  deps: HandlerDeps,
  opts: ApiRequestOptions,
): Promise<void> {
  const { config, registry, weights, logWriter, logReader, routingTable, dedupCache, sessionStore } = deps;

  const parsed = opts.parse(body);
  const forceModel = getForceModel(req);
  const requestId = crypto.randomUUID();
  const hasTools = Array.isArray(body.tools) && body.tools.length > 0;
  const sessionId = getSessionId(req);
  const clientId = getClientId(req);

  // Non-streaming: dedup check + dispatch + cache
  if (!parsed.stream) {
    const dedupKey = dedupCache.computeKey(parsed.messages, parsed.systemPrompt);

    const cached = dedupCache.getCompleted(dedupKey);
    if (cached) {
      log.info(`Dedup hit for request ${requestId}, returning cached response`);
      res.writeHead(cached.status, JSON.parse(cached.headers['_raw'] ?? '{}'));
      res.end(cached.body);
      return;
    }

    const inflight = dedupCache.markInflight(dedupKey);
    if (inflight.isWaiting) {
      log.info(`Dedup waiting for in-flight request ${requestId}`);
      try {
        const result = await inflight.promise;
        res.writeHead(result.status, JSON.parse(result.headers['_raw'] ?? '{}'));
        res.end(result.body);
        return;
      } catch {
        log.warn(`Dedup in-flight request failed, proceeding normally for ${requestId}`);
      }
    }

    try {
      const { decision, classification } = classifyAndRouteWithSession(
        parsed.messages, parsed.systemPrompt, forceModel, config, registry, weights,
        logReader, routingTable, hasTools, sessionId, sessionStore,
      );

      setThrottleHeaders(res, decision.model.id, classification.tier, classification.score, classification.confidence, requestId);

      const proxyRequest = {
        provider: decision.model.provider,
        modelId: decision.model.id,
        messages: parsed.messages,
        systemPrompt: parsed.systemPrompt,
        maxTokens: parsed.maxTokens,
        temperature: parsed.temperature,
        ...opts.buildProxyExtras(decision),
      };

      const proxyResponse = await dispatch(proxyRequest, config);
      const cost = estimateCost(decision.model, proxyResponse.inputTokens, proxyResponse.outputTokens);

      writeLogEntry(logWriter, requestId, classification, decision, proxyResponse.inputTokens,
        proxyResponse.outputTokens, cost, proxyResponse.latencyMs, parsed.messages,
        { clientId, keyType: proxyResponse.keyType, failover: proxyResponse.failover });

      const responseBody = JSON.stringify(opts.formatResponse(proxyResponse, requestId), null, 2);

      dedupCache.complete(dedupKey, {
        status: 200,
        headers: { '_raw': JSON.stringify({ 'Content-Type': 'application/json' }) },
        body: responseBody,
        completedAt: Date.now(),
      });

      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(responseBody),
      });
      res.end(responseBody);
    } catch (err) {
      dedupCache.removeInflight(dedupKey, err instanceof Error ? err : new Error(String(err)));
      if (sessionId) sessionStore.markFailed(sessionId);
      throw err;
    }
    return;
  }

  // Streaming path (no dedup)
  const { decision, classification } = classifyAndRouteWithSession(
    parsed.messages, parsed.systemPrompt, forceModel, config, registry, weights,
    logReader, routingTable, hasTools, sessionId, sessionStore,
  );

  setThrottleHeaders(res, decision.model.id, classification.tier, classification.score, classification.confidence, requestId);

  const proxyRequest = {
    provider: decision.model.provider,
    modelId: decision.model.id,
    messages: parsed.messages,
    systemPrompt: parsed.systemPrompt,
    maxTokens: parsed.maxTokens,
    temperature: parsed.temperature,
    ...opts.buildProxyExtras(decision),
  };

  try {
    await handleStreamingResponse(
      proxyRequest, decision, classification, config, requestId,
      opts.clientFormat, res, logWriter, parsed.messages, clientId,
    );
  } catch (err) {
    if (sessionId) sessionStore.markFailed(sessionId);
    throw err;
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
  clientId?: string,
): Promise<void> {
  const streamResult = await streamDispatch(proxyRequest, config);

  if (!streamResult?.response?.body) {
    sendError(res, 502, 'upstream_error',
      `Upstream returned no response body for ${proxyRequest.provider}/${proxyRequest.modelId}`);
    return;
  }

  res.writeHead(200, {
    ...getThrottleHeadersObj(decision.model.id, classification.tier, classification.score, classification.confidence, requestId),
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  const accumulator = { inputTokens: 0, outputTokens: 0 };
  const upstreamProvider = decision.model.provider;

  const reader = streamResult.response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let isFirstNonAnthropicChunk = true;

  // SSE parser state — persists across chunk boundaries
  let currentEvent = '';
  let currentData = '';

  // SSE heartbeat: prevents client/proxy timeouts for slow models (DeepSeek-R, o3)
  const heartbeatInterval = setInterval(() => {
    if (!res.writableEnded) {
      res.write(': heartbeat\n\n');
    }
  }, 2000);
  let heartbeatCleared = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      if (!heartbeatCleared) {
        clearInterval(heartbeatInterval);
        heartbeatCleared = true;
      }

      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (line.startsWith('event: ')) {
          currentEvent = line.slice(7).trim();
        } else if (line.startsWith('data: ')) {
          currentData = line.slice(6);
        } else if (line === '') {
          if (currentData) {
            processStreamChunk(
              upstreamProvider, clientFormat, currentEvent, currentData,
              requestId, decision.model.id, res, accumulator, isFirstNonAnthropicChunk,
            );
            isFirstNonAnthropicChunk = false;
          }
          currentEvent = '';
          currentData = '';
        }
      }
    }
  } catch (err) {
    log.error('Stream error', err);
  } finally {
    if (!heartbeatCleared) {
      clearInterval(heartbeatInterval);
    }

    if (buffer.trim()) {
      const remaining = buffer.trim();
      if (remaining.startsWith('data: ')) {
        processStreamChunk(
          upstreamProvider, clientFormat, '', remaining.slice(6),
          requestId, decision.model.id, res, accumulator, isFirstNonAnthropicChunk,
        );
      }
    }

    res.end();

    const latencyMs = Math.round(performance.now() - streamResult.startMs);
    const cost = estimateCost(decision.model, accumulator.inputTokens, accumulator.outputTokens);
    writeLogEntry(logWriter, requestId, classification, decision,
      accumulator.inputTokens, accumulator.outputTokens, cost, latencyMs, messages,
      { clientId, keyType: streamResult.keyType, failover: streamResult.failover });
  }
}

function getUpstreamFamily(provider: ApiProvider): 'anthropic' | 'google' | 'openai-compat' {
  if (provider === 'anthropic') return 'anthropic';
  if (provider === 'google') return 'google';
  return 'openai-compat';
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
  isFirstNonAnthropicChunk: boolean,
): void {
  const family = getUpstreamFamily(upstreamProvider);

  // Extract token counts
  const extractors = {
    anthropic: () => extractAnthropicTokens(event, data),
    google: () => extractGoogleTokens(data),
    'openai-compat': () => extractOpenAiCompatTokens(data),
  };
  const tokens = extractors[family]();
  if (tokens.inputTokens !== undefined) accumulator.inputTokens = tokens.inputTokens;
  if (tokens.outputTokens !== undefined) accumulator.outputTokens = tokens.outputTokens;

  // Format translation
  if (clientFormat === 'anthropic') {
    if (family === 'anthropic') {
      res.write(event ? `event: ${event}\ndata: ${data}\n\n` : `data: ${data}\n\n`);
    } else if (family === 'google') {
      const translated = transformGoogleSseToAnthropic(data, requestId, isFirstNonAnthropicChunk);
      if (translated) res.write(translated);
    } else {
      const translated = transformOpenAiSseToAnthropic(data, requestId, isFirstNonAnthropicChunk);
      if (translated) res.write(translated);
    }
  } else {
    if (family === 'anthropic') {
      const translated = transformAnthropicSseToOpenAi(event, data, requestId, modelId);
      if (translated) res.write(translated);
    } else if (family === 'google') {
      const translated = transformGoogleSseToOpenAi(data, requestId, modelId);
      if (translated) res.write(translated);
    } else {
      res.write(data === '[DONE]' ? 'data: [DONE]\n\n' : `data: ${data}\n\n`);
    }
  }
}

// ─── Shared helpers ────────────────────────────────────────────────────

function classifyAndRouteWithSession(
  messages: Array<{ role: string; content: string }>,
  systemPrompt: string | undefined,
  forceModel: string | undefined,
  config: ThrottleConfig,
  registry: ModelRegistry,
  weights: DimensionWeights,
  logReader: LogReader,
  routingTable: RoutingTable,
  hasTools: boolean,
  sessionId: string | undefined,
  sessionStore: SessionStore,
) {
  const lastUserMsg = messages.filter(m => m.role === 'user').pop();
  if (!lastUserMsg) throw new Error('No user message found');

  const override = detectOverrides(messages, forceModel, undefined, logReader, hasTools);
  let classification = classifyPrompt(lastUserMsg.content, {
    messageCount: messages.length,
    systemPrompt,
  }, weights, config.classifier.thresholds);

  let decision = routeRequest(classification, config.mode, override, registry, config, routingTable);

  // Apply session pinning if session ID is present
  if (sessionId) {
    if (sessionStore.hasRecentFailure(sessionId)) {
      const tierOrder: ComplexityTier[] = ['simple', 'standard', 'complex'];
      const currentIdx = tierOrder.indexOf(classification.tier);
      if (currentIdx < tierOrder.length - 1) {
        const escalatedTier = tierOrder[currentIdx + 1]!;
        log.info(`Session ${sessionId}: failure-escalating ${classification.tier} → ${escalatedTier}`);
        classification = { ...classification, tier: escalatedTier };
        const escalatedOverride = detectOverrides(messages, forceModel, undefined, logReader, hasTools);
        const escalatedDecision = routeRequest(classification, config.mode, escalatedOverride, registry, config, routingTable);
        decision = { ...escalatedDecision, reasoning: `${escalatedDecision.reasoning} [failure-escalated]` };
      }
    }

    const pinResult = sessionStore.set(sessionId, decision.model.id, classification.tier);

    if (pinResult.modelId !== decision.model.id) {
      const pinnedModel = registry.getById(pinResult.modelId);
      if (pinnedModel) {
        log.info(`Session ${sessionId}: using pinned model ${pinnedModel.id} instead of ${decision.model.id}`);
        return {
          decision: {
            ...decision,
            model: pinnedModel,
            reasoning: `${decision.reasoning} [session-pinned from ${decision.model.id}]`,
          },
          classification,
        };
      }
      log.warn(`Session ${sessionId}: pinned model ${pinResult.modelId} not found in registry, using ${decision.model.id}`);
    }
  }

  return { decision, classification };
}

function getHeader(req: http.IncomingMessage, name: string): string | undefined {
  const header = req.headers[name];
  return (Array.isArray(header) ? header[0] : header) || undefined;
}

function getForceModel(req: http.IncomingMessage): string | undefined {
  const value = getHeader(req, 'x-throttle-force-model');
  return value && FORCE_MODEL_MAP[value] ? value : undefined;
}

function getSessionId(req: http.IncomingMessage): string | undefined {
  return getHeader(req, 'x-session-id')?.trim() || undefined;
}

function getClientId(req: http.IncomingMessage): string | undefined {
  return getHeader(req, 'x-client-id')?.trim() || undefined;
}

function setThrottleHeaders(
  res: http.ServerResponse,
  modelId: string,
  tier: string,
  score: number,
  confidence: number,
  requestId: string,
): void {
  res.setHeader('X-Throttle-Model', modelId);
  res.setHeader('X-Throttle-Tier', tier);
  res.setHeader('X-Throttle-Score', score.toFixed(3));
  res.setHeader('X-Throttle-Confidence', confidence.toFixed(3));
  res.setHeader('X-Throttle-Request-Id', requestId);
}

function getThrottleHeadersObj(
  modelId: string,
  tier: string,
  score: number,
  confidence: number,
  requestId: string,
): Record<string, string> {
  return {
    'X-Throttle-Model': modelId,
    'X-Throttle-Tier': tier,
    'X-Throttle-Score': score.toFixed(3),
    'X-Throttle-Confidence': confidence.toFixed(3),
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
  extras?: { clientId?: string; keyType?: string; failover?: boolean },
): void {
  const lastUserMsg = messages.filter(m => m.role === 'user').pop();
  logWriter.append({
    requestId,
    timestamp: new Date().toISOString(),
    promptHash: hashPrompt(lastUserMsg?.content ?? ''),
    compositeScore: classification.score,
    confidence: classification.confidence,
    tier: classification.tier,
    selectedModel: decision.model.id,
    provider: decision.model.provider,
    mode: decision.mode,
    override: decision.override,
    inputTokens,
    outputTokens,
    estimatedCostUsd: cost,
    latencyMs,
    ...(extras?.clientId ? { clientId: extras.clientId } : {}),
    ...(extras?.keyType ? { keyType: extras.keyType } : {}),
    ...(extras?.failover !== undefined ? { failover: extras.failover } : {}),
  });
}

export function sendJson(res: http.ServerResponse, status: number, data: unknown): void {
  if (res.headersSent) {
    res.end();
    return;
  }
  const body = JSON.stringify(data, null, 2);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

export function sendError(res: http.ServerResponse, status: number, type: string, message: string): void {
  if (res.headersSent) {
    res.end();
    return;
  }
  sendJson(res, status, { error: { type, message } });
}
