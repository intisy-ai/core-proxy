import { describe, expect, it } from "vitest";
import { initCoreProxy, getCoreProxy } from "../core-proxy-loader.js";
import type { CoreProxyJsStore } from "../generated/core-proxy.teavm.js";

/**
 * Exercises the production `routeRequest` export: the Java router driven entirely by host-supplied
 * seams, with no profile or provider synthesised in Java. The translator double stands in for a
 * vendor translator's transpiled string functions, which is the shape the real one already has.
 */

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

const CONFIG_FILE = "route-request-test.json";

const PROFILE = JSON.stringify({
  configFile: CONFIG_FILE,
  routingKey: "providerRouting",
  tierSourceProvider: "primary",
  tierOrder: ["opus"],
  tierFallback: ["opus"],
  tierRegex: "^claude-([a-z]+)-\\d",
  envPrefix: "ANTHROPIC",
  configDir: "/tmp/home",
  defaultContext: 200000,
  defaultOutput: 64000,
});

function storeSeed(...providers: string[]) {
  const models: Record<string, unknown> = {};
  const chain: unknown[] = [];
  for (const provider of providers) {
    models[provider] = { ranking: ["claude-opus-4"], models: { "claude-opus-4": { name: `${provider} opus` } } };
    chain.push({ provider, model: "claude-opus-4" });
  }
  return {
    "models.json": JSON.stringify(models),
    [CONFIG_FILE]: JSON.stringify({ providerRouting: { opus: chain } }),
  };
}

/** A translator whose entry points are string-in/string-out, as a transpiled vendor one is. */
function translatorDouble() {
  return {
    decodeRequest: (wireJson: string) => {
      const wire = JSON.parse(wireJson);
      return JSON.stringify({ model: wire.model, stream: !!wire.stream, messages: [] });
    },
    encodeRequest: (irJson: string) => irJson,
    decodeResponse: (wireJson: string) => wireJson,
    encodeResponse: (irResponseJson: string) => {
      const ir = JSON.parse(irResponseJson);
      return JSON.stringify({ model: ir.model, wire: "encoded" });
    },
    newStreamDecoder: () => ({ decode: (chunk: string) => JSON.stringify([]) }),
    newStreamEncoder: () => {
      let frame = 0;
      return { encode: (irEventJson: string) => `sse${frame++}:${JSON.parse(irEventJson).event}` };
    },
  };
}

type Deps = Parameters<ReturnType<typeof getCoreProxy>["routeRequest"]>[0];

function deps(overrides: Partial<Deps> & { emitted: string[]; closed: (string | null)[] }): Deps {
  const { emitted, closed, ...rest } = overrides;
  return {
    store: memStore(storeSeed("primary")),
    translator: translatorDouble(),
    resolveHandler: async () => null,
    notify: () => {},
    nativeRateLimit: async (infoJson: string) =>
      JSON.stringify({ status: 429, headers: { "x-hub-retry-after-ms": String(JSON.parse(infoJson).resetMs) }, body: "limited" }),
    event: () => {},
    emit: (frame: string) => { emitted.push(frame); },
    close: (error: string | null) => { closed.push(error ?? null); },
    providers: ["primary"],
    ...rest,
  } as Deps;
}

function request(stream: boolean, model = "claude-opus-4") {
  return JSON.stringify({
    method: "POST",
    url: "http://localhost:34567/v1/messages",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model, stream }),
  });
}

