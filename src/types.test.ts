import { expect, it } from "vitest";
import type { RoutingProfile, HandlerCtx } from "./types.js";
import { isValidProfile } from "./types.js";

it("isValidProfile accepts a complete profile and rejects a partial one", () => {
  const p: RoutingProfile = {
    configFile: "x.json", routingKey: "providerRouting", tierSourceProvider: "claude-code",
    tierOrder: ["opus"], tierFallback: ["opus"], tierRegex: /^claude-([a-z]+)-\d/,
    envPrefix: "ANTHROPIC", defaultContext: 200000, defaultOutput: 64000,
    nativeRateLimit: async () => ({ status: 429, headers: {}, body: "{}" }),
  };
  expect(isValidProfile(p)).toBe(true);
  expect(isValidProfile({ ...p, configFile: "" })).toBe(false);
});
