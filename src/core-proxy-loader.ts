// Eager-load accessor for the TeaVM-generated ESM staged into src/generated/ by `npm run
// build:teavm`. initCoreProxy() awaits the dynamic import exactly once at startup; getCoreProxy()
// then reads the already-resolved module synchronously, so every routing decision function can stay
// sync instead of threading async through every caller.

let coreProxyModule: typeof import("./generated/core-proxy.teavm.js") | null = null;
let coreProxyModulePromise: Promise<typeof import("./generated/core-proxy.teavm.js")> | null = null;

/**
 * Loads the TeaVM module once, at startup.
 *
 * @remarks
 * Concurrent callers share one import; a second call after it resolves does nothing.
 */
export async function initCoreProxy(): Promise<void> {
  if (coreProxyModule) return;
  if (!coreProxyModulePromise) {
    coreProxyModulePromise = import("./generated/core-proxy.teavm.js");
  }
  coreProxyModule = await coreProxyModulePromise;
}

/**
 * Reads the already-loaded TeaVM module synchronously.
 *
 * @returns the module, so a routing decision need not be async
 * @throws Error when {@link initCoreProxy} has not resolved yet
 */
export function getCoreProxy(): typeof import("./generated/core-proxy.teavm.js") {
  if (!coreProxyModule) {
    throw new Error("core-proxy TeaVM module not initialized; call initCoreProxy() at startup");
  }
  return coreProxyModule;
}
