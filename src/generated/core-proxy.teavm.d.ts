// Generated from Java sources. Do not edit.

/**
 * A host-provided IR event stream, pulled one event at a time, as a TypeScript consumer sees it.
 *
 * @remarks
 * Never implemented, only emitted. A pull interface rather than an iterable, because the
 * router consuming it is transpiled Java with no for-await.
 */
export interface CoreProxyJsIrStream {
  /**
   * Pulls the next event.
   *
   * @returns the next IR event's JSON, or null once the stream has ended
   */
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
  /**
   * Removes the key, silently doing nothing when it is absent.
   *
   * @param key - the key to remove
   */
  delete(key: string): void;
  /**
   * Tests for a key.
   *
   * @param key - the key to test
   * @returns whether it is present
   */
  exists(key: string): boolean;
  /**
   * Reads one key.
   *
   * @param key - the key to read
   * @returns the stored value, or null when the key is absent or unreadable
   */
  get(key: string): string | null;
  /**
   * Lists a subtree.
   *
   * @param prefix - the prefix to list under
   * @returns every key under it
   */
  listKeys(prefix: string): string[];
  /**
   * Stores a value, silently doing nothing when the write is impossible.
   *
   * @param key - the key to write
   * @param value - what to store under it
   */
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
   * @param requestJson - the request as `method,url,headers,body`
   * @param ctxJson - the per-request runtime the router supplies
   * @returns the response as `status,headers,body`
   * @remarks
   * A `method,url,headers,body` request in, a `status,headers,body` out.
   */
  handle?(requestJson: string, ctxJson: string): Promise<string>;
  /**
   * Handles one IR request, resolving the IR response's JSON.
   *
   * @param irRequestJson - the canonical IR request
   * @param ctxJson - the per-request runtime the router supplies
   * @returns the IR response's JSON
   */
  handleIr?(irRequestJson: string, ctxJson: string): Promise<string>;
  /**
   * Handles one IR request as a stream of IR events.
   *
   * @param irRequestJson - the canonical IR request
   * @param ctxJson - the per-request runtime the router supplies
   * @returns the stream, pulled one event at a time
   */
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
  /**
   * Feeds one raw vendor chunk.
   *
   * @param chunk - the bytes as they arrived, at whatever boundary the transport gave them
   * @returns the IR events the chunk completed, as a JSON array
   */
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
  /**
   * Encodes one IR stream event to the vendor's wire text.
   *
   * @param irEventJson - the IR event
   * @returns the wire text to emit
   */
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
  /**
   * Vendor wire JSON to an IR request.
   *
   * @param wireJson - the request in the vendor's own format
   * @returns the canonical IR request
   */
  decodeRequest(wireJson: string): string;
  /**
   * Vendor wire JSON to an IR response.
   *
   * @param wireJson - the response in the vendor's own format
   * @returns the canonical IR response
   */
  decodeResponse(wireJson: string): string;
  /**
   * An IR request to vendor wire JSON.
   *
   * @param irRequestJson - the canonical IR request
   * @returns the request in the vendor's own format
   */
  encodeRequest(irRequestJson: string): string;
  /**
   * An IR response to vendor wire JSON.
   *
   * @param irResponseJson - the canonical IR response
   * @returns the response in the vendor's own format
   */
  encodeResponse(irResponseJson: string): string;
  /**
   * Opens a decode handle for one connection's stream.
   *
   * @returns a handle carrying that connection's decode state
   */
  newStreamDecoder(): CoreProxyJsStreamDecoder;
  /**
   * Opens an encode handle for one connection's stream.
   *
   * @returns a handle carrying that connection's encode state
   */
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
  /**
   * Called once a streamed body ends.
   *
   * @param error - the failure that ended it, or null on a clean end
   */
  close(error: string | null): void;
  /**
   * Receives each already-encoded wire frame of a streamed body, in order.
   *
   * @param frame - one encoded frame
   */
  emit(frame: string): void;
  /**
   * Records a routing event structurally, alongside the message notify shows.
   *
   * @param action - what happened, as a stable identifier
   * @param impact - what it cost the request
   * @param detailsJson - the event's own payload
   */
  event(action: string, impact: string, detailsJson: string): void;
  /**
   * Builds this app's native rate-limit response.
   *
   * @remarks
   * Takes `resetMs, now, upstreamStatus, upstreamHeaders, upstreamBody` and
   * returns `status, headers, body`. It can be synchronous on the host side, because the
   * upstream body has already been read by the time it is called.
   *
   * @param infoJson - the rate-limit signal, with the upstream response it was read from
   * @returns the response to serve, as `status, headers, body`
   */
  nativeRateLimit(infoJson: string): Promise<string>;
  /**
   * Shows the operator a message.
   *
   * @param message - the text to show
   * @param level - its severity, or null to leave it to the host
   */
  notify(message: string, level: string | null): void;
  /** Every provider the router may route to. */
  providers: string[];
  /**
   * Resolves a provider's handler.
   *
   * @param provider - the provider id a request routed to
   * @returns the handler, or null when that provider has none
   */
  resolveHandler(provider: string): Promise<CoreProxyJsHandler | null>;
  /** Where the router reads its tiers, its model map and its rate-limit state. */
  store: CoreProxyJsStore;
  /** Absent on a wire-only profile, which routes through a handler's own wire path instead. */
  translator?: CoreProxyJsTranslator;
}

