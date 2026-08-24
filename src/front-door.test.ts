import { describe, expect, it } from "vitest";
import { frontDoor } from "./front-door.js";
import { HandleIrError } from "./types.js";
import type { RoutingProfile } from "./types.js";

function profileWith(translator: RoutingProfile["translator"]): RoutingProfile {
  return {
    configFile: "test.json",
    routingKey: "routing",
    tierSourceProvider: "test",
    tierOrder: [],
    tierFallback: [],
    tierRegex: /never/,
    envPrefix: "TEST_",
    defaultContext: 1,
    defaultOutput: 1,
    nativeRateLimit: async () => ({ status: 429, headers: {}, body: "" }),
    translator,
  };
}

const translator = {
  decodeRequest: async (body: string) => JSON.parse(body),
  encodeResponse: async (ir: unknown) => JSON.stringify(ir),
  encodeStream: async () => new TransformStream<unknown, string>(),
} as unknown as RoutingProfile["translator"];

describe("frontDoor", () => {
  it("decodes an app request into IR through the profile's translator", async () => {
    const request = new Request("http://127.0.0.1/v1/messages", { method: "POST", body: '{"model":"m"}' });
    await expect(frontDoor(profileWith(translator)).decode(request as never)).resolves.toEqual({ model: "m" });
  });

  it("answers null for a profile with no translator, so a wire-only profile is not an error", async () => {
    const request = new Request("http://127.0.0.1/v1/messages", { method: "POST", body: '{"model":"m"}' });
    await expect(frontDoor(profileWith(undefined)).decode(request as never)).resolves.toBeNull();
  });

  it("answers null for a body that is not this app's wire format", async () => {
    const request = new Request("http://127.0.0.1/v1/messages", { method: "POST", body: "not json" });
    await expect(frontDoor(profileWith(translator)).decode(request as never)).resolves.toBeNull();
  });

  it("encodes an IR response back to the app's wire format", async () => {
    const response = await frontDoor(profileWith(translator)).encode({ id: "one" } as never);
    expect(response.status).toBe(200);
    expect(await (response as unknown as Response).text()).toBe('{"id":"one"}');
  });

  it("rebuilds a wire response from a thrown handler error, carrying its status and body", () => {
    const rebuilt = frontDoor(profileWith(translator)).encodeError(
      new HandleIrError({ status: 429, body: "slow down", retryAfterMs: 1000 }),
    ) as unknown as Response | null;
    expect(rebuilt?.status).toBe(429);
    expect(rebuilt?.headers.get("x-hub-retry-after-ms")).toBe("1000");
  });

  it("answers null for a throw that is not a handler error, so a real failure stays a failure", () => {
    expect(frontDoor(profileWith(translator)).encodeError(new Error("boom"))).toBeNull();
  });
});
