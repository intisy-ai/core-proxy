export type HandlerCtx = {
  configDir: string;
  log: (m: string) => void;
  model: string;
};

export type ProxyHandler = {
  handle: (request: Request, ctx: HandlerCtx) => Promise<Response>;
};

export type HandlerResolver = (providerName: string) => Promise<ProxyHandler | null>;

export type Assignment = {
  provider: string;
  model: string;
  name?: string;
  derived?: boolean;
};

export type Chain = Assignment[];

export type ModelMap = { [tier: string]: Chain } & { default: Chain };

export type CatalogEntry = {
  provider: string;
  model: string;
  name?: string;
  score?: number;
  limit?: { context?: number; output?: number };
};

export type RateLimitInfo = {
  resetMs: number;
  upstream: Response | null;
};

export type RoutingProfile = {
  configFile: string;
  /**
   * Loader-facing config field name for the routing-enable toggle (read by the
   * loader's route-mode.ts / tui-extension.ts, not by this engine). Intentionally
   * NOT consumed by core-proxy's model-map engine — do not wire it into
   * readModelMap, which reads the separate `modelMap` field instead.
   */
  routingKey: string;
  tierSourceProvider: string;
  tierOrder: string[];
  tierFallback: string[];
  tierRegex: RegExp;
  envPrefix: string;
  defaultContext: number;
  defaultOutput: number;
  nativeRateLimit: (info: RateLimitInfo) => Promise<{ status: number; headers: Record<string, string>; body: string }>;
  // app-specific test for a model native to this app; when the requested model
  // matches, the "not in catalog" notification is suppressed. Optional — when
  // absent, unknown models always notify.
  nativeModelPattern?: RegExp;
};

export type ProxyOptions = {
  configDir: string;
  profile: RoutingProfile;
  resolveHandler: HandlerResolver;
  port?: number;
  log?: (m: string) => void;
  notify?: (m: string, level?: string) => void;
};

export type ProxyServer = {
  listen: () => Promise<number>;
  close: () => Promise<void>;
};

export function isValidProfile(p: any): p is RoutingProfile {
  return (
    !!p &&
    typeof p.configFile === "string" &&
    p.configFile.length > 0 &&
    typeof p.routingKey === "string" &&
    typeof p.tierSourceProvider === "string" &&
    Array.isArray(p.tierOrder) &&
    Array.isArray(p.tierFallback) &&
    p.tierRegex instanceof RegExp &&
    typeof p.envPrefix === "string" &&
    typeof p.defaultContext === "number" &&
    typeof p.defaultOutput === "number" &&
    typeof p.nativeRateLimit === "function"
  );
}
