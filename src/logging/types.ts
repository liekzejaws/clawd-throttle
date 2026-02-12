import type { ComplexityTier } from '../classifier/types.js';
import type { RoutingMode } from '../config/types.js';
import type { OverrideKind, ApiProvider } from '../router/types.js';

export interface RoutingLogEntry {
  requestId: string;
  timestamp: string;
  promptHash: string;
  compositeScore: number;
  confidence?: number;
  tier: ComplexityTier;
  selectedModel: string;
  provider: ApiProvider;
  mode: RoutingMode;
  override: OverrideKind;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  latencyMs: number;
  parentRequestId?: string;
  clientId?: string;        // From X-Client-ID header
  keyType?: string;         // 'setup-token' | 'enterprise' (Anthropic dual-key)
  failover?: boolean;       // true if primary key failed, fallback was used
}

export interface AggregateStats {
  totalRequests: number;
  totalCostUsd: number;
  costIfAlwaysPremium: number;
  baselineModel: string;
  estimatedSavingsUsd: number;
  savingsPercent: number;
  modelDistribution: Record<string, {
    count: number;
    costUsd: number;
    percentOfRequests: number;
  }>;
  tierDistribution: Record<ComplexityTier, number>;
  periodStart: string;
  periodEnd: string;
  avgLatencyMs: number;
}
