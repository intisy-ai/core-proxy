import { expect, it } from "vitest";
import { anthropicProfile } from "./anthropic.js";
import { isValidProfile } from "../types.js";

it("anthropicProfile: passes isValidProfile", () => {
  expect(isValidProfile(anthropicProfile())).toBe(true);
});

it("anthropicProfile: nativeRateLimit produces a native rate_limit_error body with a retry-after header owned by the profile", async () => {
  const profile = anthropicProfile();
  const resetMs = Date.now() + 5000;
  const built = await profile.nativeRateLimit({ resetMs, upstream: null });

  expect(built.status).toBe(429);
  expect(built.body).toContain("rate_limit_error");

  const parsed = JSON.parse(built.body);
  expect(parsed.type).toBe("error");
  expect(parsed.error.type).toBe("rate_limit_error");

  // 5000ms -> ~5s; allow slack for wall-clock drift between resetMs capture and the call.
  const retryAfter = parseInt(built.headers["retry-after"], 10);
  expect(retryAfter).toBeGreaterThanOrEqual(4);
  expect(retryAfter).toBeLessThanOrEqual(5);
});

it("anthropicProfile: overrides are spread on top of the defaults", () => {
  const profile = anthropicProfile({ configFile: "custom.json" });
  expect(profile.configFile).toBe("custom.json");
  expect(profile.envPrefix).toBe("ANTHROPIC");
});
