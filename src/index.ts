// Lazily-memoized dynamic import of the TeaVM ESM -- staged to src/generated/ by
// `npm run build:teavm` ahead of tsc.
let coreProxyModulePromise: Promise<typeof import("./generated/core-proxy.teavm.js")> | null = null;

export function loadCoreProxy(): Promise<typeof import("./generated/core-proxy.teavm.js")> {
  if (!coreProxyModulePromise) {
    coreProxyModulePromise = import("./generated/core-proxy.teavm.js");
  }
  return coreProxyModulePromise;
}

export type {
  HandlerCtx,
  IrEventStream,
  IrRequest,
  IrResponse,
  IrStreamEvent,
  VendorTranslator,
  ProxyHandler,
  HandlerResolver,
  Assignment,
  Chain,
  ModelMap,
  CatalogEntry,
  RateLimitInfo,
  RoutingProfile,
  ProxyOptions,
  ProxyServer,
} from "./types.js";
export { isValidProfile, HandleIrError, isHandleIrError } from "./types.js";

export { isRateLimited, rateLimitResetMs, rateLimitFinal } from "./rate-limit.js";

export { claudeTiers, readModelMap, catalogEntries, normalizeChain, resolveModelMap, modelEnvPairs } from "./model-map.js";

export { makeDynamicResolver } from "./handler-resolver.js";

export { createProxyServer } from "./server.js";
