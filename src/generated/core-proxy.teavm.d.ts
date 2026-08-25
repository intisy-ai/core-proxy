// Hand-authored ambient types for the TeaVM-generated ES module staged into this same directory
// by `npm run build:teavm` (teavm-build.mjs), from java/teavm's CoreProxyJs @JSExport surface. The
// generated core-proxy.teavm.js itself is gitignored (build output); this .d.ts is committed source
// so tsc can type-check consumers of `getCoreProxy()` without needing the build to have run first.

/** Live JS-backed store: `get`/`put`/`exists`/`delete`/`listKeys`, all synchronous. */
export interface CoreProxyJsStore {
  get(key: string): string | undefined | null;
  put(key: string, value: string): void;
  exists(key: string): boolean;
  delete(key: string): void;
  listKeys(prefix: string): string[];
}

/** JS-provided async HTTP transport backing the Java-side HttpClient bridge. */
export type CoreProxyJsHttpSend = (requestJson: string) => Promise<string>;

export function routeJsonSync(storeJson: string, requestJson: string): string;
export function jsonRoundTrip(json: string): string;
export function rateLimitResetMsJson(argsJson: string): string;
export function resolveTiersJson(profileJson: string, storeJson: string): string;
export function resolveModelMapJson(profileJson: string, storeJson: string): string;
export function resolveTiers(profileJson: string, jsStore: CoreProxyJsStore): string;
export function resolveModelMap(profileJson: string, jsStore: CoreProxyJsStore): string;
export function routeJsonAsync(
  httpSend: CoreProxyJsHttpSend,
  jsStore: CoreProxyJsStore,
  requestJson: string,
): Promise<string>;

/** A JS-provided translator handle: the transpiled vendor translator's own string functions. */
export interface CoreProxyJsTranslator {
  decodeRequest(wireJson: string): string;
  encodeRequest(irRequestJson: string): string;
  decodeResponse(wireJson: string): string;
  encodeResponse(irResponseJson: string): string;
  newStreamDecoder(): { decode(chunk: string): string };
  newStreamEncoder(): { encode(irEventJson: string): string };
}

/**
 * A JS-provided provider handler. Every member is optional and the engine reads which are present:
 * `handleIrStream` is absent on a buffered-only handler, `handleIr` on a wire-only one, and `handle`
 * on an IR-native one. A handler offering both IR and wire always takes the IR path.
 */
export interface CoreProxyJsHandler {
  handleIr?(irRequestJson: string, ctxJson: string): Promise<string>;
  handleIrStream?(irRequestJson: string, ctxJson: string): { next(): Promise<string | null> };
  /** The app-wire path: a `{method,url,headers,body}` request in, a `{status,headers,body}` out. */
  handle?(requestJson: string, ctxJson: string): Promise<string>;
}

/** Every seam a production route needs from the host. */
export interface CoreProxyJsRouteDeps {
  store: CoreProxyJsStore;
  /** Absent on a wire-only profile, which routes through a handler's own `handle` instead. */
  translator?: CoreProxyJsTranslator;
  resolveHandler(provider: string): Promise<CoreProxyJsHandler | null>;
  notify(message: string, level: string | null): void;
  /** Records a routing event structurally, alongside the message `notify` shows. */
  event(action: string, impact: string, detailsJson: string): void;
  /**
   * Builds this app's native rate-limit response from
   * `{resetMs, now, upstreamStatus, upstreamHeaders, upstreamBody}`, returning
   * `{status, headers, body}`. Synchronous, and it can be: the upstream body has already been read.
   */
  nativeRateLimit(infoJson: string): Promise<string>;
  /** Receives each already-encoded wire frame of a streamed body, in order. */
  emit(frame: string): void;
  /** Called once a streamed body ends, with the failure that ended it or null. */
  close(error: string | null): void;
  providers: string[];
}

/**
 * Routes one real request. Resolves `{status, headers, body, streamed}` as JSON; when `streamed` is
 * true the body already went out through `emit`/`close` and `streamError` reports a mid-stream death.
 *
 * `requestJson.url` may be a bare path or an absolute URL.
 */
export function routeRequest(
  deps: CoreProxyJsRouteDeps,
  profileJson: string,
  requestJson: string,
): Promise<string>;
