import type { ProxyRequest, ProxyResponse, StreamingProxyResult, ProviderConfig } from './types.js';
import { ProxyError } from './types.js';
import type { ThrottleConfig } from '../config/types.js';
import type { ApiProvider } from '../router/types.js';
import { rateLimiter } from '../router/rate-limiter.js';
import { callAnthropic } from './anthropic.js';
import { callGoogle } from './google.js';
import { callAnthropicStream } from './anthropic-stream.js';
import { callGoogleStream } from './google-stream.js';
import { callOpenAiCompat } from './openai-compat.js';
import { callOpenAiCompatStream } from './openai-compat-stream.js';

/**
 * Extract { apiKey, baseUrl } for any provider from the config.
 */
export function getProviderConfig(provider: ApiProvider, config: ThrottleConfig): ProviderConfig {
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

export async function dispatch(
  request: ProxyRequest,
  config: ThrottleConfig,
): Promise<ProxyResponse> {
  try {
    switch (request.provider) {
      case 'anthropic':
        return await callAnthropic(request, config);
      case 'google':
        return await callGoogle(request, config);
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
        return await callAnthropicStream(request, config);
      case 'google':
        return await callGoogleStream(request, config);
      default:
        // OpenAI, DeepSeek, xAI, Moonshot, Mistral, Ollama
        return await callOpenAiCompatStream(request, getProviderConfig(request.provider, config));
    }
  } catch (err) {
    handleRateLimit(err, request.modelId);
  }
}
