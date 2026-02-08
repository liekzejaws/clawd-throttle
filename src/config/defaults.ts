import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import type { ThrottleConfig } from './types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..', '..');

const configDir = process.env['CLAWD_THROTTLE_CONFIG_DIR']
  ?? path.join(os.homedir(), '.config', 'clawd-throttle');

export const defaults: ThrottleConfig = {
  mode: 'standard',
  anthropic: {
    apiKey: '',
    baseUrl: 'https://api.anthropic.com',
  },
  google: {
    apiKey: '',
    baseUrl: 'https://generativelanguage.googleapis.com',
  },
  logging: {
    level: 'info',
    logFilePath: path.join(configDir, 'routing.jsonl'),
  },
  classifier: {
    weightsPath: path.join(projectRoot, 'data', 'classifier-weights.json'),
    thresholds: {
      simpleMax: 0.30,
      complexMin: 0.65,
    },
  },
  modelCatalogPath: path.join(projectRoot, 'data', 'model-catalog.json'),
};

export { configDir };
