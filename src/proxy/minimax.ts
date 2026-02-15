import type { ProxyRequest, ProxyResponse } from './types.js';
import { ProxyError } from './types.js';
import type { ThrottleConfig } from '../config/types.js';
import { performance } from 'node:perf_hooks';

export async function callMinimax(
  request: ProxyRequest,
  config: ThrottleConfig,
): Promise<ProxyResponse> {
  const url = `${config.minimax.baseUrl}/v1/messages`;
  const startMs = performance.now();

  const body: Record<string, unknown> = {
    model: request.modelId,
    max_tokens: request.maxTokens,
    messages: request.messages.map(m => ({
      role: m.role,
      content: m.content,
    })),
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

  const data = await response.json() as {
    content: Array<{ type: string; text?: string; thinking?: string }>;
    usage: { input_tokens: number; output_tokens: number };
    stop_reason: string;
  };

  const latencyMs = performance.now() - startMs;

  // Filter out 'thinking' blocks and extract only 'text' content
  // This gives cleaner output for Clawd Colony clients
  const textContent = data.content
    .filter(c => c.type === 'text' && c.text)
    .map(c => c.text!)
    .join('');

  return {
    content: textContent,
    inputTokens: data.usage.input_tokens,
    outputTokens: data.usage.output_tokens,
    modelId: request.modelId,
    provider: 'minimax',
    latencyMs: Math.round(latencyMs),
    finishReason: data.stop_reason,
  };
}
