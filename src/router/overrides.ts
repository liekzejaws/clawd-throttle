import type { OverrideResult } from './types.js';
import type { LogReader } from '../logging/reader.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('overrides');

const MODEL_HIERARCHY: string[] = [
  'gemini-2.5-flash',
  'claude-sonnet-4-5-20250514',
  'claude-opus-4-5-20250514',
];

const FORCE_MODEL_MAP: Record<string, string> = {
  opus: 'claude-opus-4-5-20250514',
  sonnet: 'claude-sonnet-4-5-20250514',
  flash: 'gemini-2.5-flash',
};

export function detectOverrides(
  messages: Array<{ role: string; content: string }>,
  forceModel: string | undefined,
  parentRequestId: string | undefined,
  logReader: LogReader,
): OverrideResult {
  const lastUserContent = messages
    .filter(m => m.role === 'user')
    .pop()?.content ?? '';

  // 1. Heartbeat / summary detection
  if (isHeartbeatOrSummary(lastUserContent)) {
    log.debug('Override: heartbeat/summary detected');
    return {
      kind: 'heartbeat',
      forcedModelId: MODEL_HIERARCHY[0],
    };
  }

  // 2. Explicit force commands
  if (forceModel && FORCE_MODEL_MAP[forceModel]) {
    const kind = `force_${forceModel}` as OverrideResult['kind'];
    return { kind, forcedModelId: FORCE_MODEL_MAP[forceModel] };
  }

  const trimmed = lastUserContent.trim().toLowerCase();
  if (trimmed.startsWith('/opus')) return { kind: 'force_opus', forcedModelId: FORCE_MODEL_MAP['opus'] };
  if (trimmed.startsWith('/sonnet')) return { kind: 'force_sonnet', forcedModelId: FORCE_MODEL_MAP['sonnet'] };
  if (trimmed.startsWith('/flash')) return { kind: 'force_flash', forcedModelId: FORCE_MODEL_MAP['flash'] };

  // 3. Sub-agent tier inheritance
  if (parentRequestId) {
    const parentEntry = logReader.getEntryById(parentRequestId);
    if (parentEntry) {
      const steppedDown = stepDownModel(parentEntry.selectedModel);
      const inherited = steppedDown === parentEntry.selectedModel;
      log.debug(
        `Sub-agent: parent=${parentEntry.selectedModel}, child=${steppedDown}, ` +
        `action=${inherited ? 'inherit' : 'stepdown'}`
      );
      return {
        kind: inherited ? 'sub_agent_inherit' : 'sub_agent_stepdown',
        forcedModelId: steppedDown,
      };
    } else {
      log.warn(`Sub-agent parentRequestId=${parentRequestId} not found in log`);
    }
  }

  // 4. No override
  return { kind: 'none' };
}

function isHeartbeatOrSummary(text: string): boolean {
  const normalized = text.trim().toLowerCase();

  const patterns: RegExp[] = [
    /^(ping|pong|heartbeat|health[- ]?check|status[- ]?check|alive\??|are you there\??)$/,
    /^(summarize|summary|tldr|tl;dr|recap|brief overview)$/,
    /^(summarize|summary|tldr|tl;dr|recap|brief overview)\s+(this|the|our|above|conversation|chat|thread|discussion|everything)$/,
    /^give\s+me\s+a\s+(brief\s+)?(summary|recap|overview)$/,
    /^can\s+you\s+(summarize|recap)\s+(this|the|our|everything)(\??)$/,
  ];

  return patterns.some(p => p.test(normalized));
}

function stepDownModel(parentModelId: string): string {
  const parentIndex = MODEL_HIERARCHY.indexOf(parentModelId);

  if (parentIndex === -1) {
    log.warn(`Unknown model in hierarchy: ${parentModelId}`);
    return parentModelId;
  }

  if (parentIndex === 0) {
    return parentModelId;
  }

  return MODEL_HIERARCHY[parentIndex - 1]!;
}
