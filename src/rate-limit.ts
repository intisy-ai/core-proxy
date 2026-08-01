import { getCoreProxy } from "./core-proxy-loader.js";
import type { RoutingProfile } from "./types.js";

export function isRateLimited(resp: Response): boolean {
  return resp.status === 429 || resp.headers.get("x-hub-rate-limited") === "1";
}

// Earliest epoch-ms the response says it'll be usable again (x-hub-retry-after-ms, else retry-after
// seconds). `now` defaults to Date.now() but is injectable for tests. Header extraction stays here;
// the arithmetic is CoreProxyJs.rateLimitResetMsJson (single source, mirrors RateLimit.java).
export function rateLimitResetMs(resp: Response, now: number = Date.now()): number {
  const args = {
    headers: {
      "x-hub-retry-after-ms": resp.headers.get("x-hub-retry-after-ms") || "",
      "retry-after": resp.headers.get("retry-after") || "",
    },
    now,
  };
  const core = getCoreProxy();
  return JSON.parse(core.rateLimitResetMsJson(JSON.stringify(args))) as number;
}

// Final response when every model in a chain is rate-limited. Delegates the native-shaped 429
// (status/headers/body) entirely to profile.nativeRateLimit, which owns its upstream's rate-limit
// header conventions and error format. The profile is the sole owner of the synthesized headers;
// this engine has no app-specific header names and overlays nothing on top of what the profile
// returns.
export async function rateLimitFinal(
  lastResp: Response | null,
  resetMs: number,
  profile: RoutingProfile
): Promise<Response> {
  const built = await profile.nativeRateLimit({ resetMs, upstream: lastResp });
  return new Response(built.body, { status: built.status, headers: new Headers(built.headers) });
}
