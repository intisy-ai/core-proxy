// Generated from Java sources. Do not edit.

/**
 * A host-provided IR event stream, pulled one event at a time, as a TypeScript consumer sees it.
 *
 * @remarks
 * Never implemented, only emitted. A pull interface rather than an iterable, because the
 * router consuming it is transpiled Java with no for-await.
 */
export interface CoreProxyJsIrStream {
  /** The next IR event's JSON, or null once the stream has ended. */
  next(): Promise<string | null>;
}

/**
 * A host-provided key-value store the router reads and writes, as a TypeScript consumer sees it.
 *
 * @remarks
 * Never implemented, only emitted: the Java bridge it describes speaks JSO types that mean
 * nothing to a TypeScript caller. Every member is synchronous, because the router calls them from
 * transpiled Java that has no way to await.
 */
export interface CoreProxyJsStore {
  /** Removes the key, silently doing nothing when it is absent. */
  delete(key: string): void;
  /** Whether the key is present. */
  exists(key: string): boolean;
  /** The stored value, or null when the key is absent or unreadable. */
  get(key: string): string | null;
  /** Every key under the prefix. */
  listKeys(prefix: string): string[];
  /** Stores a value, silently doing nothing when the write is impossible. */
  put(key: string, value: string): void;
}

/**
 * A host-provided provider handler, as a TypeScript consumer sees it.
 *
 * @remarks
 * Never implemented, only emitted. Every member is optional and the engine reads which are
 * present: a buffered-only handler carries no `handleIrStream`, a wire-only one no
 * `handleIr`, and an IR-native one no `handle`. A handler offering both IR and wire
 * always takes the IR path.
 */
export interface CoreProxyJsHandler {
  /**
   * Handles one request on the app-wire path.
   *
   * @remarks
   * A `{method,url,headers,body`} request in, a `{status,headers,body`} out.
   */
  handle?(requestJson: string, ctxJson: string): Promise<string>;
  /** Handles one IR request, resolving the IR response's JSON. */
  handleIr?(irRequestJson: string, ctxJson: string): Promise<string>;
  /** Handles one IR request as a stream of IR events. */
  handleIrStream?(irRequestJson: string, ctxJson: string): CoreProxyJsIrStream;
}

/**
 * A host-provided stream decode handle, as a TypeScript consumer sees it.
 *
 * @remarks
 * Never implemented, only emitted. Named rather than inlined into
 * {@link CoreProxyJsTranslator}, because the processor emits a type reference and an anonymous shape
 * has no name to reference.
 */
export interface CoreProxyJsStreamDecoder {
  /** Feeds one raw vendor chunk and returns the IR events it completed, as a JSON array. */
  decode(chunk: string): string;
}

/**
 * A host-provided stream encode handle, as a TypeScript consumer sees it.
 *
 * @remarks
 * Never implemented, only emitted, for the same reason as
 * {@link CoreProxyJsStreamDecoder}.
 */
export interface CoreProxyJsStreamEncoder {
  /** Encodes one IR stream event to the vendor's wire text. */
  encode(irEventJson: string): string;
}

/**
 * A host-provided vendor translator, as a TypeScript consumer sees it.
 *
 * @remarks
 * Never implemented, only emitted. This is the shape a transpiled vendor translator's own
 * string functions already have, so a caller passes that module's exports straight through.
 */
export interface CoreProxyJsTranslator {
  /** Vendor wire JSON to an IR request. */
  decodeRequest(wireJson: string): string;
  /** Vendor wire JSON to an IR response. */
  decodeResponse(wireJson: string): string;
  /** An IR request to vendor wire JSON. */
  encodeRequest(irRequestJson: string): string;
  /** An IR response to vendor wire JSON. */
  encodeResponse(irResponseJson: string): string;
  /** Opens a decode handle for one connection's stream. */
  newStreamDecoder(): CoreProxyJsStreamDecoder;
  /** Opens an encode handle for one connection's stream. */
  newStreamEncoder(): CoreProxyJsStreamEncoder;
}

/**
 * Every seam a production route needs from the host, as a TypeScript consumer sees it.
 *
 * @remarks
 * Never implemented, only emitted. The store and the provider list are properties because
 * the host hands over values; everything else is a call the router makes back out.
 */
export interface CoreProxyJsRouteDeps {
  /** Called once a streamed body ends, with the failure that ended it or null. */
  close(error: string | null): void;
  /** Receives each already-encoded wire frame of a streamed body, in order. */
  emit(frame: string): void;
  /** Records a routing event structurally, alongside the message notify shows. */
  event(action: string, impact: string, detailsJson: string): void;
  /**
   * Builds this app's native rate-limit response.
   *
   * @remarks
   * Takes `{resetMs, now, upstreamStatus, upstreamHeaders, upstreamBody`} and
   * returns `{status, headers, body`}. It can be synchronous on the host side, because the
   * upstream body has already been read by the time it is called.
   */
  nativeRateLimit(infoJson: string): Promise<string>;
  /** Shows the operator a message. */
  notify(message: string, level: string | null): void;
  /** Every provider the router may route to. */
  providers: string[];
  /** Resolves a provider's handler, or null when that provider has none. */
  resolveHandler(provider: string): Promise<CoreProxyJsHandler | null>;
  /** Where the router reads its tiers, its model map and its rate-limit state. */
  store: CoreProxyJsStore;
  /** Absent on a wire-only profile, which routes through a handler's own wire path instead. */
  translator?: CoreProxyJsTranslator;
}

/** Parse and stringify with no routing involved, proving the JSON codec crosses TeaVM. */
export declare function jsonRoundTrip(json: string): string;
/** Resolves the model map against a live store. */
export declare function resolveModelMap(profileJson: string, jsStore: CoreProxyJsStore): string;
/** Resolves the model map against a store snapshot. */
export declare function resolveModelMapJson(profileJson: string, storeJson: string): string;
/** Resolves the tier chain against a live store. */
export declare function resolveTiers(profileJson: string, jsStore: CoreProxyJsStore): string;
/** Resolves the tier chain against a store snapshot. */
export declare function resolveTiersJson(profileJson: string, storeJson: string): string;
/**
 * Routes one request through a host-provided HTTP transport.
 *
 * @remarks
 * The transport takes the request's JSON and resolves the response's, which is the
 * whole seam: the router suspends across it without knowing what performs the call.
 */
export declare function routeJsonAsync(httpSend: ((value: string) => Promise<string>), jsStore: CoreProxyJsStore, requestJson: string): Promise<string>;
/** Routes one request against a store snapshot, with no host seams and no upstream call. */
export declare function routeJsonSync(storeJson: string, requestJson: string): string;
/**
 * Routes one real request through every host seam.
 *
 * @remarks
 * Resolves `{status, headers, body, streamed`} as JSON. When `streamed` is
 * true the body already went out through the deps' emit and close, and `streamError`
 * reports a mid-stream death. The request's url may be a bare path or an absolute URL.
 */
export declare function routeRequest(deps: CoreProxyJsRouteDeps, profileJson: string, requestJson: string): Promise<string>;

