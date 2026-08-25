import { expect, it } from "vitest";
import { initCoreProxy, getCoreProxy } from "../core-proxy-loader.js";
import type { CoreProxyJsStore } from "../generated/core-proxy.teavm.js";

function memStore(seed: Record<string, string>): CoreProxyJsStore {
  const entries: Record<string, string> = { ...seed };
  return {
    get: (key) => (key in entries ? entries[key] : null),
    put: (key, value) => { entries[key] = value; },
    exists: (key) => key in entries,
    delete: (key) => { delete entries[key]; },
    listKeys: (prefix) => Object.keys(entries).filter((key) => key.startsWith(prefix)),
  };
}

const REQUEST = JSON.stringify({
  method: "POST",
  url: "http://localhost:34567/v1/messages",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ model: "model-default-1", messages: [] }),
});

const STORE_SEED = {
  "models.json": JSON.stringify({
    test: { ranking: ["model-default-1"], models: { "model-default-1": { name: "Default One" } } },
  }),
};

it("routeJsonAsync suspends across a JS promise and resolves with the upstream response", async () => {
  await initCoreProxy();
  const core = getCoreProxy();

  const sent: string[] = [];
  const httpSend = async (requestJson: string) => {
    sent.push(requestJson);
    // A real delay is what proves the Java call chain suspended rather than ran to completion.
    await new Promise((resolve) => setTimeout(resolve, 10));
    return JSON.stringify({ status: 200, headers: {}, body: "upstream-said-hello" });
  };

  const result = await core.routeJsonAsync(httpSend, memStore(STORE_SEED), REQUEST);

  // A plain JS string, not a leaked jl_String wrapper: the promise settles through
  // JSString.valueOf, which is why routeJsonAsync builds its promise by hand.
  expect(typeof result).toBe("string");
  expect(JSON.parse(result)).toMatchObject({ status: 200, body: "upstream-said-hello" });
  expect(sent).toHaveLength(1);
  expect(JSON.parse(sent[0]).body).toContain("model-default-1");
});

it("a rejected httpSend surfaces as a routed 502, not as a rejected promise", async () => {
  await initCoreProxy();
  const core = getCoreProxy();

  const httpSend = async () => {
    throw new Error("upstream exploded");
  };

  const result = await core.routeJsonAsync(httpSend, memStore(STORE_SEED), REQUEST);

  // The rejection resumes the suspended Java call as a thrown exception, which Router's
  // per-handler guard converts into a response; the promise itself still resolves.
  const response = JSON.parse(result);
  expect(response.status).toBe(502);
  expect(JSON.parse(response.body).error.message).toContain("upstream exploded");
});