describe("routeRequest", () => {
  it("routes a buffered request through a host-supplied handler and translator", async () => {
    await initCoreProxy();
    const core = getCoreProxy();
    const emitted: string[] = [];
    const closed: (string | null)[] = [];
    const seenCtx: unknown[] = [];

    const result = JSON.parse(await core.routeRequest(deps({
      emitted,
      closed,
      resolveHandler: async (provider: string) => ({
        handleIr: async (irRequestJson: string, ctxJson: string) => {
          seenCtx.push(JSON.parse(ctxJson));
          return JSON.stringify({ id: "msg_1", model: JSON.parse(irRequestJson).model, content: [], stopReason: "end_turn" });
        },
      }),
    }), PROFILE, request(false)));

    expect(result.status).toBe(200);
    expect(result.streamed).toBe(false);
    expect(JSON.parse(result.body).wire).toBe("encoded");
    // The host's configDir and the resolved provider reach the handler's context.
    expect(seenCtx[0]).toMatchObject({ configDir: "/tmp/home", model: "claude-opus-4", handlerId: "primary" });
    // Nothing was streamed.
    expect(emitted).toEqual([]);
  });

  it("streams a request frame by frame into the host's sink", async () => {
    await initCoreProxy();
    const core = getCoreProxy();
    const emitted: string[] = [];
    const closed: (string | null)[] = [];

    const result = JSON.parse(await core.routeRequest(deps({
      emitted,
      closed,
      resolveHandler: async () => ({
        handleIr: async () => { throw new Error("should not be called for a stream"); },
        handleIrStream: () => {
          const events = [
            { event: "text_delta", index: 0, text: "Hel" },
            { event: "text_delta", index: 0, text: "lo" },
            { event: "message_stop" },
          ];
          let cursor = 0;
          return {
            next: async () => {
              await new Promise((r) => setTimeout(r, 2));
              return cursor < events.length ? JSON.stringify(events[cursor++]) : null;
            },
          };
        },
      }),
    }), PROFILE, request(true)));

    expect(result.status).toBe(200);
    expect(result.streamed).toBe(true);
    expect(result.headers["content-type"]).toBe("text/event-stream");
    expect(emitted).toEqual(["sse0:text_delta", "sse1:text_delta", "sse2:message_stop"]);
    expect(closed).toEqual([null]);
    expect(result.streamError).toBeUndefined();
  });

  it("advances the chain when a streamed provider rejects before its first event", async () => {
    await initCoreProxy();
    const core = getCoreProxy();
    const emitted: string[] = [];
    const closed: (string | null)[] = [];

    const result = JSON.parse(await core.routeRequest(deps({
      emitted,
      closed,
      store: memStore(storeSeed("limited", "primary")),
      providers: ["limited", "primary"],
      resolveHandler: async (provider: string) =>
        provider === "limited"
          ? {
              handleIr: async () => { throw new Error("stream only"); },
              handleIrStream: () => ({
                next: async () => {
                  // The typed marker the front door duck-types, since class identity does not
                  // survive an independently bundled provider.
                  const error: Record<string, unknown> = new Error("rate limited");
                  error.name = "HandleIrError";
                  error.status = 429;
                  error.headers = { "retry-after": "1" };
                  error.body = "{\"error\":\"limited\"}";
                  error.retryAfterMs = 1000;
                  throw error;
                },
              }),
            }
          : {
              handleIr: async () => { throw new Error("stream only"); },
              handleIrStream: () => {
                let done = false;
                return {
                  next: async () => {
                    if (done) return null;
                    done = true;
                    return JSON.stringify({ event: "text_delta", index: 0, text: "served" });
                  },
                };
              },
            },
    }), PROFILE, request(true)));

    // The 429 arrived before any frame, so the fallback served and its frames are what went out.
    expect(result.status).toBe(200);
    expect(emitted).toEqual(["sse0:text_delta"]);
    expect(closed).toEqual([null]);
  });

  it("reports a mid-stream failure as streamError, the status line being already sent", async () => {
    await initCoreProxy();
    const core = getCoreProxy();
    const emitted: string[] = [];
    const closed: (string | null)[] = [];

    const result = JSON.parse(await core.routeRequest(deps({
      emitted,
      closed,
      resolveHandler: async () => ({
        handleIr: async () => { throw new Error("stream only"); },
        handleIrStream: () => {
          let pulls = 0;
          return {
            next: async () => {
              if (pulls++ === 0) return JSON.stringify({ event: "text_delta", index: 0, text: "partial" });
              throw new Error("upstream died mid-stream");
            },
          };
        },
      }),
    }), PROFILE, request(true)));

    expect(result.status).toBe(200);
    expect(emitted).toEqual(["sse0:text_delta"]);
    expect(result.streamError).toContain("upstream died mid-stream");
    expect(closed[0]).toContain("upstream died mid-stream");
  });

  it("serves a wire-only handler, which has no IR path at all", async () => {
    await initCoreProxy();
    const core = getCoreProxy();
    const emitted: string[] = [];
    const closed: (string | null)[] = [];

    const result = JSON.parse(await core.routeRequest(deps({
      emitted,
      closed,
      resolveHandler: async () => ({
        handle: async (requestJson: string, ctxJson: string) =>
          JSON.stringify({ status: 200, headers: {}, body: "wire served " + JSON.parse(ctxJson).model }),
      }) as never,
    }), PROFILE, request(false)));

    expect(result.status).toBe(200);
    expect(result.body).toBe("wire served claude-opus-4");
  });

  it("prefers the IR path when a handler serves both", async () => {
    await initCoreProxy();
    const core = getCoreProxy();
    const emitted: string[] = [];
    const closed: (string | null)[] = [];

    const result = JSON.parse(await core.routeRequest(deps({
      emitted,
      closed,
      resolveHandler: async () => ({
        handleIr: async (irRequestJson: string) =>
          JSON.stringify({ id: "msg_1", model: JSON.parse(irRequestJson).model, content: [], stopReason: "end_turn" }),
        handle: async () => { throw new Error("the wire path must not be taken when IR is available"); },
      }) as never,
    }), PROFILE, request(false)));

    expect(result.status).toBe(200);
    expect(JSON.parse(result.body).wire).toBe("encoded");
  });

  it("passes the upstream's headers and body to the native rate-limit builder", async () => {
    await initCoreProxy();
    const core = getCoreProxy();
    const emitted: string[] = [];
    const closed: (string | null)[] = [];
    const seenInfo: Record<string, unknown>[] = [];

    const result = JSON.parse(await core.routeRequest(deps({
      emitted,
      closed,
      nativeRateLimit: async (infoJson: string) => {
        seenInfo.push(JSON.parse(infoJson));
        return JSON.stringify({ status: 429, headers: { "content-type": "application/json" }, body: "synthesized" });
      },
      resolveHandler: async () => ({
        handleIr: async () => {
          const error: Record<string, unknown> = new Error("rate limited");
          error.name = "HandleIrError";
          error.status = 429;
          error.headers = { "retry-after": "3", "x-upstream": "yes" };
          error.body = "upstream said no";
          error.retryAfterMs = 3000;
          throw error;
        },
      }) as never,
    }), PROFILE, request(false)));

    expect(result.status).toBe(429);
    expect(result.body).toBe("synthesized");
    // Enough for a profile whose native shape is the upstream's own response passed through.
    expect(seenInfo[0]).toMatchObject({ upstreamStatus: 429, upstreamBody: "upstream said no" });
    expect((seenInfo[0].upstreamHeaders as Record<string, string>)["x-upstream"]).toBe("yes");
    expect(typeof seenInfo[0].now).toBe("number");
  });

  it("reports a provider with no handler installed", async () => {
    await initCoreProxy();
    const core = getCoreProxy();
    const emitted: string[] = [];
    const closed: (string | null)[] = [];

    const result = JSON.parse(await core.routeRequest(
      deps({ emitted, closed, resolveHandler: async () => null }), PROFILE, request(false)));

    expect(result.status).toBe(503);
    expect(result.body).toContain("no proxy handler installed");
  });

  it("serves the /v1/models catalog from the host's store", async () => {
    await initCoreProxy();
    const core = getCoreProxy();
    const emitted: string[] = [];
    const closed: (string | null)[] = [];

    const result = JSON.parse(await core.routeRequest(deps({ emitted, closed }), PROFILE, JSON.stringify({
      method: "GET",
      url: "http://localhost:34567/v1/models",
      headers: {},
      body: "",
    })));

    expect(result.status).toBe(200);
    expect(result.body).toContain("claude-opus-4");
  });
});
