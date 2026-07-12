import { afterEach, beforeEach, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path"; import { tmpdir } from "node:os";
import { createProxyServer } from "./server.js";

const profile = {
  configFile: "claude-code-loader.json", routingKey: "providerRouting", tierSourceProvider: "claude-code",
  tierOrder: ["opus"], tierFallback: ["opus"], tierRegex: /^claude-([a-z]+)-\d/, envPrefix: "ANTHROPIC",
  defaultContext: 200000, defaultOutput: 64000,
  nativeRateLimit: async () => ({ status: 429, headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "error", error: { type: "rate_limit_error" } }) }),
} as any;

let dir: string, srv: any, port: number;
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "cp-srv-"));
  mkdirSync(join(dir, "config"), { recursive: true });
  writeFileSync(join(dir, "config", "claude-code-loader.json"), JSON.stringify({ modelMap: { opus: [{ provider: "rl", model: "m-rl" }, { provider: "ok", model: "m-ok" }] } }));
  const handlers: any = {
    rl: { handle: async () => new Response("", { status: 200, headers: { "x-hub-rate-limited": "1", "x-hub-retry-after-ms": "1000" } }) },
    ok: { handle: async (_r: Request, ctx: any) => new Response("served " + ctx.model, { status: 200 }) },
  };
  srv = createProxyServer({ configDir: dir, profile, port: 0, resolveHandler: async (n) => handlers[n] ?? null });
  port = await srv.listen();
});
afterEach(async () => { await srv.close(); rmSync(dir, { recursive: true, force: true }); });

it("health", async () => { expect(await (await fetch(`http://127.0.0.1:${port}/health`)).text()).toBe("ok"); });
it("falls back past a rate-limited provider to the next", async () => {
  const r = await fetch(`http://127.0.0.1:${port}/v1/messages`, { method: "POST", body: "{}" });
  expect(r.status).toBe(200);
  expect(await r.text()).toBe("served m-ok");
});
it("synthesizes a native 429 when all providers are rate-limited", async () => {
  writeFileSync(join(dir, "config", "claude-code-loader.json"), JSON.stringify({ modelMap: { opus: [{ provider: "rl", model: "m-rl" }] } }));
  const r = await fetch(`http://127.0.0.1:${port}/v1/messages`, { method: "POST", body: "{}" });
  expect(r.status).toBe(429);
  expect(await r.json()).toMatchObject({ error: { type: "rate_limit_error" } });
});

it("/v1/models falls back to the profile's default context/output when a catalog entry has no limit", async () => {
  // catalogEntries reads <configDir>/repos/<repo>/package.json for declared authProviders,
  // then prefers the cached models from config/models.json for that provider's model list.
  const repoDir = join(dir, "repos", "testprov-plugin");
  mkdirSync(repoDir, { recursive: true });
  writeFileSync(
    join(repoDir, "package.json"),
    JSON.stringify({ authProviders: [{ name: "testprov", models: [{ id: "test-model", name: "Test Model" }] }] })
  );
  writeFileSync(
    join(dir, "config", "models.json"),
    JSON.stringify({ testprov: { models: { "test-model": { name: "Test Model" } } } }) // deliberately no `limit`
  );
  const nonClaudeProfile = { ...profile, defaultContext: 128000, defaultOutput: 32000 };
  await srv.close();
  srv = createProxyServer({ configDir: dir, profile: nonClaudeProfile, port: 0, resolveHandler: async () => null });
  port = await srv.listen();

  const r = await fetch(`http://127.0.0.1:${port}/v1/models`);
  const body = await r.json();
  const entry = body.data.find((m: any) => m.id === "test-model");
  expect(entry).toBeTruthy();
  expect(entry.max_input_tokens).toBe(128000);
  expect(entry.max_tokens).toBe(32000);
});
