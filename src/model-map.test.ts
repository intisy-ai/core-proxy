import { afterEach, beforeAll, beforeEach, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { initCoreProxy } from "./core-proxy-loader.js";
import { resolveModelMap, claudeTiers, normalizeChain, modelEnvPairs } from "./model-map.js";

beforeAll(() => initCoreProxy());

const profile = {
  configFile: "claude-code-loader.json", routingKey: "providerRouting", tierSourceProvider: "claude-code",
  tierOrder: ["opus", "sonnet", "haiku", "fable"], tierFallback: ["opus", "sonnet", "haiku"],
  tierRegex: /^claude-([a-z]+)-\d/, envPrefix: "ANTHROPIC", defaultContext: 200000, defaultOutput: 64000,
  nativeRateLimit: async () => ({ status: 429, headers: {}, body: "{}" }),
} as any;

// Minimal dir: a stored mapping but no models.json cache at all (pre-login state).
let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cp-mm-"));
  mkdirSync(join(dir, "config"), { recursive: true });
  writeFileSync(join(dir, "config", "claude-code-loader.json"), JSON.stringify({
    modelMap: { opus: { provider: "antigravity", model: "claude-opus-4-6-thinking" } },
  }));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

// Richer dir: a live models.json cache for two providers (one of them the tier source), plus a
// mapping file exercising every resolution branch (stored/fully-caught, stale-heal-within-provider,
// unset/derive-from-tier-source, a stale "-auto" id, and an unset default).
let richDir: string;
beforeEach(() => {
  richDir = mkdtempSync(join(tmpdir(), "cp-mm-rich-"));
  mkdirSync(join(richDir, "config"), { recursive: true });
  mkdirSync(join(richDir, "repos", "claude-code"), { recursive: true });
  mkdirSync(join(richDir, "repos", "antigravity"), { recursive: true });
  writeFileSync(join(richDir, "repos", "claude-code", "package.json"), JSON.stringify({
    claudeHub: { authProviders: [{ name: "claude-code", models: [] }] },
  }));
  writeFileSync(join(richDir, "repos", "antigravity", "package.json"), JSON.stringify({
    claudeHub: { authProviders: [{ name: "antigravity", models: [] }] },
  }));
  writeFileSync(join(richDir, "config", "models.json"), JSON.stringify({
    "claude-code": {
      ranking: ["claude-opus-4-6-thinking", "claude-sonnet-4-6", "claude-haiku-4-6", "claude-fable-5", "claude-opus-4-6-auto"],
      models: {
        "claude-opus-4-6-thinking": { name: "Opus 4.6 Thinking" },
        "claude-sonnet-4-6": { name: "Sonnet 4.6" },
        "claude-haiku-4-6": { name: "Haiku 4.6" },
        "claude-fable-5": { name: "Fable 5" },
        "claude-opus-4-6-auto": { name: "Opus Auto" },
      },
      scores: {},
    },
    antigravity: {
      ranking: ["claude-opus-4-6-thinking-x", "gemini-3-pro"],
      models: {
        "claude-opus-4-6-thinking-x": { name: "Antigravity Opus" },
        "gemini-3-pro": { name: "Gemini 3 Pro" },
      },
      scores: { "claude-opus-4-6-thinking-x": 80, "gemini-3-pro": 60 },
    },
  }));
  writeFileSync(join(richDir, "config", "claude-code-loader.json"), JSON.stringify({
    modelMap: {
      // stale: heals within antigravity, never crosses to the tier-source provider
      opus: { provider: "antigravity", model: "claude-opus-OLD-STALE" },
      // fully stored: matches the live catalog exactly, kept as-is (not derived)
      sonnet: { provider: "claude-code", model: "claude-sonnet-4-6" },
      // stale id that itself looks like a placeholder ("-auto"); heals to the real fable-5
      fable: { provider: "claude-code", model: "claude-fable-5-auto" },
      // haiku intentionally unset -> derives from the tier-source provider
      // default intentionally unset -> falls back to the first non-empty tier
    },
  }));
});
afterEach(() => rmSync(richDir, { recursive: true, force: true }));

// A provider declared in repos/*/package.json (with a static pre-login model list) that core-auth
// has never fetched a catalog for (no models.json entry at all): proves resolveModelMap's catalog
// includes declared-but-uncached providers, not just the ones models.json already knows about.
let uncachedDir: string;
beforeEach(() => {
  uncachedDir = mkdtempSync(join(tmpdir(), "cp-mm-uncached-"));
  mkdirSync(join(uncachedDir, "config"), { recursive: true });
  mkdirSync(join(uncachedDir, "repos", "newprov-plugin"), { recursive: true });
  writeFileSync(join(uncachedDir, "repos", "newprov-plugin", "package.json"), JSON.stringify({
    authProviders: [{ name: "newprov", models: [{ id: "newprov-model-1", name: "New Provider Model" }] }],
  }));
  writeFileSync(join(uncachedDir, "config", "claude-code-loader.json"), JSON.stringify({
    modelMap: { opus: { provider: "newprov", model: "newprov-model-1" } },
  }));
});
afterEach(() => rmSync(uncachedDir, { recursive: true, force: true }));

it("normalizeChain: legacy object -> array; array passthrough; filters invalid", () => {
  expect(normalizeChain({ provider: "a", model: "m" })).toEqual([{ provider: "a", model: "m" }]);
  expect(normalizeChain([{ provider: "a", model: "m" }, { model: "x" }])).toEqual([{ provider: "a", model: "m" }]);
  expect(normalizeChain(null)).toEqual([]);
});

it("claudeTiers: empty catalog (no models.json yet) falls back to profile.tierFallback", () => {
  expect(claudeTiers(dir, profile)).toEqual(profile.tierFallback);
});

it("claudeTiers: detects families from the tier-source provider's ranking, ordered by tierOrder", () => {
  expect(claudeTiers(richDir, profile)).toEqual(["opus", "sonnet", "haiku", "fable"]);
});

it("resolveModelMap: a fully-stored tier is kept as-is (not derived)", () => {
  const map = resolveModelMap(richDir, profile);
  expect(map.sonnet).toEqual([{ provider: "claude-code", model: "claude-sonnet-4-6", name: "Sonnet 4.6", derived: false }]);
});

it("resolveModelMap: a stale tier heals within its OWN provider, never crossing to the tier-source provider", () => {
  const map = resolveModelMap(richDir, profile);
  expect(map.opus).toEqual([{ provider: "antigravity", model: "claude-opus-4-6-thinking-x", name: "Antigravity Opus", derived: true }]);
});

it("resolveModelMap: an unset tier derives from the tier-source provider's catalog", () => {
  const map = resolveModelMap(richDir, profile);
  expect(map.haiku).toEqual([{ provider: "claude-code", model: "claude-haiku-4-6", name: "Haiku 4.6", derived: true }]);
});

it("resolveModelMap: a stale '-auto'-shaped stored id heals to the real, non-auto model", () => {
  const map = resolveModelMap(richDir, profile);
  expect(map.fable).toEqual([{ provider: "claude-code", model: "claude-fable-5", name: "Fable 5", derived: true }]);
});

it("resolveModelMap: never resolves any tier to a '-auto' catalog id", () => {
  const map = resolveModelMap(richDir, profile);
  for (const chain of Object.values(map)) {
    for (const entry of chain) expect(entry.model.endsWith("-auto")).toBe(false);
  }
});

it("resolveModelMap: an unset default falls back to the first non-empty tier, marked derived", () => {
  const map = resolveModelMap(richDir, profile);
  expect(map.default).toEqual(map.opus.map((e) => ({ ...e, derived: true })));
});

it("resolveModelMap: honors an explicit tier mapping (no catalog: unknown-provider passthrough)", () => {
  const map = resolveModelMap(dir, profile);
  expect(map.opus[0]).toMatchObject({ provider: "antigravity", model: "claude-opus-4-6-thinking" });
  expect(Array.isArray(map.default)).toBe(true);
});

it("resolveModelMap: a provider declared but never fetched into models.json still resolves via its static model list, with the declared friendly name (true catalog parity)", () => {
  const map = resolveModelMap(uncachedDir, profile);
  expect(map.opus).toEqual([{ provider: "newprov", model: "newprov-model-1", name: "New Provider Model", derived: false }]);
});

it("modelEnvPairs: emits ANTHROPIC_DEFAULT_<TIER>_MODEL for mapped tiers", () => {
  const pairs = modelEnvPairs(dir, profile);
  const keys = pairs.map((p) => p.key);
  expect(keys).toContain("ANTHROPIC_DEFAULT_OPUS_MODEL");
  expect(pairs.find((p) => p.key === "ANTHROPIC_DEFAULT_OPUS_MODEL")!.value).toBe("claude-opus-4-6-thinking");
});
