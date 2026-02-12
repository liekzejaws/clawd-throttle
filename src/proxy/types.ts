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
  keyType?: string;     // 'setup-token' | 'enterprise' (Anthropic only)
  failover?: boolean;   // true if primary key failed and fallback was used
}

export interface StreamingProxyResult {
  response: Response;
  modelId: string;
  provider: ApiProvider;
  startMs: number;
  keyType?: string;     // 'setup-token' | 'enterprise' (Anthropic only)
  failover?: boolean;   // true if primary key failed and fallback was used
}

export interface ProviderConfig {
  apiKey: string;
  baseUrl: string;
}

/**
 * Error thrown by proxy modules when an upstream API returns an error.
 * Carries the HTTP status code so callers can react (e.g., 429 rate limiting).
 */
export class ProxyError extends Error {
  readonly status: number;
  readonly provider: string;

  constructor(provider: string, status: number, body: string) {
    super(`${provider} API error (${status}): ${body}`);
    this.name = 'ProxyError';
    this.status = status;
    this.provider = provider;
  }
}
