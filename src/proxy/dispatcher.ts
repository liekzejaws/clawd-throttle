import type { ProxyRequest, ProxyResponse, StreamingProxyResult } from './types.js';
import type { ThrottleConfig } from '../config/types.js';
import { callAnthropic } from './anthropic.js';
import { callGoogle } from './google.js';
import { callAnthropicStream } from './anthropic-stream.js';
import { callGoogleStream } from './google-stream.js';

export async function dispatch(
  request: ProxyRequest,
  config: ThrottleConfig,
): Promise<ProxyResponse> {
  switch (request.provider) {
    case 'anthropic':
      return callAnthropic(request, config);
    case 'google':
      return callGoogle(request, config);
    default:
      throw new Error(`Unknown provider: ${request.provider}`);
  }
}

export async function streamDispatch(
  request: ProxyRequest,
  config: ThrottleConfig,
): Promise<StreamingProxyResult> {
  switch (request.provider) {
    case 'anthropic':
      return callAnthropicStream(request, config);
    case 'google':
      return callGoogleStream(request, config);
    default:
      throw new Error(`Unknown provider: ${request.provider}`);
  }
}
