export type RoutingMode = 'eco' | 'standard' | 'performance' | 'gigachad';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface ThrottleConfig {
  mode: RoutingMode;

  anthropic: {
    apiKey: string;
    setupToken: string;
    baseUrl: string;
    authType: 'api-key' | 'bearer' | 'auto';
    preferSetupToken: boolean;
  };

  google: {
    apiKey: string;
    baseUrl: string;
  };

  openai: {
    apiKey: string;
    baseUrl: string;
  };

  deepseek: {
    apiKey: string;
    baseUrl: string;
  };

  xai: {
    apiKey: string;
    baseUrl: string;
  };

  moonshot: {
    apiKey: string;
    baseUrl: string;
  };

  mistral: {
    apiKey: string;
    baseUrl: string;
  };

  ollama: {
    apiKey: string;
    baseUrl: string;
  };

  minimax: {
    apiKey: string;
    baseUrl: string;
  };

  logging: {
    level: LogLevel;
    logFilePath: string;
  };

  classifier: {
    weightsPath: string;
    thresholds: {
      simpleMax: number;
      complexMin: number;
    };
  };

  modelCatalogPath: string;
  routingTablePath: string;

  http: {
    port: number;
    enabled: boolean;
  };
}
