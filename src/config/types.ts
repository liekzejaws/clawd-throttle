export type RoutingMode = 'eco' | 'standard' | 'performance';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface ThrottleConfig {
  mode: RoutingMode;

  anthropic: {
    apiKey: string;
    baseUrl: string;
  };

  google: {
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

  http: {
    port: number;
    enabled: boolean;
  };
}
