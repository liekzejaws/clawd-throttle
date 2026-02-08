import fs from 'node:fs';
import type { ModelSpec } from './types.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('model-registry');

interface ModelCatalogFile {
  models: ModelSpec[];
}

export class ModelRegistry {
  private models: Map<string, ModelSpec>;

  constructor(catalogPath: string) {
    this.models = new Map();
    const raw = fs.readFileSync(catalogPath, 'utf-8');
    const catalog = JSON.parse(raw) as ModelCatalogFile;
    for (const model of catalog.models) {
      this.models.set(model.id, model);
    }
    log.info(`Loaded ${this.models.size} models from catalog`);
  }

  getById(id: string): ModelSpec {
    const model = this.models.get(id);
    if (!model) {
      throw new Error(`Unknown model ID: ${id}`);
    }
    return model;
  }

  getAll(): ModelSpec[] {
    return Array.from(this.models.values());
  }

  getCheapest(): ModelSpec {
    return this.getAll().sort(
      (a, b) => a.inputCostPerMTok - b.inputCostPerMTok
    )[0]!;
  }
}
