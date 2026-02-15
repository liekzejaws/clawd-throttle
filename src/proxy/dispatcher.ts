import type { ProxyRequest, ProxyResponse, StreamingProxyResult } from './types.js';
import { ProxyError } from './types.js';
import type { ThrottleConfig } from '../config/types.js';
import type { ApiProvider } from '../router/types.js';
import { rateLimiter } from '../router/rate-limiter.js';
import { getAnthropicDualKey } from './anthropic-dual-key.js';
import { callAnthropic } from './anthropic.js';
import { callGoogle } from './google.js';
import { callAnthropicStream } from './anthropic-stream.js';
import { callGoogleStream } from './google-stream.js';
import { callOpenAiCompat } from './openai-compat.js';
import { callOpenAiCompatStream } from './openai-compat-stream.js';
import { callMinimax } from './minimax.js';
import { callMinimaxStream } from './minimax-stream.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('dispatcher');

function getProviderConfig(provider: ApiProvider, config: ThrottleConfig) {
  const section = config[provider] as { apiKey: string; baseUrl: string };
  return { apiKey: section.apiKey, baseUrl: section.baseUrl };
}

/**
 * Intercept ProxyError with status 429 and mark the model as rate-limited.
 * Re-throws the error so the caller still handles it.
 */
function handleRateLimit(err: unknown, modelId: string): never {
  if (err instanceof ProxyError && err.status === 429) {
    rateLimiter.markRateLimited(modelId);
  }
  throw err;
}

/**
 * Dispatch an Anthropic non-streaming request with transparent dual-key failover.
 * If the primary key returns 429 or 401 and a fallback key is available,
 * retries silently with the fallback. The caller never sees the primary failure.
 */
async function dispatchAnthropic(
  request: ProxyRequest,
  config: ThrottleConfig,
): Promise<ProxyResponse> {
  const dualKey = getAnthropicDualKey(config);
  const { primary, fallback } = dualKey.selectKeys();

  if (!primary) {
    throw new ProxyError('Anthropic', 401, 'No Anthropic API keys configured');
  }

  try {
    const result = await callAnthropic(request, config, primary.key);
    result.keyType = primary.type;
    result.failover = false;
    return result;
  } catch (err) {
    if (err instanceof ProxyError && (err.status === 429 || err.status === 401) && fallback) {
      log.info(`Anthropic ${primary.type} failed (${err.status}), switching to ${fallback.type}`);
      dualKey.markCooldown(primary.type);

      const result = await callAnthropic(request, config, fallback.key);
      result.keyType = fallback.type;
      result.failover = true;
      return result;
    }
    throw err;
  }
}

/**
 * Dispatch an Anthropic streaming request with transparent dual-key failover.
 */
async function dispatchAnthropicStream(
  request: ProxyRequest,
  config: ThrottleConfig,
): Promise<StreamingProxyResult> {
  const dualKey = getAnthropicDualKey(config);
  const { primary, fallback } = dualKey.selectKeys();

  if (!primary) {
    throw new ProxyError('Anthropic', 401, 'No Anthropic API keys configured');
  }

  try {
    const result = await callAnthropicStream(request, config, primary.key);
    result.keyType = primary.type;
    result.failover = false;
    return result;
  } catch (err) {
    if (err instanceof ProxyError && (err.status === 429 || err.status === 401) && fallback) {
      log.info(`Anthropic stream: ${primary.type} failed (${err.status}), switching to ${fallback.type}`);
      dualKey.markCooldown(primary.type);

      const result = await callAnthropicStream(request, config, fallback.key);
      result.keyType = fallback.type;
      result.failover = true;
      return result;
    }
    throw err;
  }
}

export async function dispatch(
  request: ProxyRequest,
  config: ThrottleConfig,
): Promise<ProxyResponse> {
  try {
    switch (request.provider) {
      case 'anthropic':
        return await dispatchAnthropic(request, config);
      case 'google':
        return await callGoogle(request, config);
      case 'minimax':
        return await callMinimax(request, config);
      default:
        // OpenAI, DeepSeek, xAI, Moonshot, Mistral, Ollama
        return await callOpenAiCompat(request, getProviderConfig(request.provider, config));
    }
  } catch (err) {
    handleRateLimit(err, request.modelId);
  }
}

export async function streamDispatch(
  request: ProxyRequest,
  config: ThrottleConfig,
): Promise<StreamingProxyResult> {
  try {
    switch (request.provider) {
      case 'anthropic':
        return await dispatchAnthropicStream(request, config);
      case 'google':
        return await callGoogleStream(request, config);
      case 'minimax':
        return await callMinimaxStream(request, config);
      default:
        // OpenAI, DeepSeek, xAI, Moonshot, Mistral, Ollama
        return await callOpenAiCompatStream(request, getProviderConfig(request.provider, config));
    }
  } catch (err) {
    handleRateLimit(err, request.modelId);
  }
}
