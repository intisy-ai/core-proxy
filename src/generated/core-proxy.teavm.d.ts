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
