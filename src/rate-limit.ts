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
// native-shaped 429 (status/headers/body) entirely to profile.nativeRateLimit — each
// routing profile knows its own upstream's rate-limit header conventions and error
// format. The profile is the SOLE owner of the synthesized headers (including any
// upstream headers it chooses to re-apply); this engine has no app-specific header
// names and does not overlay anything on top of what the profile returns.
export async function rateLimitFinal(
  lastResp: Response | null,
  resetMs: number,
  profile: RoutingProfile
): Promise<Response> {
  const built = await profile.nativeRateLimit({ resetMs, upstream: lastResp });
  return new Response(built.body, { status: built.status, headers: new Headers(built.headers) });
}
