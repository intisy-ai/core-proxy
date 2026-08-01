// Eager-load accessor for the TeaVM-generated ESM staged into src/generated/ by `npm run
// build:teavm`. initCoreProxy() awaits the dynamic import exactly once at startup; getCoreProxy()
// then reads the already-resolved module synchronously, so every routing decision function can stay
// sync instead of threading async through every caller.

let coreProxyModule: typeof import("./generated/core-proxy.teavm.js") | null = null;
let coreProxyModulePromise: Promise<typeof import("./generated/core-proxy.teavm.js")> | null = null;

export async function initCoreProxy(): Promise<void> {
  if (coreProxyModule) return;
  if (!coreProxyModulePromise) {
    coreProxyModulePromise = import("./generated/core-proxy.teavm.js");
  }
  coreProxyModule = await coreProxyModulePromise;
}

export function getCoreProxy(): typeof import("./generated/core-proxy.teavm.js") {
  if (!coreProxyModule) {
    throw new Error("core-proxy TeaVM module not initialized; call initCoreProxy() at startup");
  }
  return coreProxyModule;
}
