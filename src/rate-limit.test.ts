import { expect, it } from "vitest";
import { isRateLimited, rateLimitResetMs, rateLimitFinal } from "./rate-limit.js";
import type { RoutingProfile } from "./types.js";

// Mirrors the real profile's ownership of synthesized headers: it copies the
// upstream 429's own headers into its output itself (the engine no longer does
// this overlay), plus its own x-test marker.
const prof = {
  nativeRateLimit: async ({ resetMs, upstream }: { resetMs: number; upstream: Response | null }) => {
    const headers: Record<string, string> = { "x-test": "1" };
    if (upstream && upstream.status === 429) {
      for (const [k, v] of upstream.headers) {
        if (/^anthropic-ratelimit-/i.test(k)) headers[k] = v;
      }
    }
    return { status: 429, headers, body: JSON.stringify({ resetMs }) };
  },
} as unknown as RoutingProfile;

it("isRateLimited: 429 or x-hub-rate-limited header", () => {
  expect(isRateLimited(new Response("", { status: 429 }))).toBe(true);
  expect(isRateLimited(new Response("", { status: 200, headers: { "x-hub-rate-limited": "1" } }))).toBe(true);
  expect(isRateLimited(new Response("", { status: 200 }))).toBe(false);
});

it("rateLimitResetMs: prefers x-hub-retry-after-ms, else retry-after seconds", () => {
  const now = 1_000_000;
  expect(rateLimitResetMs(new Response("", { headers: { "x-hub-retry-after-ms": "5000" } }), now)).toBe(now + 5000);
  expect(rateLimitResetMs(new Response("", { headers: { "retry-after": "2" } }), now)).toBe(now + 2000);
  expect(rateLimitResetMs(new Response("", {}), now)).toBe(0);
});

it("rateLimitFinal: builds via profile.nativeRateLimit", async () => {
  const r = await rateLimitFinal(null, 1234, prof);
  expect(r.status).toBe(429);
  expect(r.headers.get("x-test")).toBe("1");
  expect(await r.text()).toContain("1234");
});

it("rateLimitFinal: preserves upstream anthropic-ratelimit-* headers only when the last attempt was itself a native 429, but never copies raw upstream retry-after", async () => {
  const upstream429 = new Response("", {
    status: 429,
    headers: {
      "anthropic-ratelimit-unified-status": "rejected",
      "anthropic-ratelimit-unified-reset": "999",
      "retry-after": "42",
      "x-hub-rate-limited": "1",
      "content-length": "0",
    },
  });
  const r1 = await rateLimitFinal(upstream429, 1234, prof);
  expect(r1.headers.get("anthropic-ratelimit-unified-status")).toBe("rejected");
  expect(r1.headers.get("anthropic-ratelimit-unified-reset")).toBe("999");
  // retry-after is owned by profile.nativeRateLimit, never copied from upstream; the
  // stub `prof` doesn't set one, so it must be absent (not the upstream's "42").
  expect(r1.headers.get("retry-after")).toBeNull();
  // internal/hub-only + framing headers must never leak into the synthesized response
  expect(r1.headers.get("x-hub-rate-limited")).toBeNull();
  expect(r1.headers.get("content-length")).not.toBe("0");

  const nonRateLimitUpstream = new Response("", {
    status: 503,
    headers: { "anthropic-ratelimit-unified-status": "should-not-leak" },
  });
  const r2 = await rateLimitFinal(nonRateLimitUpstream, 1234, prof);
  expect(r2.headers.get("anthropic-ratelimit-unified-status")).toBeNull();
});

it("rateLimitFinal: returns exactly what the profile synthesizes — the profile's own retry-after wins and it owns copying upstream headers (locking test)", async () => {
  // Stub mirrors the real profile: it copies every upstream header itself, then
  // sets its own retry-after last so it always wins over a raw upstream value.
  const profWithOwnRetryAfter = {
    nativeRateLimit: async ({ resetMs, upstream }: { resetMs: number; upstream: Response | null }) => {
      const headers: Record<string, string> = {};
      if (upstream) {
        for (const [k, v] of upstream.headers) headers[k] = v;
      }
      headers["retry-after"] = "60";
      return { status: 429, headers, body: JSON.stringify({ resetMs }) };
    },
  } as unknown as RoutingProfile;

  const upstream429 = new Response("", {
    status: 429,
    headers: {
      "retry-after": "5",
      "anthropic-ratelimit-unified-reset": "999",
    },
  });

  const r = await rateLimitFinal(upstream429, 1234, profWithOwnRetryAfter);

  // The profile's own retry-after wins — the raw upstream "5" must never clobber it.
  expect(r.headers.get("retry-after")).toBe("60");
  // The anthropic-ratelimit-* family, copied by the profile's own stub, is present.
  expect(r.headers.get("anthropic-ratelimit-unified-reset")).toBe("999");
});
