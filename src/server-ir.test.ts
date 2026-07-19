// SP-3 T1: proves the proxy server's IR front door end to end using core-ir's REAL
// AnthropicTranslator (not a mock) -- inbound Anthropic wire is decoded to the canonical IR,
// routed on IrRequest.model, handed to a handleIr-capable handler, and the IrResponse/IR event
// stream it returns is encoded back to Anthropic wire (JSON body / SSE). A legacy handle()-only
// handler must keep working unchanged via the fallback, even when the profile has a translator.
import { afterEach, beforeEach, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createProxyServer } from "./server.js";
import { HandleIrError } from "./types.js";
import { translators } from "../core-ir/dist/index.js";
import type { IrRequest, IrResponse, IrStreamEvent } from "../core-ir/dist/index.js";

const profile = {
  configFile: "claude-code-loader.json", routingKey: "providerRouting", tierSourceProvider: "claude-code",
  tierOrder: ["opus"], tierFallback: ["opus"], tierRegex: /^claude-([a-z]+)-\d/, envPrefix: "ANTHROPIC",
  defaultContext: 200000, defaultOutput: 64000,
  nativeRateLimit: async () => ({ status: 429, headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "error", error: { type: "rate_limit_error" } }) }),
  translator: translators.anthropic,
} as any;

const wireRequest = JSON.stringify({
  model: "claude-opus-4-1",
  max_tokens: 100,
  messages: [{ role: "user", content: "hi there" }],
  stream: false,
});

function fakeIrEventStream(events: IrStreamEvent[]): ReadableStream<IrStreamEvent> {
  return new ReadableStream({
    start(controller) {
      for (const e of events) controller.enqueue(e);
      controller.close();
    },
  });
}

let dir: string, srv: any, port: number;
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "cp-srv-ir-"));
  mkdirSync(join(dir, "config"), { recursive: true });
});
afterEach(async () => { await srv.close(); rmSync(dir, { recursive: true, force: true }); });

it("decodes app wire -> IR, routes, calls handleIr, and encodes the IrResponse back to app wire", async () => {
  writeFileSync(join(dir, "config", "claude-code-loader.json"), JSON.stringify({ modelMap: { opus: [{ provider: "ok", model: "m-ok" }] } }));
  const handlers: any = {
    ok: {
      handle: async () => { throw new Error("legacy handle() must not be called when the IR path is taken"); },
      handleIr: async (ir: IrRequest, ctx: any): Promise<IrResponse> => {
        const userText = (ir.messages[0]?.content[0] as any)?.text ?? "";
        return {
          id: "msg_echo",
          model: ctx.model,
          content: [{ kind: "text", text: "handled via IR: " + userText }],
          stopReason: "end_turn",
          usage: { inputTokens: 5, outputTokens: 5 },
        };
      },
    },
  };
  srv = createProxyServer({ configDir: dir, profile, port: 0, resolveHandler: async (n) => handlers[n] ?? null });
  port = await srv.listen();

  const r = await fetch(`http://127.0.0.1:${port}/v1/messages`, { method: "POST", body: wireRequest });
  expect(r.status).toBe(200);
  const wireBody = await r.text();
  const decoded = await translators.anthropic.decodeResponse(wireBody);
  expect(decoded.model).toBe("m-ok"); // ctx.model (the ASSIGNED model), matching legacy handle()'s contract
  expect(decoded.stopReason).toBe("end_turn");
  expect(decoded.content[0]).toMatchObject({ kind: "text", text: "handled via IR: hi there" });
});

