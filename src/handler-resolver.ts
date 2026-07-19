// Provider handler modules are loaded dynamically from disk. A long-lived proxy process caches ESM
// imports by URL, so without an mtime cache-bust a provider update would never take effect until the
// process restarts. Cache per provider path; re-import only when the file's mtime moves.

import { existsSync, statSync } from "node:fs";
import { pathToFileURL } from "node:url";
import type { HandlerResolver, ProxyHandler } from "./types.js";

type HandlerCacheEntry = { path: string; mtime: number; mod: unknown };

export function makeDynamicResolver(
  listProviders: () => { provider: string; handlerPath: string }[]
): HandlerResolver {
  const handlerCache: Record<string, HandlerCacheEntry> = {};

  return async function resolve(providerName: string): Promise<ProxyHandler | null> {
    const match = listProviders().find((p) => p.provider === providerName);
    if (!match || !existsSync(match.handlerPath)) return null;
    const path = match.handlerPath;

    let mtime = 0;
    try {
      mtime = statSync(path).mtimeMs;
    } catch {}

    const cached = handlerCache[providerName];
    let mod: unknown;
    if (cached && cached.path === path && cached.mtime === mtime) {
      mod = cached.mod;
    } else {
      mod = await import(pathToFileURL(path).href + "?v=" + mtime);
      handlerCache[providerName] = { path, mtime, mod };
    }

    const handle = (mod as { handle?: unknown }).handle;
    return typeof handle === "function" ? { handle: handle as ProxyHandler["handle"] } : null;
  };
}
