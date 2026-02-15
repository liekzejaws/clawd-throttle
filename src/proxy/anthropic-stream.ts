import type { ProxyRequest, StreamingProxyResult } from './types.js';
import { ProxyError } from './types.js';
import type { ThrottleConfig } from '../config/types.js';
import { performance } from 'node:perf_hooks';
import { buildAnthropicAuthHeaders } from './anthropic-auth.js';

/**
 * Streaming variant of callAnthropic. Returns the raw Response
 * with an SSE body stream instead of parsing it.
 */
export async function callAnthropicStream(
  request: ProxyRequest,
  config: ThrottleConfig,
  keyOverride?: string,
): Promise<StreamingProxyResult> {
  const url = `${config.anthropic.baseUrl}/v1/messages`;
  const startMs = performance.now();

  // When rawBody is available, passthrough the original request body (preserves tools,
  // tool_choice, thinking, metadata, tool_use/tool_result content blocks, etc.)
  // Only override model and ensure stream=true.
  let body: Record<string, unknown>;
  if (request.rawBody) {
    body = { ...request.rawBody, model: request.modelId, stream: true };
  } else {
    body = {
      model: request.modelId,
      max_tokens: request.maxTokens,
      stream: true,
      messages: request.messages.map(m => ({ role: m.role, content: m.content })),
    };
    if (request.systemPrompt) {
      body.system = request.systemPrompt;
    }
    if (request.temperature !== undefined) {
      body.temperature = request.temperature;
    }
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...buildAnthropicAuthHeaders(config, keyOverride),
    'anthropic-version': request.anthropicVersion || '2023-06-01',
  };
  if (request.anthropicBeta) {
    headers['anthropic-beta'] = request.anthropicBeta;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new ProxyError('Anthropic', response.status, errorText);
  }

  return {
    response,
    modelId: request.modelId,
    provider: 'anthropic',
    startMs,
  };
}
