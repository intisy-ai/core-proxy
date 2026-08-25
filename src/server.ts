// The always-on inbound proxy daemon. Routes each request to the {provider, model} chain assigned
// to its tier in the loader config, falling back through the chain on rate-limit and synthesizing a
// native 429 once every entry is exhausted, parameterized by ProxyOptions.

import { createServer, type Server } from "node:http";
import { Readable } from "node:stream";
import { initCoreProxy, getCoreProxy } from "./core-proxy-loader.js";
import { catalogEntries } from "./model-map.js";
import { profileJson, requestJson, routeDeps, type RoutedResult } from "./java-route.js";
import type { ProxyOptions, ProxyServer } from "./types.js";
export function createProxyServer(opts: ProxyOptions): ProxyServer {
  const configDir = opts.configDir;
  const port = opts.port ?? 34567;
  const log = opts.log ?? (() => {});

  // User-visible, non-intrusive notice that the request was routed to a different
  // model/provider than asked for. The host owns delivery: it injects opts.notify to
  // put the message on the shared event bus (the loader's drain surfaces it to the
  // user). Identical messages are throttled so a burst of fallbacks notifies once.
  const NOTIFY_INTERVAL_MS = 60000;
  const lastNotified: Record<string, number> = {};
  const notify = (message: string, level?: string) => {
    const now = Date.now();
    if (lastNotified[message] && now - lastNotified[message] < NOTIFY_INTERVAL_MS) return;
    lastNotified[message] = now;
    log("notify: " + message);
    try { opts.notify?.(message, level); } catch {}
  };

  // Best-effort Activity emit alongside notify, for hosts that inject an Activity emitter instead
  // of (or in addition to) a plain notification string. Never breaks the request path.
  const emitActivity = (spec: { topic: string; action: string; actor?: string; impact?: string; subject?: any; details?: any }) => {
    try { opts.emitActivity?.(spec); } catch {}
  };

  // The routing engine is Router.java: this builds the seams it asks for, hands it the request, and
  // turns its outcome back into a web Response. A streamed body is written to the stream below as
  // Java pushes each already-encoded frame, so nothing is buffered on the way out.
  async function route(request: Request): Promise<Response> {
    await initCoreProxy();
    const core = getCoreProxy();

    let wantsStream = false;
    try {
      wantsStream = ((await request.clone().json()) as { stream?: unknown })?.stream === true;
    } catch {}

    let frames: ReadableStreamDefaultController<string> | null = null;
    let closed = false;
    const body = new ReadableStream<string>({ start(controller) { frames = controller; } });
    const closeFrames = (error: string | null) => {
      if (closed || !frames) return;
      closed = true;
      if (error) frames.error(new Error(error));
      else frames.close();
    };

    const deps = await routeDeps({
      configDir,
      profile: opts.profile,
      log,
      notify,
      emitActivity,
      resolveHandler: opts.resolveHandler,
      listProviders: () => catalogEntries(configDir).map((entry) => entry.provider),
      wantsStream,
      emit: (frame) => frames?.enqueue(frame),
      close: closeFrames,
    });

    const routed = JSON.parse(
      await core.routeRequest(deps, profileJson(opts.profile, configDir), await requestJson(request)),
    ) as RoutedResult;

    if (routed.streamed) {
      if (routed.streamError) log("stream ended early: " + routed.streamError);
      closeFrames(null);
      return new Response(body.pipeThrough(new TextEncoderStream()), {
        status: routed.status,
        headers: routed.headers,
      });
    }
    closeFrames(null);
    return new Response(routed.body ?? "", { status: routed.status, headers: routed.headers });
  }


  // Node http server that adapts a node req to a web Request and a web Response to a node res, so
  // the routing/handler contract (web Request in, web Response out) stays identical while the daemon
  // runs under Node.
  const server: Server = createServer((nodeReq, nodeRes) => {
    const method = (nodeReq.method || "GET").toUpperCase();
    const skipBody = method === "GET" || method === "HEAD";
    const chunks: Buffer[] = [];
    nodeReq.on("data", (chunk: Buffer) => { chunks.push(chunk); });
    nodeReq.on("end", async () => {
      try {
        const bodyBuffer = skipBody ? undefined : Buffer.concat(chunks);
        const webReq = new Request("http://127.0.0.1:" + port + nodeReq.url, {
          method,
          headers: nodeReq.headers as HeadersInit,
          body: skipBody ? undefined : bodyBuffer,
          duplex: "half",
        } as RequestInit);
        const webRes = await route(webReq);
        // undici's fetch (used by provider handlers) transparently decompresses the upstream body
        // but leaves content-encoding/content-length in place. Forwarding those onto the
        // already-decoded body makes the client try to gunzip plain text. Strip both; Node
        // re-chunks the body.
        const outHeaders = Object.fromEntries(webRes.headers);
        delete outHeaders["content-encoding"];
        delete outHeaders["content-length"];
        nodeRes.writeHead(webRes.status, outHeaders);
        if (webRes.body) {
          // SSE / streaming responses must pipe (never buffer) so streaming works.
          Readable.fromWeb(webRes.body as any).pipe(nodeRes);
        } else {
          nodeRes.end(Buffer.from(await webRes.arrayBuffer()));
        }
      } catch (e) {
        nodeRes.writeHead(502, { "content-type": "application/json" });
        nodeRes.end(JSON.stringify({ type: "error", error: { message: String((e as Error)?.message || e) } }));
      }
    });
  });

  return {
    listen: () =>
      new Promise<number>((resolve) => {
        server.listen(port, "127.0.0.1", () => {
          const addr = server.address();
          resolve(typeof addr === "object" && addr ? addr.port : port);
        });
      }),
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
