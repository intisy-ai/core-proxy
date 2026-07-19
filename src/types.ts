// Canonical IR types and the per-vendor translator API, imported type-only so they erase at
// build time: core-proxy's compiled dist never imports core-ir at runtime; only a caller that
// constructs a translator instance (a profile or a test) pulls in the real module. core-ir is a
// submodule (./core-ir), reached in Java via java/settings.gradle's :ir alias.
import type { IrRequest, IrResponse, IrStreamEvent, VendorTranslator } from "../core-ir/dist/index.js";
export type { IrRequest, IrResponse, IrStreamEvent, VendorTranslator } from "../core-ir/dist/index.js";

export type HandlerCtx = {
  configDir: string;
  log: (m: string) => void;
  model: string;
};

// A stream of canonical IR events produced directly by a provider's handleIr, not vendor SSE
// bytes (those exist only at the wire boundary, encoded by the translator).
export type IrEventStream = ReadableStream<IrStreamEvent>;

export type ProxyHandler = {
  /**
   * Receives an already-decoded IrRequest and returns an IrResponse (non-streaming) or an
   * IrEventStream (streaming), with no app-wire format knowledge: the front-door (server.ts
   * route()) owns decoding the inbound request into IR via RoutingProfile.translator and encoding
   * the result back to the app's wire format.
   *
   * On a non-2xx upstream outcome an implementation throws HandleIrError (see below) rather than
   * returning it as data, so the front door can still route on it (rate-limit fallback, verbatim
   * 4xx). A handler supplies handleIr, handle, or both; route() requires at least one.
   */
  handleIr?: (ir: IrRequest, ctx: HandlerCtx) => Promise<IrResponse | IrEventStream>;
  /**
   * Optional app-wire entry point: the front-door hands it the raw inbound Request and expects a
   * wire Response. The engine calls it for a handler that supplies only handle (e.g. a profile
   * with no translator), so a non-IR app-proxy remains possible.
   */
  handle?: (request: Request, ctx: HandlerCtx) => Promise<Response>;
};

/**
 * The typed transport error a handleIr implementation throws for a non-2xx upstream outcome
 * (rate limit, bad request, etc.), carrying status/headers/body so the front door (server.ts
 * route()) can reconstruct an equivalent Response and feed it through the same isRateLimited/
 * rateLimitResetMs/fallback/final-429-synthesis logic used for any Response, instead of collapsing
 * every throw to a flat 502. A throw that is not a HandleIrError is a genuine unexpected failure
 * and stays a flat 502.
 */
export class HandleIrError extends Error {
  status: number;
  headers?: Record<string, string>;
  body: string;
  /** When set and no x-hub-retry-after-ms header is already present, server.ts injects it so
   *  rateLimitResetMs can compute the reset time without the thrower knowing the header name. */
  retryAfterMs?: number;

  constructor(init: { status: number; headers?: Record<string, string>; body: string; retryAfterMs?: number }) {
    super("handleIr transport error: " + init.status);
    this.name = "HandleIrError";
    this.status = init.status;
    this.headers = init.headers;
    this.body = init.body;
    this.retryAfterMs = init.retryAfterMs;
  }
}

/**
 * Duck-typed recognizer used at the front-door instead of instanceof. Each provider is
 * esbuild-bundled independently and inlines its own copy of this class, so instanceof against the
 * front-door's (separate) copy returns false and would silently collapse the typed transport error
 * to a 502, breaking rate-limit fallback. Matching the stable `name` marker plus the transport
 * shape survives the bundle boundary.
 */
export function isHandleIrError(e: unknown): e is HandleIrError {
  return (
    e instanceof HandleIrError ||
    (typeof e === "object" &&
      e !== null &&
      (e as { name?: unknown }).name === "HandleIrError" &&
      typeof (e as { status?: unknown }).status === "number" &&
      typeof (e as { body?: unknown }).body === "string")
  );
}

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
   * Loader-facing config field name for the routing-enable toggle, read by the loader, not by this
   * engine. Do not wire it into readModelMap, which reads the separate `modelMap` field.
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
  // Test for a model native to this app; when the requested model matches, the "not in catalog"
  // notification is suppressed. When absent, unknown models always notify.
  nativeModelPattern?: RegExp;
  /**
   * The app<->IR translator for this profile (e.g. core-ir's anthropic translator for Claude Code
   * and OpenCode, which both speak the Anthropic wire format). Undefined means the profile has no
   * IR front-door: the server then uses only the handle() path.
   */
  translator?: VendorTranslator;
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
