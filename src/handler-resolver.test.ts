import { afterEach, beforeEach, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { makeDynamicResolver } from "./handler-resolver.js";

let dir: string, handlerPath: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cp-hr-"));
  handlerPath = join(dir, "handler.mjs");
  writeFileSync(handlerPath, `export async function handle(req, ctx){ return new Response("hi "+ctx.model, {status:200}); }`);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

it("resolves + invokes a provider handler; null for unknown", async () => {
  const resolve = makeDynamicResolver(() => [{ provider: "demo", handlerPath }]);
  const mod = await resolve("demo");
  expect(mod).not.toBeNull();
  const r = await mod!.handle(new Request("http://x/v1/messages"), { configDir: dir, log: () => {}, model: "m1" });
  expect(await r.text()).toBe("hi m1");
  expect(await resolve("nope")).toBeNull();
});
