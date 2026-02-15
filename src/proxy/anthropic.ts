import type { ProxyRequest, ProxyResponse } from './types.js';
import { ProxyError } from './types.js';
import type { ThrottleConfig } from '../config/types.js';
import { performance } from 'node:perf_hooks';
import { buildAnthropicAuthHeaders } from './anthropic-auth.js';

export async function callAnthropic(
  request: ProxyRequest,
  config: ThrottleConfig,
  keyOverride?: string,
): Promise<ProxyResponse> {
  const url = `${config.anthropic.baseUrl}/v1/messages`;
  const startMs = performance.now();

  // When rawBody is available, passthrough the original request body (preserves tools,
  // tool_choice, thinking, metadata, tool_use/tool_result content blocks, etc.)
  // Only override model.
  let body: Record<string, unknown>;
  if (request.rawBody) {
    body = { ...request.rawBody, model: request.modelId };
    delete body.stream; // non-streaming path
  } else {
    body = {
      model: request.modelId,
      max_tokens: request.maxTokens,
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

  const data = await response.json() as {
    content: Array<{ type: string; text: string }>;
    usage: { input_tokens: number; output_tokens: number };
    stop_reason: string;
  };

  const latencyMs = performance.now() - startMs;

  const textContent = data.content
    .filter(c => c.type === 'text')
    .map(c => c.text)
    .join('');

  return {
    content: textContent,
    inputTokens: data.usage.input_tokens,
    outputTokens: data.usage.output_tokens,
    modelId: request.modelId,
    provider: 'anthropic',
    latencyMs: Math.round(latencyMs),
    finishReason: data.stop_reason,
  };
}
