import type { ProxyRequest, StreamingProxyResult } from './types.js';
import { ProxyError } from './types.js';
import type { ThrottleConfig } from '../config/types.js';
import { performance } from 'node:perf_hooks';

export async function callMinimaxStream(
  request: ProxyRequest,
  config: ThrottleConfig,
): Promise<StreamingProxyResult> {
  const url = `${config.minimax.baseUrl}/v1/messages`;
  const startMs = performance.now();

  const body: Record<string, unknown> = {
    model: request.modelId,
    max_tokens: request.maxTokens,
    messages: request.messages.map(m => ({
      role: m.role,
      content: m.content,
    })),
    stream: true,
  };

  if (request.systemPrompt) {
    body.system = request.systemPrompt;
  }
  if (request.temperature !== undefined) {
    body.temperature = request.temperature;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.minimax.apiKey}`,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new ProxyError('MiniMax', response.status, errorText);
  }

  if (!response.body) {
    throw new ProxyError('MiniMax', 500, 'No response body');
  }

  return {
    response,
    startMs,
    modelId: request.modelId,
    provider: 'minimax',
  };
}
