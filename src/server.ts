// The always-on inbound proxy daemon. Routes each request to the {provider, model}
// chain assigned to its tier in the loader config, falling back through the chain on
// rate-limit and synthesizing a native 429 once every entry is exhausted.
// (Ports claude-code-loader/src/proxy.ts:203-260 plus its route/resolveAssignment/
// claudeSlot/modelInfo/modelsResponse/errorResponse/notifyUser/log helpers and the
// node<->web createServer adapter, parameterized by ProxyOptions.)

import { existsSync, mkdirSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { createServer, type Server } from "node:http";
import { Readable } from "node:stream";
import { resolveModelMap, catalogEntries } from "./model-map.js";
import { isRateLimited, rateLimitResetMs, rateLimitFinal } from "./rate-limit.js";
import { HandleIrError } from "./types.js";
import type { Assignment, CatalogEntry, Chain, IrEventStream, IrRequest, IrResponse, ProxyOptions, ProxyServer, RoutingProfile } from "./types.js";

function errorResponse(status: number, message: string): Response {
  return new Response(JSON.stringify({ type: "error", error: { type: "loader_proxy_error", message } }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// Claude Code validates its custom ANTHROPIC_DEFAULT_*_MODEL / ANTHROPIC_MODEL ids
// against /v1/models. Provider-mapped ids don't exist at Anthropic, so forwarding
// upstream 404s would show the /model picker stuck loading. Serve the loader's own
// catalog instead — every mapped id resolves.
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

// Classify a requested model into a mapping slot by tier keyword. Slots come from the
// resolved map (detected Claude families incl. new ones) — nothing hardcoded here.
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

  // User-visible, non-intrusive notice: append to core-auth's notification queue,
  // which the loader's PostToolUse hook drains into a systemMessage. The user must
  // never be silently switched to a different model/provider than requested.
  const NOTIFY_INTERVAL_MS = 60000;
  const lastNotified: Record<string, number> = {};
  const defaultNotify = (message: string, level?: string) => {
    try {
      const now = Date.now();
      if (lastNotified[message] && now - lastNotified[message] < NOTIFY_INTERVAL_MS) return;
      lastNotified[message] = now;
      const dir = join(configDir, "cache");
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      appendFileSync(join(dir, "auth-notifications.jsonl"), JSON.stringify({ message, level: level || "warning", at: now }) + "\n");
      log("notify: " + message);
    } catch {}
  };
  const notify = opts.notify ?? defaultNotify;

  // The ORDERED CHAIN [{provider, model}, ...] assigned to the request's tier
  // (primary + fallbacks). Healed: stale/unset tiers auto-derive to the current
  // catalog, so routing tracks a model refresh even if never re-assigned.
  async function resolveAssignment(request: Request): Promise<Chain> {
    let requested = "";
    try { requested = ((await request.clone().json()) || {}).model || ""; } catch {}
    return resolveAssignmentForModel(requested);
  }

  // SP-3: same tier/model-map resolution as resolveAssignment above, but the requested model is
  // supplied directly instead of being parsed out of the raw wire body — the IR front door already
  // decoded the body into an IrRequest and reads IrRequest.model, the neutral field name shared by
  // every vendor's IR, instead of re-parsing vendor-specific wire JSON here.
  async function resolveAssignmentForModel(requested: string): Promise<Chain> {
    const map = resolveModelMap(configDir, opts.profile);
    // Exact-id match first: the wrapper injects each tier's primary model id as an
    // env var, so the request model can be a backend id carrying no tier keyword —
    // recover its tier by matching the assigned ids before keyword classification.
    for (const slot of Object.keys(map)) {
      if ((map[slot] || []).some((e) => e.model === requested)) return map[slot];
    }
    const slot = slotForModel(requested, map);
    if (slot === "default" && requested) {
      // A model picked DIRECTLY (e.g. via /model) that isn't in any tier chain must
      // be served as itself when a provider offers it — falling through to the
      // default tier would silently substitute a different model.
      const entry = catalogEntries(configDir).find((e) => e.model === requested && !/-auto$/.test(e.model));
      if (entry) return [{ provider: entry.provider, model: entry.model, name: entry.name, derived: false }];
      if (!opts.profile.nativeModelPattern?.test(requested)) {
        notify("Requested model '" + requested + "' is not in any provider catalog — serving the Default tier instead.");
      }
    }
    return (map[slot] && map[slot].length) ? map[slot] : (map.default || []);
  }

  // Decodes the inbound app-wire body into the canonical IR via this profile's translator, when
  // one is configured. Returns null (never throws) when there is no translator, no body, or the
  // decode itself fails — any of those means "use the legacy path", not "fail the request".
  async function decodeIr(request: Request): Promise<IrRequest | null> {
    if (!opts.profile.translator) return null;
    try {
      const bodyText = await request.clone().text();
      if (!bodyText) return null;
      return await opts.profile.translator.decodeRequest(bodyText);
    } catch (e) {
      log("IR decode failed, falling back to legacy routing: " + ((e as Error)?.message));
      return null;
    }
  }

  // Encodes an IR-native handler's result back to the app's wire format via this profile's
  // translator: a non-streaming IrResponse becomes one JSON body; an IrEventStream (true
  // streaming — canonical IR events produced directly by the provider, never buffered) is piped
  // through the translator's stateful encoder to the vendor's SSE text, then to bytes.
  async function encodeIrResult(irResult: IrResponse | IrEventStream): Promise<Response> {
    const translator = opts.profile.translator!;
    if (irResult instanceof ReadableStream) {
      const encodeStream = await translator.encodeStream();
      const byteStream = irResult.pipeThrough(encodeStream).pipeThrough(new TextEncoderStream());
      return new Response(byteStream, { status: 200, headers: { "content-type": "text/event-stream" } });
    }
    const wire = await translator.encodeResponse(irResult);
    return new Response(wire, { status: 200, headers: { "content-type": "application/json" } });
  }

  async function route(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health") return new Response("ok", { status: 200 });
    if (url.pathname === "/v1/models" || url.pathname.startsWith("/v1/models/")) return modelsResponse(url, configDir, opts.profile);

    // SP-3 front-door: decode the inbound app-wire body into the canonical IR exactly once, when
    // this profile has a translator (anthropicProfile/opencodeProfile do; a profile that never
    // sets one stays on the legacy path below, unchanged).
    const ir = await decodeIr(request);

    const chain = ir ? await resolveAssignmentForModel(ir.model || "") : await resolveAssignment(request);
    if (!chain.length) {
      return errorResponse(503, "No provider/model assigned for this tier. Run cc auth -> Providers.");
    }

    // The user must SEE substitutions: a healed primary means the stored mapping no
    // longer matched the catalog and routing re-derived it.
    if (chain[0] && chain[0].derived) {
      notify(
        "Model mapping healed: serving " + chain[0].provider + " · " + (chain[0].name || chain[0].model) +
          " (the stored model for this tier is no longer in the catalog).",
        "info"
      );
    }

    // Try the tier's models in order; advance to the next only when one is
    // rate-limited, so a chain stops only once EVERY model in it is exhausted.
    let lastResp: Response | null = null;
    let resetMs = 0;
    for (let i = 0; i < chain.length; i++) {
      const assigned: Assignment = chain[i];
      let handler;
      try { handler = await opts.resolveHandler(assigned.provider); }
      catch (e) { log("handler load failed for " + assigned.provider + ": " + ((e as Error)?.message)); handler = null; }
      if (!handler || typeof handler.handle !== "function") {
        lastResp = errorResponse(503, "Provider '" + assigned.provider + "' has no proxy handler installed.");
        continue;
      }
      const ctx = { configDir, log, model: assigned.model };
      let resp: Response;
      // Prefer the IR path when both sides support it: this profile decoded an IR request AND the
      // resolved handler exposes handleIr. A legacy handler (no handleIr) or a profile with no
      // translator (ir === null) simply falls through to the ORIGINAL handle() call below, so
      // nothing breaks mid-migration (coexist-then-remove).
      if (ir && typeof handler.handleIr === "function") {
        try {
          const irResult = await handler.handleIr(ir, ctx);
          resp = await encodeIrResult(irResult);
        } catch (e) {
          if (e instanceof HandleIrError) {
            // A typed transport error carries the provider's real HTTP status/headers/body --
            // reconstruct it as a Response so it flows through the SAME isRateLimited/
            // rateLimitResetMs/fallback logic below as a legacy handler's Response would,
            // restoring status fidelity (e.g. 429 fallback, verbatim 400) on the IR path.
            const headers = new Headers(e.headers);
            if (e.retryAfterMs != null && !headers.has("x-hub-retry-after-ms")) {
              headers.set("x-hub-retry-after-ms", String(e.retryAfterMs));
            }
            resp = new Response(e.body, { status: e.status, headers });
          } else {
            // Unexpected/non-typed throw -- a genuine bug, not a modeled transport outcome.
            log("handleIr error for " + assigned.provider + ": " + ((e as Error)?.message));
            lastResp = errorResponse(502, "Provider handler failed: " + ((e as Error)?.message));
            continue;
          }
        }
      } else {
        try {
          resp = await handler.handle(request, ctx);
        } catch (e) {
          log("handler error for " + assigned.provider + ": " + ((e as Error)?.message));
          lastResp = errorResponse(502, "Provider handler failed: " + ((e as Error)?.message));
          continue;
        }
      }
      lastResp = resp;
      if (isRateLimited(resp)) {
        const ms = rateLimitResetMs(resp);
        if (ms > resetMs) resetMs = ms;
        log("rate-limited on " + assigned.provider + "/" + assigned.model + " — trying next fallback");
        continue;
      }
      // Never switch the user silently: announce when a fallback (not the primary) served.
      if (i > 0) {
        notify((chain[0].name || chain[0].model) + " rate-limited → served by " + (assigned.name || assigned.model));
      }
      return resp; // success or a non-rate-limit error — surface it
    }

    // Every model in the chain was rate-limited (or unavailable) — hand back a native
    // 429 so the client renders its own rate-limit UI, consistent across providers.
    if ((lastResp && lastResp.status === 429) || resetMs > Date.now()) {
      notify("All mapped models for this tier are rate-limited — request rejected with the earliest reset time.");
      return await rateLimitFinal(lastResp, resetMs, opts.profile);
    }
    return lastResp || errorResponse(503, "No provider handler available for this tier.");
  }

  // Node http server that adapts a node req -> web Request and a web Response ->
  // node res, so the routing/handler contract (web Request in, web Response out)
  // stays identical while the daemon runs under Node.
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
        // undici's fetch (used by provider handlers) transparently DECOMPRESSES the
        // upstream body but leaves content-encoding/content-length in place.
        // Forwarding those onto the already-decoded body makes the client try to
        // gunzip plain text. Strip both; Node re-chunks the body.
        const outHeaders = Object.fromEntries(webRes.headers);
        delete outHeaders["content-encoding"];
        delete outHeaders["content-length"];
        nodeRes.writeHead(webRes.status, outHeaders);
        if (webRes.body) {
          // SSE / streaming responses MUST pipe (never buffer) so streaming works.
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
