import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig } from './config/index.js';
import { setLogLevel, createLogger } from './utils/logger.js';
import { ModelRegistry } from './router/model-registry.js';
import { LogWriter } from './logging/writer.js';
import { LogReader } from './logging/reader.js';
import { loadWeights } from './classifier/engine.js';
import { registerTools } from './server/tools.js';
import { registerResources } from './server/resources.js';
import { registerPrompts } from './server/prompts.js';

const log = createLogger('main');

async function main(): Promise<void> {
  log.info('Clawd Throttle starting...');

  // 1. Load configuration
  const config = loadConfig();
  setLogLevel(config.logging.level);
  log.info(`Configuration loaded. Mode: ${config.mode}`);

  // 2. Initialize model registry
  const registry = new ModelRegistry(config.modelCatalogPath);

  // 3. Initialize classifier weights
  const weights = loadWeights(config.classifier.weightsPath);

  // 4. Initialize logging
  const logWriter = new LogWriter(config.logging.logFilePath);
  const logReader = new LogReader(config.logging.logFilePath);
  log.info(`Routing log: ${config.logging.logFilePath}`);

  // 5. Create MCP server
  const server = new McpServer({
    name: 'clawd-throttle',
    version: '1.0.0',
  });

  // 6. Register tools, resources, and prompts
  registerTools(server, config, registry, weights, logWriter, logReader);
  registerResources(server, config, logReader);
  registerPrompts(server);
  log.info('MCP tools, resources, and prompts registered');

  // 7. Connect via stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log.info('Clawd Throttle is running on stdio transport');
}

main().catch((err) => {
  const log = createLogger('main');
  log.error('Fatal error during startup', err);
  process.exit(1);
});
