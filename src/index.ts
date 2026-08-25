export { initCoreProxy, getCoreProxy } from "./core-proxy-loader.js";

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


export { claudeTiers, readModelMap, catalogEntries, normalizeChain, resolveModelMap, modelEnvPairs } from "./model-map.js";

export { makeDynamicResolver } from "./handler-resolver.js";

export { createProxyServer } from "./server.js";

export { serveIr } from "./serve-ir.js";
export type { ServeIrOptions } from "./serve-ir.js";

export { frontDoor } from "./front-door.js";
export type { FrontDoorCapability } from "./front-door.js";
export { FRONT_DOOR } from "./generated/proxy-contracts.keys.js";
