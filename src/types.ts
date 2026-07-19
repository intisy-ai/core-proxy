// SP-3: the canonical IR types + per-vendor translator API, type-only (erased at build time --
// core-proxy's own compiled dist/server.js never imports core-ir at runtime; only a caller that
// actually constructs a translator instance, e.g. a profile or a test, pulls in the real module).
// core-ir is a submodule (./core-ir) built the same way claude-code-auth/stub-auth's provider
// modules consume it -- see ./core-ir/README.md and this repo's java/settings.gradle :ir alias.
import type { IrRequest, IrResponse, IrStreamEvent, VendorTranslator } from "../core-ir/dist/index.js";
export type { IrRequest, IrResponse, IrStreamEvent, VendorTranslator } from "../core-ir/dist/index.js";

export type HandlerCtx = {
  configDir: string;
  log: (m: string) => void;
  model: string;
};

// A stream of canonical IR events, produced directly by an IR-native provider's handleIr (not
// vendor SSE bytes -- those only exist at the wire boundary, decoded/encoded by the translator).
export type IrEventStream = ReadableStream<IrStreamEvent>;

export type ProxyHandler = {
  /**
   * IR-native entry point (SP-3, the layering flip): receives an already app-wire-decoded IrRequest
   * and returns an IrResponse (non-streaming) or an IrEventStream (streaming), with zero app-wire
   * format knowledge in the handler itself -- the front-door (server.ts route()) owns decoding the
   * inbound request into IR (via RoutingProfile.translator) and encoding the result back to the
   * app's wire format. This is the contract every ecosystem provider implements post-T4.
   *
   * On a non-2xx upstream outcome a handleIr implementation throws `HandleIrError` (see below)
   * rather than returning it as data, so the front door can still route on it (rate-limit fallback,
   * verbatim 4xx). A handler supplies handleIr, the legacy `handle`, or both -- the gate in route()
   * requires at least one.
   */
  handleIr?: (ir: IrRequest, ctx: HandlerCtx) => Promise<IrResponse | IrEventStream>;
  /**
   * Legacy app-wire entry point: the front-door hands it the raw inbound Request and expects a wire
   * Response. Optional -- an IR-native handler omits it entirely (providers do post-T4). The generic
   * engine keeps calling it for a handler that supplies only `handle` (e.g. a profile with no
   * translator), so a non-IR app-proxy remains possible; it is never an app-specific trace in a
   * provider, only an engine capability.
   */
  handle?: (request: Request, ctx: HandlerCtx) => Promise<Response>;
};

/**
 * T3c-1: the typed transport error a `handleIr` implementation throws for a non-2xx upstream
 * outcome (rate limit, bad request, etc.), carrying exactly what the legacy `handle()` path's
 * real Response carried -- status/headers/body -- so the front door (server.ts route()) can
 * reconstruct an equivalent Response and feed it through the SAME isRateLimited/rateLimitResetMs/
 * fallback/final-429-synthesis logic used for a legacy Response, instead of collapsing every
 * throw to a flat 502 (which lost status fidelity and broke rate-limit fallback). A throw that is
 * NOT a HandleIrError is a genuine unexpected failure and stays a flat 502, unchanged.
 */
export class HandleIrError extends Error {
  status: number;
  headers?: Record<string, string>;
  body: string;
  /** Optional convenience: when set and no x-hub-retry-after-ms header is already present,
   *  server.ts injects it so rateLimitResetMs can compute the reset time without the thrower
   *  having to know the header name. */
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
 * Duck-typed recognizer for a HandleIrError, used at the front-door instead of `instanceof`.
 * Providers are esbuild-bundled independently, so each provider's `dist/handler.js` inlines its
 * OWN copy of this class. When the front-door (a SEPARATE core-proxy bundle) catches a throw from
 * a dynamically-loaded provider handler, `instanceof HandleIrError` compares against the wrong copy
 * and returns false, silently collapsing the typed transport error to a 502 and breaking rate-limit
 * fallback. Matching the stable `name` marker plus the transport shape survives the bundle boundary.
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
  /**
   * SP-3: the app<->IR translator for this profile (e.g. core-ir's `translators.anthropic` for
   * Claude Code / OpenCode, both of which speak the Anthropic wire format). An injected instance
   * rather than a name/key — profiles already carry functions (nativeRateLimit), so this matches
   * the existing shape and needs no separate registry. Undefined means this profile has no IR
   * front-door yet: the server then uses ONLY the legacy handle() path unconditionally, so an
   * existing profile that never sets this field keeps working unchanged (additive/coexist).
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
