import type { ProxyRequest, ProxyResponse } from './types.js';
import type { ThrottleConfig } from '../config/types.js';
import { callAnthropic } from './anthropic.js';
import { callGoogle } from './google.js';

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