/**
 * Parse and stringify with no routing involved, proving the JSON codec crosses TeaVM.
 *
 * @param json - any JSON document
 * @returns the same document, parsed and stringified again
 */
export declare function jsonRoundTrip(json: string): string;
/**
 * Resolves the model map against a live store.
 *
 * @param profileJson - the routing profile as JSON
 * @param jsStore - the host's store, read through on demand
 * @returns each tier's ordered chain, as JSON
 */
export declare function resolveModelMap(profileJson: string, jsStore: CoreProxyJsStore): string;
/**
 * Resolves the model map against a store snapshot.
 *
 * @param profileJson - the routing profile as JSON
 * @param storeJson - the whole store as one JSON object
 * @returns each tier's ordered chain, as JSON
 */
export declare function resolveModelMapJson(profileJson: string, storeJson: string): string;
/**
 * Resolves the tier chain against a live store.
 *
 * @param profileJson - the routing profile as JSON
 * @param jsStore - the host's store, read through on demand
 * @returns the tier names as a JSON array
 */
export declare function resolveTiers(profileJson: string, jsStore: CoreProxyJsStore): string;
/**
 * Resolves the tier chain against a store snapshot.
 *
 * @param profileJson - the routing profile as JSON
 * @param storeJson - the whole store as one JSON object
 * @returns the tier names as a JSON array
 */
export declare function resolveTiersJson(profileJson: string, storeJson: string): string;
/**
 * Routes one request through a host-provided HTTP transport.
 *
 * @param httpSend - the transport, taking the request's JSON and resolving the response's
 * @param jsStore - the host's store, read through on demand
 * @param requestJson - the request as `method,url,headers,body`
 * @returns the response as `status,headers,body`
 * @remarks
 * The transport takes the request's JSON and resolves the response's, which is the
 * whole seam: the router suspends across it without knowing what performs the call.
 */
export declare function routeJsonAsync(httpSend: ((value: string) => Promise<string>), jsStore: CoreProxyJsStore, requestJson: string): Promise<string>;
/**
 * Routes one request against a store snapshot, with no host seams and no upstream call.
 *
 * @param storeJson - the whole store as one JSON object
 * @param requestJson - the request as `method,url,headers,body`
 * @returns the response as `status,headers,body`
 */
export declare function routeJsonSync(storeJson: string, requestJson: string): string;
/**
 * Routes one real request through every host seam.
 *
 * @param deps - every seam the route needs from the host
 * @param profileJson - the routing profile as JSON
 * @param requestJson - the request as `method,url,headers,body`
 * @returns the outcome as `status, headers, body, streamed`
 * @remarks
 * Resolves `status, headers, body, streamed` as JSON. When `streamed` is
 * true the body already went out through the deps' emit and close, and `streamError`
 * reports a mid-stream death. The request's url may be a bare path or an absolute URL.
 */
export declare function routeRequest(deps: CoreProxyJsRouteDeps, profileJson: string, requestJson: string): Promise<string>;

