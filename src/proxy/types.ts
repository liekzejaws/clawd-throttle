import type { ApiProvider } from '../router/types.js';

export interface ProxyMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ProxyRequest {
  provider: ApiProvider;
  modelId: string;
  messages: ProxyMessage[];
  systemPrompt?: string;
  maxTokens: number;
  temperature?: number;
}

export interface ProxyResponse {
  content: string;
  inputTokens: number;
  outputTokens: number;
  modelId: string;
  provider: ApiProvider;
  latencyMs: number;
  finishReason: string;
}
