import { afterEach, beforeEach, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveModelMap, normalizeChain, modelEnvPairs } from "./model-map.js";

const profile = {
  configFile: "claude-code-loader.json", routingKey: "providerRouting", tierSourceProvider: "claude-code",
  tierOrder: ["opus", "sonnet", "haiku", "fable"], tierFallback: ["opus", "sonnet", "haiku"],
  tierRegex: /^claude-([a-z]+)-\d/, envPrefix: "ANTHROPIC", defaultContext: 200000, defaultOutput: 64000,
  nativeRateLimit: async () => ({ status: 429, headers: {}, body: "{}" }),
} as any;

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cp-mm-"));
  mkdirSync(join(dir, "config"), { recursive: true });
  writeFileSync(join(dir, "config", "claude-code-loader.json"), JSON.stringify({
    modelMap: { opus: { provider: "antigravity", model: "claude-opus-4-6-thinking" } },
  }));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

it("normalizeChain: legacy object -> array; array passthrough; filters invalid", () => {
  expect(normalizeChain({ provider: "a", model: "m" })).toEqual([{ provider: "a", model: "m" }]);
  expect(normalizeChain([{ provider: "a", model: "m" }, { model: "x" }])).toEqual([{ provider: "a", model: "m" }]);
  expect(normalizeChain(null)).toEqual([]);
});
it("resolveModelMap: honors an explicit tier mapping", () => {
  const map = resolveModelMap(dir, profile);
  expect(map.opus[0]).toMatchObject({ provider: "antigravity", model: "claude-opus-4-6-thinking" });
  expect(Array.isArray(map.default)).toBe(true);
});
it("modelEnvPairs: emits ANTHROPIC_DEFAULT_<TIER>_MODEL for mapped tiers", () => {
  const pairs = modelEnvPairs(dir, profile);
  const keys = pairs.map((p) => p.key);
  expect(keys).toContain("ANTHROPIC_DEFAULT_OPUS_MODEL");
  expect(pairs.find((p) => p.key === "ANTHROPIC_DEFAULT_OPUS_MODEL")!.value).toBe("claude-opus-4-6-thinking");
});
