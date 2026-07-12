import type { RoutingProfile } from "./types.js";

export function isRateLimited(resp: Response): boolean {
  return resp.status === 429 || resp.headers.get("x-hub-rate-limited") === "1";
}

// Earliest epoch-ms the response says it'll be usable again (x-hub-retry-after-ms,
// else retry-after seconds). `now` defaults to Date.now() but is injectable for tests.
export function rateLimitResetMs(resp: Response, now: number = Date.now()): number {
  const xr = parseInt(resp.headers.get("x-hub-retry-after-ms") || "", 10);
  if (!Number.isNaN(xr) && xr > 0) return now + xr;
  const ra = parseInt(resp.headers.get("retry-after") || "", 10);
  if (!Number.isNaN(ra) && ra > 0) return now + ra * 1000;
  return 0;
}

// Final response when every model in a chain is rate-limited. Delegates the actual
// native-shaped 429 (status/headers/body) to profile.nativeRateLimit — each routing
// profile knows its own upstream's rate-limit header conventions and error format.
// On top of that, when the LAST attempt was itself a real upstream 429, re-apply its
// anthropic-ratelimit-*/retry-after headers so precise upstream reset info survives
// the synthesis (behavior parity with claude-code-loader/src/proxy.ts:114-142, which
// keeps every upstream 429 header except its own internal x-hub-*/content-* framing
// ones — the only such headers actually produced across this codebase are the
// anthropic-ratelimit-* family and retry-after).
export async function rateLimitFinal(
  lastResp: Response | null,
  resetMs: number,
  profile: RoutingProfile
): Promise<Response> {
  const built = await profile.nativeRateLimit({ resetMs, upstream: lastResp });
  const headers = new Headers(built.headers);
  if (lastResp && lastResp.status === 429) {
    for (const [k, v] of lastResp.headers) {
      if (/^anthropic-ratelimit-|^retry-after$/i.test(k)) headers.set(k, v);
    }
  }
  return new Response(built.body, { status: built.status, headers });
}
