// The always-on inbound proxy daemon. Routes each request to the {provider, model} chain assigned
// to its tier in the loader config, falling back through the chain on rate-limit and synthesizing a
// native 429 once every entry is exhausted, parameterized by ProxyOptions.

import { createServer, type Server } from "node:http";
import { Readable } from "node:stream";
import { initCoreProxy } from "./core-proxy-loader.js";
import { resolveModelMap, catalogEntries } from "./model-map.js";
import { isRateLimited, rateLimitResetMs, rateLimitFinal } from "./rate-limit.js";
import { decodeIr, encodeIrResult, handleIrErrorToResponse } from "./ir-codec.js";
import type { Assignment, CatalogEntry, Chain, ProxyOptions, ProxyServer, RoutingProfile } from "./types.js";

function errorResponse(status: number, message: string): Response {
  return new Response(JSON.stringify({ type: "error", error: { type: "loader_proxy_error", message } }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// The client validates its configured model ids against /v1/models. Provider-mapped ids do not
// exist upstream, so forwarding upstream 404s would leave the model picker stuck loading; serve
// the loader's own catalog instead, where every mapped id resolves.
function modelInfo(entry: CatalogEntry, profile: RoutingProfile): Record<string, unknown> {
  return {
    type: "model",
    id: entry.model,
    display_name: entry.name || entry.model,
    created_at: "2025-01-01T00:00:00Z",
    max_input_tokens: entry.limit?.context ?? profile.defaultContext,
    max_tokens: entry.limit?.output ?? profile.defaultOutput,
  };
}

function modelsResponse(url: URL, configDir: string, profile: RoutingProfile): Response {
  const json = (body: unknown, status?: number) =>
    new Response(JSON.stringify(body), { status: status || 200, headers: { "content-type": "application/json" } });
  const entries = catalogEntries(configDir).filter((e) => !/-auto$/.test(e.model));
  const id = decodeURIComponent(url.pathname.replace(/^\/v1\/models\/?/, ""));
  if (id) {
    const entry = entries.find((e) => e.model === id);
    if (!entry) return json({ type: "error", error: { type: "not_found_error", message: "model not found: " + id } }, 404);
    return json(modelInfo(entry, profile));
  }
  const seen = new Set<string>();
  const data: Record<string, unknown>[] = [];
  for (const entry of entries) {
    if (seen.has(entry.model)) continue; // same id may exist under several providers
    seen.add(entry.model);
    data.push(modelInfo(entry, profile));
  }
  return json({
    data,
    first_id: data.length ? (data[0] as { id: string }).id : null,
    last_id: data.length ? (data[data.length - 1] as { id: string }).id : null,
    has_more: false,
  });
}

// Classify a requested model into a mapping slot by tier keyword. Slots come from the resolved map
// (detected model families incl. new ones), nothing hardcoded here.
function slotForModel(model: string, map: Record<string, Chain>): string {
  const m = (model || "").toLowerCase();
  for (const slot of Object.keys(map)) {
    if (slot !== "default" && m.indexOf(slot) >= 0) return slot;
  }
  return "default";
}

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

  // The ordered chain [{provider, model}, ...] assigned to the request's tier (primary +
  // fallbacks). Stale/unset tiers auto-derive to the current catalog, so routing tracks a model
  // refresh even if never re-assigned.
  async function resolveAssignment(request: Request): Promise<Chain> {
    let requested = "";
    try { requested = ((await request.clone().json()) || {}).model || ""; } catch {}
    return resolveAssignmentForModel(requested);
  }

  // Same tier/model-map resolution as resolveAssignment, but the requested model is supplied
  // directly: the IR front door already decoded the body into an IrRequest and reads
  // IrRequest.model, the neutral field name shared by every vendor's IR, rather than re-parsing
  // vendor-specific wire JSON.
  async function resolveAssignmentForModel(requested: string): Promise<Chain> {
    const map = resolveModelMap(configDir, opts.profile);
    // Exact-id match first: the wrapper injects each tier's primary model id as an env var, so the
    // request model can be a backend id carrying no tier keyword; recover its tier by matching the
    // assigned ids before keyword classification.
    for (const slot of Object.keys(map)) {
      if ((map[slot] || []).some((e) => e.model === requested)) return map[slot];
    }
    const slot = slotForModel(requested, map);
    if (slot === "default" && requested) {
      // A model picked directly (e.g. via /model) that isn't in any tier chain must be served as
      // itself when a provider offers it; falling through to the default tier would silently
      // substitute a different model.
      const entry = catalogEntries(configDir).find((e) => e.model === requested && !/-auto$/.test(e.model));
      if (entry) return [{ provider: entry.provider, model: entry.model, name: entry.name, derived: false }];
      if (!opts.profile.nativeModelPattern?.test(requested)) {
        notify("Requested model '" + requested + "' is not in any provider catalog, serving the Default tier instead.");
        emitActivity({ topic: "proxy.status", action: "model_switched", impact: "notice", subject: { kind: "model", id: requested }, details: { servedTier: "Default" } });
      }
    }
    return (map[slot] && map[slot].length) ? map[slot] : (map.default || []);
  }

  async function route(request: Request): Promise<Response> {
    await initCoreProxy();
    const url = new URL(request.url);
    if (url.pathname === "/health") return new Response("ok", { status: 200 });
    if (url.pathname === "/v1/models" || url.pathname.startsWith("/v1/models/")) return modelsResponse(url, configDir, opts.profile);

    // Decode the inbound app-wire body into the canonical IR exactly once, when this profile has a
    // translator. A profile that never sets one stays on the wire handle() path below.
    const ir = await decodeIr(opts.profile, request, log);

    const chain = ir ? await resolveAssignmentForModel(ir.model || "") : await resolveAssignment(request);
    if (!chain.length) {
      return errorResponse(503, "No provider/model assigned for this tier. Run cc auth -> Providers.");
    }

    // The user must see substitutions: a healed primary means the stored mapping no longer matched
    // the catalog and routing re-derived it.
    if (chain[0] && chain[0].derived) {
      const healedMessage = "Model mapping healed: serving " + chain[0].provider + " · " + (chain[0].name || chain[0].model) +
        " (the stored model for this tier is no longer in the catalog).";
      notify(healedMessage, "info");
      emitActivity({ topic: "proxy.status", action: "route_healed", impact: "notice", details: { message: healedMessage } });
    }

    // Try the tier's models in order; advance to the next only when one is rate-limited, so a chain
    // stops only once every model in it is exhausted.
    let lastResp: Response | null = null;
    let resetMs = 0;
    for (let i = 0; i < chain.length; i++) {
      const assigned: Assignment = chain[i];
      let handler;
      try { handler = await opts.resolveHandler(assigned.provider); }
      catch (e) { log("handler load failed for " + assigned.provider + ": " + ((e as Error)?.message)); handler = null; }
      if (!handler || (typeof handler.handle !== "function" && typeof handler.handleIr !== "function")) {
        lastResp = errorResponse(503, "Provider '" + assigned.provider + "' has no proxy handler installed.");
        continue;
      }
      const ctx = { configDir, log, model: assigned.model, provider: assigned.provider };
      let resp: Response;
      // Prefer the IR path when both sides support it: this profile decoded an IR request and the
      // resolved handler exposes handleIr. A handler with no handleIr, or a profile with no
      // translator (ir === null), falls through to the handle() call below.
      if (ir && typeof handler.handleIr === "function") {
        try {
          const irResult = await handler.handleIr(ir, ctx);
          resp = await encodeIrResult(opts.profile, irResult);
        } catch (e) {
          const reconstructed = handleIrErrorToResponse(e);
          if (reconstructed) {
            resp = reconstructed;
          } else {
            log("handleIr error for " + assigned.provider + ": " + ((e as Error)?.message));
            lastResp = errorResponse(502, "Provider handler failed: " + ((e as Error)?.message));
            continue;
          }
        }
      } else if (typeof handler.handle === "function") {
        try {
          resp = await handler.handle(request, ctx);
        } catch (e) {
          log("handler error for " + assigned.provider + ": " + ((e as Error)?.message));
          lastResp = errorResponse(502, "Provider handler failed: " + ((e as Error)?.message));
          continue;
        }
      } else {
        // An IR-native handler (handleIr only) reached with no IR to run, because this profile
        // supplied no translator. There is no handle() to fall back to. A correctly-configured
        // app-proxy always pairs an IR-native provider with a translator, so this is a
        // misconfiguration, surfaced rather than crashing on undefined.
        lastResp = errorResponse(503, "Provider '" + assigned.provider + "' is IR-native but this profile has no translator to decode the request.");
        continue;
      }
      lastResp = resp;
      if (isRateLimited(resp)) {
        const ms = rateLimitResetMs(resp);
        if (ms > resetMs) resetMs = ms;
        log("rate-limited on " + assigned.provider + "/" + assigned.model + ", trying next fallback");
        continue;
      }
      // Never switch the user silently: announce when a fallback (not the primary) served.
      if (i > 0) {
        notify((chain[0].name || chain[0].model) + " rate-limited → served by " + (assigned.name || assigned.model));
        emitActivity({
          topic: "account.rate_limited",
          action: "rate_limit_fallback",
          impact: "warning",
          subject: { kind: "model", id: chain[0].name || chain[0].model },
          details: { servedBy: assigned.name || assigned.model },
        });
      }
      return resp; // success or a non-rate-limit error, surface it
    }

    // Every model in the chain was rate-limited (or unavailable): hand back a native 429 so the
    // client renders its own rate-limit UI, consistent across providers.
    if ((lastResp && lastResp.status === 429) || resetMs > Date.now()) {
      notify("All mapped models for this tier are rate-limited, request rejected with the earliest reset time.");
      emitActivity({ topic: "account.rate_limited", action: "rate_limited", impact: "warning", details: { resetMs } });
      return await rateLimitFinal(lastResp, resetMs, opts.profile);
    }
    return lastResp || errorResponse(503, "No provider handler available for this tier.");
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