it("streams: an IR event stream from handleIr is encoded to real Anthropic SSE, chunk by chunk", async () => {
  writeFileSync(join(dir, "config", "claude-code-loader.json"), JSON.stringify({ modelMap: { opus: [{ provider: "ok", model: "m-ok" }] } }));
  const handlers: any = {
    ok: {
      handle: async () => { throw new Error("legacy handle() must not be called when the IR path is taken"); },
      handleIr: async (): Promise<ReadableStream<IrStreamEvent>> =>
        fakeIrEventStream([
          { event: "message_start", id: "msg_1", model: "m-ok", role: "assistant", usage: { inputTokens: 3, outputTokens: 0 } },
          { event: "content_block_start", index: 0, blockKind: "text" },
          { event: "text_delta", index: 0, text: "hello" },
          { event: "text_delta", index: 0, text: " world" },
          { event: "content_block_stop", index: 0 },
          { event: "message_delta", stopReason: "end_turn", usage: { inputTokens: 3, outputTokens: 2 } },
          { event: "message_stop" },
        ]),
    },
  };
  srv = createProxyServer({ configDir: dir, profile, port: 0, resolveHandler: async (n) => handlers[n] ?? null });
  port = await srv.listen();

  const r = await fetch(`http://127.0.0.1:${port}/v1/messages`, {
    method: "POST",
    body: JSON.stringify({ model: "claude-opus-4-1", max_tokens: 100, messages: [{ role: "user", content: "hi" }], stream: true }),
  });
  expect(r.status).toBe(200);
  expect(r.headers.get("content-type")).toBe("text/event-stream");
  const sse = await r.text();
  expect(sse).toContain("event: message_start");
  expect(sse).toContain("event: content_block_delta");
  expect(sse).toContain("hello");
  expect(sse).toContain(" world");
  expect(sse).toContain("event: message_stop");
});

it("legacy handle()-only handler still serves via the fallback, even though the profile has a translator", async () => {
  writeFileSync(join(dir, "config", "claude-code-loader.json"), JSON.stringify({ modelMap: { opus: [{ provider: "legacy", model: "m-legacy" }] } }));
  const handlers: any = {
    legacy: { handle: async (_r: Request, ctx: any) => new Response("served " + ctx.model, { status: 200 }) },
  };
  srv = createProxyServer({ configDir: dir, profile, port: 0, resolveHandler: async (n) => handlers[n] ?? null });
  port = await srv.listen();

  const r = await fetch(`http://127.0.0.1:${port}/v1/messages`, { method: "POST", body: wireRequest });
  expect(r.status).toBe(200);
  // Untranslated, verbatim legacy body -- proves the "no handleIr" fallback served this request
  // rather than attempting (and failing) to encode a raw Response through the IR.
  expect(await r.text()).toBe("served m-legacy");
});

// T3c-1: a thrown HandleIrError must reconstruct a real Response and flow through the SAME
// isRateLimited/rateLimitResetMs/fallback/final-429-synthesis logic as a legacy handle() response,
// instead of collapsing to a flat 502 (which lost status fidelity and broke rate-limit fallback).
it("handleIr throwing a 429-typed HandleIrError triggers fallback, then synthesizes a final 429 once every entry is exhausted", async () => {
  writeFileSync(
    join(dir, "config", "claude-code-loader.json"),
    JSON.stringify({ modelMap: { opus: [{ provider: "primary", model: "m-primary" }, { provider: "fallback", model: "m-fallback" }] } })
  );
  const handlers: any = {
    primary: {
      handle: async () => { throw new Error("legacy handle() must not be called when the IR path is taken"); },
      handleIr: async () => { throw new HandleIrError({ status: 429, body: JSON.stringify({ type: "error" }), retryAfterMs: 5000 }); },
    },
    fallback: {
      handle: async () => { throw new Error("legacy handle() must not be called when the IR path is taken"); },
      handleIr: async () => { throw new HandleIrError({ status: 429, body: JSON.stringify({ type: "error" }) }); },
    },
  };
  srv = createProxyServer({ configDir: dir, profile, port: 0, resolveHandler: async (n) => handlers[n] ?? null });
  port = await srv.listen();

  const r = await fetch(`http://127.0.0.1:${port}/v1/messages`, { method: "POST", body: wireRequest });
  expect(r.status).toBe(429);
  // Body comes from profile.nativeRateLimit's final synthesis -- proves the fallback + final-429
  // path ran, not the flat 502 error shape.
  const body = await r.json();
  expect(body.error.type).toBe("rate_limit_error");
});

it("handleIr throwing a 400-typed HandleIrError surfaces verbatim, with no fallback attempted", async () => {
  writeFileSync(
    join(dir, "config", "claude-code-loader.json"),
    JSON.stringify({ modelMap: { opus: [{ provider: "primary", model: "m-primary" }, { provider: "fallback", model: "m-fallback" }] } })
  );
  let fallbackCalled = false;
  const handlers: any = {
    primary: {
      handle: async () => { throw new Error("legacy handle() must not be called when the IR path is taken"); },
      handleIr: async () => {
        throw new HandleIrError({ status: 400, body: JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "bad request" } }) });
      },
    },
    fallback: {
      handle: async () => { throw new Error("legacy handle() must not be called when the IR path is taken"); },
      handleIr: async () => { fallbackCalled = true; throw new Error("fallback must never be attempted for a non-rate-limit error"); },
    },
  };
  srv = createProxyServer({ configDir: dir, profile, port: 0, resolveHandler: async (n) => handlers[n] ?? null });
  port = await srv.listen();

  const r = await fetch(`http://127.0.0.1:${port}/v1/messages`, { method: "POST", body: wireRequest });
  expect(r.status).toBe(400);
  const body = await r.json();
  expect(body.error.type).toBe("invalid_request_error");
  expect(fallbackCalled).toBe(false);
});

