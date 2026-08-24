import { expect, it } from "vitest";
import { decodeIr, encodeIrResult, handleIrErrorToResponse } from "./ir-codec.js";
import { makeFakeTranslator } from "./__tests__/fake-translator.js";
import type { IrResponse } from "@intisy-ai/core-ir";

const profile = { translator: makeFakeTranslator() } as any;
const wire = JSON.stringify({ model: "claude-x", max_tokens: 16, messages: [{ role: "user", content: "hi" }] });

it("decodeIr returns an IrRequest for a decodable body and null when the profile has no translator", async () => {
  const ir = await decodeIr(profile, new Request("http://x/v1/messages", { method: "POST", body: wire }), () => {});
  expect(ir?.model).toBe("claude-x");
  const none = await decodeIr({ translator: undefined } as any, new Request("http://x", { method: "POST", body: wire }), () => {});
  expect(none).toBeNull();
});

it("decodeIr returns null (never throws) on an undecodable body", async () => {
  const ir = await decodeIr(profile, new Request("http://x", { method: "POST", body: "<<<bad" }), () => {});
  expect(ir).toBeNull();
});

it("encodeIrResult encodes an IrResponse through the profile's translator as a JSON wire body", async () => {
  const irResponse: IrResponse = {
    id: "msg_1", model: "m-ok", content: [{ kind: "text", text: "hello" }],
    stopReason: "end_turn", usage: { inputTokens: 1, outputTokens: 1 },
  };
  const res = await encodeIrResult(profile, irResponse);
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toBe("application/json");
  const decoded = await profile.translator.decodeResponse(await res.text());
  expect(decoded.content[0]).toMatchObject({ kind: "text", text: "hello" });
});

it("handleIrErrorToResponse reconstructs a typed HandleIrError verbatim and surfaces retryAfterMs", () => {
  const foreign = Object.assign(new Error("429"), { name: "HandleIrError", status: 429, headers: { "retry-after": "5" }, body: "{}", retryAfterMs: 5000 });
  const res = handleIrErrorToResponse(foreign)!;
  expect(res.status).toBe(429);
  expect(res.headers.get("retry-after")).toBe("5");
  expect(res.headers.get("x-hub-retry-after-ms")).toBe("5000");
  expect(handleIrErrorToResponse(new Error("plain"))).toBeNull();
});
