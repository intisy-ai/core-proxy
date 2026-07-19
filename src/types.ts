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
  handle: (request: Request, ctx: HandlerCtx) => Promise<Response>;
  /**
   * SP-3 IR-native alternative to `handle`: receives an already app-wire-decoded IrRequest and
   * returns an IrResponse (non-streaming) or an IrEventStream (streaming), with zero app-wire
   * format knowledge in the handler itself -- the front-door (server.ts route()) owns decoding
   * the inbound request into IR (via RoutingProfile.translator) and encoding the result back to
   * the app's wire format. Optional: a legacy handler simply omits it, and the server falls back
   * to calling `handle` unchanged (coexist-then-remove, per the canonical IR design doc).
   */
  handleIr?: (ir: IrRequest, ctx: HandlerCtx) => Promise<IrResponse | IrEventStream>;
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
