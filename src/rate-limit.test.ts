import { expect, it } from "vitest";
import { isRateLimited, rateLimitResetMs, rateLimitFinal } from "./rate-limit.js";
import type { RoutingProfile } from "./types.js";

const prof = {
  nativeRateLimit: async ({ resetMs }: { resetMs: number }) => ({
    status: 429,
    headers: { "x-test": "1" },
    body: JSON.stringify({ resetMs }),
  }),
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

it("rateLimitFinal: preserves upstream anthropic-ratelimit-*/retry-after headers only when the last attempt was itself a native 429", async () => {
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
  expect(r1.headers.get("retry-after")).toBe("42");
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