it("handleIr throwing a plain non-typed error still collapses to a flat 502, unchanged", async () => {
  writeFileSync(join(dir, "config", "claude-code-loader.json"), JSON.stringify({ modelMap: { opus: [{ provider: "ok", model: "m-ok" }] } }));
  const handlers: any = {
    ok: {
      handle: async () => { throw new Error("legacy handle() must not be called when the IR path is taken"); },
      handleIr: async () => { throw new Error("boom"); },
    },
  };
  srv = createProxyServer({ configDir: dir, profile, port: 0, resolveHandler: async (n) => handlers[n] ?? null });
  port = await srv.listen();

  const r = await fetch(`http://127.0.0.1:${port}/v1/messages`, { method: "POST", body: wireRequest });
  expect(r.status).toBe(502);
  const body = await r.json();
  expect(body.error.type).toBe("loader_proxy_error");
});

// T3c-4: providers are esbuild-bundled independently, so a deployed provider throws its OWN inlined
// copy of HandleIrError -- `instanceof` against the front-door's copy would be false. The front-door
// must recognize the typed error by its stable `name` marker + transport shape, NOT by class identity,
// or the 429 fallback silently breaks in production. This simulates the foreign-copy throw.
it("recognizes a foreign-bundle HandleIrError (marker-shaped, not instanceof) and still falls back", async () => {
  writeFileSync(
    join(dir, "config", "claude-code-loader.json"),
    JSON.stringify({ modelMap: { opus: [{ provider: "primary", model: "m-primary" }, { provider: "fallback", model: "m-fallback" }] } })
  );
  // A plain object shaped exactly like a HandleIrError from another bundle: it is NOT an instance of
  // this bundle's HandleIrError class, but carries the same `name`/status/body contract.
  const foreign = Object.assign(new Error("handleIr transport error: 429"), {
    name: "HandleIrError",
    status: 429,
    body: JSON.stringify({ type: "error" }),
    retryAfterMs: 5000,
  });
  expect(foreign instanceof HandleIrError).toBe(false);
  const handlers: any = {
    primary: {
      handle: async () => { throw new Error("legacy handle() must not be called when the IR path is taken"); },
      handleIr: async () => { throw foreign; },
    },
    fallback: {
      handle: async () => { throw new Error("legacy handle() must not be called when the IR path is taken"); },
      handleIr: async () => { throw Object.assign(new Error("429"), { name: "HandleIrError", status: 429, body: JSON.stringify({ type: "error" }) }); },
    },
  };
  srv = createProxyServer({ configDir: dir, profile, port: 0, resolveHandler: async (n) => handlers[n] ?? null });
  port = await srv.listen();

  const r = await fetch(`http://127.0.0.1:${port}/v1/messages`, { method: "POST", body: wireRequest });
  expect(r.status).toBe(429);
  const body = await r.json();
  expect(body.error.type).toBe("rate_limit_error");
});

it("no translator on the profile never attempts the IR path, even for a handleIr-capable handler", async () => {
  const legacyProfile = { ...profile, translator: undefined };
  writeFileSync(join(dir, "config", "claude-code-loader.json"), JSON.stringify({ modelMap: { opus: [{ provider: "ok", model: "m-ok" }] } }));
  const handlers: any = {
    ok: {
      handle: async (_r: Request, ctx: any) => new Response("served " + ctx.model, { status: 200 }),
      handleIr: async () => { throw new Error("handleIr must never be called when the profile has no translator"); },
    },
  };
  srv = createProxyServer({ configDir: dir, profile: legacyProfile, port: 0, resolveHandler: async (n) => handlers[n] ?? null });
  port = await srv.listen();

  const r = await fetch(`http://127.0.0.1:${port}/v1/messages`, { method: "POST", body: wireRequest });
  expect(r.status).toBe(200);
  expect(await r.text()).toBe("served m-ok");
});
