import { expect, it } from "vitest";
import { serveIr } from "./serve-ir.js";
import { makeFakeTranslator } from "./__tests__/fake-translator.js";
import type { IrRequest, IrResponse, IrStreamEvent } from "@intisy-ai/core-ir";

const profile = { translator: makeFakeTranslator() } as any;
const ctx = { configDir: "/tmp", log: () => {}, model: "m-ok", provider: "p" } as any;
const wire = JSON.stringify({ model: "claude-x", max_tokens: 16, messages: [{ role: "user", content: [{ kind: "text", text: "hi there" }] }] });
const req = () => new Request("http://x/v1/messages", { method: "POST", body: wire });

it("decodes wire -> IR, calls handleIr, encodes the IrResponse back to wire", async () => {
  let seen: IrRequest | null = null;
  const handleIr = async (ir: IrRequest): Promise<IrResponse> => {
    seen = ir;
    const text = (ir.messages[0]?.content[0] as any)?.text ?? "";
    return { id: "msg_1", model: "m-ok", content: [{ kind: "text", text: "via IR: " + text }], stopReason: "end_turn", usage: { inputTokens: 1, outputTokens: 1 } };
  };
  const res = await serveIr(req(), { profile, handleIr, ctx });
  expect(res.status).toBe(200);
  expect(seen!.model).toBe("claude-x");
  const decoded = await profile.translator.decodeResponse(await res.text());
  expect(decoded.content[0]).toMatchObject({ kind: "text", text: "via IR: hi there" });
});

it("encodes an IR event stream to wire text through the translator's encodeStream", async () => {
  const handleIr = async (): Promise<ReadableStream<IrStreamEvent>> => new ReadableStream({
    start(c) {
      for (const e of [
        { event: "message_start", id: "msg_1", model: "m-ok", role: "assistant", usage: { inputTokens: 1, outputTokens: 0 } },
        { event: "content_block_start", index: 0, blockKind: "text" },
        { event: "text_delta", index: 0, text: "hello" },
        { event: "content_block_stop", index: 0 },
        { event: "message_delta", stopReason: "end_turn", usage: { inputTokens: 1, outputTokens: 1 } },
        { event: "message_stop" },
      ] as IrStreamEvent[]) c.enqueue(e);
      c.close();
    },
  });
  const res = await serveIr(req(), { profile, handleIr, ctx });
  expect(res.headers.get("content-type")).toBe("text/event-stream");
  const body = await res.text();
  expect(body).toContain('"event":"message_start"');
  expect(body).toContain("hello");
  expect(body).toContain('"event":"message_stop"');
});

it("reconstructs a thrown typed HandleIrError verbatim", async () => {
  const handleIr = async (): Promise<IrResponse> => {
    throw Object.assign(new Error("429"), { name: "HandleIrError", status: 429, headers: { "retry-after": "5", "content-type": "application/json" }, body: JSON.stringify({ error: { type: "rate_limit_error" } }) });
  };
  const res = await serveIr(req(), { profile, handleIr, ctx });
  expect(res.status).toBe(429);
  expect(res.headers.get("retry-after")).toBe("5");
  expect((await res.json()).error.type).toBe("rate_limit_error");
});

it("returns 400 for an undecodable body (a pure-IR provider has no wire fallback)", async () => {
  let called = false;
  const handleIr = async (): Promise<IrResponse> => { called = true; throw new Error("must not run"); };
  const res = await serveIr(new Request("http://x", { method: "POST", body: "<<<bad" }), { profile, handleIr, ctx });
  expect(res.status).toBe(400);
  expect(called).toBe(false);
  expect((await res.json()).error.type).toBe("invalid_request_error");
});

it("rethrows a non-typed error (a genuine bug, not a modeled transport outcome)", async () => {
  const handleIr = async (): Promise<IrResponse> => { throw new Error("boom"); };
  await expect(serveIr(req(), { profile, handleIr, ctx })).rejects.toThrow("boom");
});
