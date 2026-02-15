import type { ProxyMessage } from '../proxy/types.js';

export interface ParsedRequest {
  messages: ProxyMessage[];
  systemPrompt: string | undefined;
  maxTokens: number;
  temperature: number | undefined;
  stream: boolean;
}
