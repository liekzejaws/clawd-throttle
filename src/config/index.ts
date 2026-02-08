import fs from 'node:fs';
import path from 'node:path';
import type { ThrottleConfig } from './types.js';
import { defaults, configDir } from './defaults.js';

const configFilePath = path.join(configDir, 'config.json');

function deepMerge<T extends Record<string, unknown>>(base: T, override: Partial<T>): T {
  const result = { ...base };
  for (const key of Object.keys(override) as (keyof T)[]) {
    const val = override[key];
    if (val !== undefined && val !== null && typeof val === 'object' && !Array.isArray(val)) {
      result[key] = deepMerge(
        result[key] as Record<string, unknown>,
        val as Record<string, unknown>,
      ) as T[keyof T];
    } else if (val !== undefined) {
      result[key] = val as T[keyof T];
    }
  }
  return result;
}

export function loadConfig(): ThrottleConfig {
  let fileConfig: Partial<ThrottleConfig> = {};

  if (fs.existsSync(configFilePath)) {
    const raw = fs.readFileSync(configFilePath, 'utf-8');
    fileConfig = JSON.parse(raw) as Partial<ThrottleConfig>;
  }

  const config = deepMerge(defaults as unknown as Record<string, unknown>, fileConfig as Record<string, unknown>) as unknown as ThrottleConfig;

  if (process.env['ANTHROPIC_API_KEY']) {
    config.anthropic.apiKey = process.env['ANTHROPIC_API_KEY'];
  }
  if (process.env['GOOGLE_AI_API_KEY']) {
    config.google.apiKey = process.env['GOOGLE_AI_API_KEY'];
  }
  if (process.env['CLAWD_THROTTLE_MODE']) {
    const envMode = process.env['CLAWD_THROTTLE_MODE'];
    if (envMode === 'eco' || envMode === 'standard' || envMode === 'performance') {
      config.mode = envMode;
    }
  }
  if (process.env['CLAWD_THROTTLE_LOG_LEVEL']) {
    config.logging.level = process.env['CLAWD_THROTTLE_LOG_LEVEL'] as ThrottleConfig['logging']['level'];
  }

  return config;
}

export function saveConfig(partial: Partial<ThrottleConfig>): void {
  fs.mkdirSync(configDir, { recursive: true });
  const existing = fs.existsSync(configFilePath)
    ? JSON.parse(fs.readFileSync(configFilePath, 'utf-8')) as Partial<ThrottleConfig>
    : {};
  const merged = deepMerge(existing as Record<string, unknown>, partial as Record<string, unknown>);
  fs.writeFileSync(configFilePath, JSON.stringify(merged, null, 2), 'utf-8');
}

export { configDir };
export type { ThrottleConfig } from './types.js';
export type { RoutingMode, LogLevel } from './types.js';
