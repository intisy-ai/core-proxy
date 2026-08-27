// Canonical IR types and the per-vendor translator API, imported type-only so they erase at
// build time: core-proxy's compiled dist never imports core-ir at runtime; only a caller that
// constructs a translator instance (a profile or a test) pulls in the real module.
import type { IrRequest, IrResponse, IrStreamEvent, VendorTranslator, WithVendorHandles } from "@intisy-ai/core-ir";
export type { IrRequest, IrResponse, IrStreamEvent, VendorTranslator, WithVendorHandles } from "@intisy-ai/core-ir";

/** The per-request runtime the router hands a handler. */
export type HandlerCtx = {
  /** Where the app's configuration and caches live. */
  configDir: string;
  /** Where the handler's own diagnostics go. */
  log: (m: string) => void;
  /** The upstream model id to call, after any tier or alias rewrite. */
  model: string;
  /**
   * The resolved provider id serving this request. A handler backing several providers
   * (e.g. a shared account pool with distinct upstream lanes) reads it to pick the lane.
   */
  provider: string;
};

/**
 * A stream of canonical IR events produced directly by a provider's `handleIr`, not vendor SSE
 * bytes: those exist only at the wire boundary, encoded by the translator.
 */
export type IrEventStream = ReadableStream<IrStreamEvent>;

/** A provider's entry point, on the IR path, the app-wire path, or both. */
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
 * (rate limit, bad request, etc.), carrying status/headers/body so the front door can reconstruct
 * an equivalent Response and feed it through the router's own rate-limit detection, fallback and
 * final-429 synthesis, the same path any Response takes, instead of collapsing every throw to a
 * flat 502. A throw that is not a HandleIrError is a genuine unexpected failure
 * and stays a flat 502.
 */
export class HandleIrError extends Error {
  status: number;
  headers?: Record<string, string>;
  body: string;
  /** When set and no x-hub-retry-after-ms header is already present, the front door injects it so
   *  the router can compute the reset time without the thrower knowing the header name. */
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

/** Turns a provider id into the handler that serves it, or null when none is installed. */
export type HandlerResolver = (providerName: string) => Promise<ProxyHandler | null>;

/** A resolved provider and model for one request. */
export type Assignment = {
  /** The provider id that will serve the request. */
  provider: string;
  /** The upstream model id to send. */
  model: string;
  /** The display name, as a dashboard or log line shows it. */
  name?: string;
  /** Whether the model was derived from a tier rather than named by the request. */
  derived?: boolean;
};

/** One tier's assignments, primary first, the rest ordered fallbacks. */
export type Chain = Assignment[];

/** Every tier's chain, always including `default`. */
export type ModelMap = { [tier: string]: Chain } & { default: Chain };

/** One model a provider offers, as the catalog cache describes it. */
export type CatalogEntry = {
  /** The provider id offering this model. */
  provider: string;
  /** The upstream model id, as the provider names it. */
  model: string;
  /** The display name for the model. */
  name?: string;
  /** Ranking weight within a tier, higher first. */
  score?: number;
  /** Token limits the provider reports, either half absent when it names none. */
  limit?: { context?: number; output?: number };
};

/** A rate-limit signal observed from one upstream response. */
export type RateLimitInfo = {
  /** Epoch milliseconds at which the limit lifts, or 0 when the upstream named no reset. */
  resetMs: number;
  /** The response the signal was read from, kept so a synthesized reply can echo it. */
  upstream: Response | null;
};

/** How one app tiers its models, maps them, and shapes its own rate-limit reply. */
export type RoutingProfile = {
  /** Store key holding the app's loader config, whose `modelMap` object carries the mapping. */
  configFile: string;
  /**
   * Loader-facing config field name for the routing-enable toggle, read by the loader, not by this
   * engine. Do not wire it into readModelMap, which reads the separate `modelMap` field.
   */
  routingKey: string;
  /** The provider whose catalog the tier names are derived from. */
  tierSourceProvider: string;
  /** Known tier names, in the order a reader expects to see them. */
  tierOrder: string[];
  /** Tiers offered before any catalog exists, which is what a pre-login host sees. */
  tierFallback: string[];
  /** Extracts a tier name from a model id, so a new model family gets a mapping slot on its own. */
  tierRegex: RegExp;
  /** Prefix for the environment variables the model map exports, which the host app reads. */
  envPrefix: string;
  /** Input-token limit reported for a catalog entry that names none. */
  defaultContext: number;
  /** Output-token limit reported for a catalog entry that names none. */
  defaultOutput: number;
  /** Builds the app-shaped rate-limit response this proxy returns instead of a bare 429. */
  nativeRateLimit: (info: RateLimitInfo) => Promise<{ status: number; headers: Record<string, string>; body: string }>;
  /**
   * Test for a model native to this app; when the requested model matches, the "not in catalog"
   * notification is suppressed. When absent, unknown models always notify.
   */
  nativeModelPattern?: RegExp;
  /**
   * The app-to-IR translator for this profile, undefined when the profile has no IR front door and
   * the server uses only the `handle()` path.
   *
   * Carries {@link WithVendorHandles} because the routing engine is Java and reaches a translator
   * through a synchronous seam, so it needs the vendor module's own string functions rather than the
   * promise-returning wrappers built over them. Every translator from `makeVendorTranslator` has it.
   */
  translator?: VendorTranslator & WithVendorHandles;
};

/** Everything `createProxyServer` needs to stand one proxy up. */
export type ProxyOptions = {
  /** Where the app's configuration and caches live. */
  configDir: string;
  /** How this app tiers, maps and rate-limits. */
  profile: RoutingProfile;
  /** Turns a provider id into the handler that serves it. */
  resolveHandler: HandlerResolver;
  /** Port to listen on; the server picks one when omitted. */
  port?: number;
  /** Where the server's own diagnostics go. */
  log?: (m: string) => void;
  /** Where user-visible notices go. */
  notify?: (m: string, level?: string) => void;
  /** Where routing events are recorded, alongside the message `notify` shows. */
  emitActivity?: (spec: { topic: string; action: string; actor?: string; impact?: string; subject?: any; details?: any }) => void;
};

/** A proxy that has been built but not necessarily started. */
export type ProxyServer = {
  /** Starts listening and resolves the port actually bound. */
  listen: () => Promise<number>;
  /** Stops listening and releases the port. */
  close: () => Promise<void>;
};

/**
 * Whether a value carries everything the router needs from a profile.
 *
 * @param p the candidate, of any shape
 * @returns true when every required field is present and of the right type
 */
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

/**
 * Owns one app's wire format: the seam between what an app sends and the canonical IR everything
 * downstream carries.
 *
 * @remarks
 * Hand-written rather than emitted from Java, for the same reason `IrEventStream` above is: every
 * type in it is a web-platform global (`Request`, `Response`) or a TypeScript union, so a Java
 * declaration would carry none of the contract and the annotations would carry all of it. The Java
 * side's equivalent seam is the proxy handler's `HttpRequest`/`HttpResponse` pair, which is a
 * different contract over a different transport abstraction, not this one spelled differently.
 */
export interface FrontDoorCapability {
  /** Decodes an app request into IR, or returns null when the request is not one to route. */
  decode(request: Request): Promise<IrRequest | null>;
  /** Encodes an IR result back into the app's wire format. */
  encode(result: IrResponse | IrEventStream): Promise<Response>;
  /** Rebuilds a wire response from a thrown handler error, or returns null when it cannot. */
  encodeError(error: unknown): Response | null;
}
