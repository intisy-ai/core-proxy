// Adapts this host's node/web surfaces to the seams the Java router asks for. Everything here is
// marshalling: the routing decisions, the fallback chain and the catalog all live in Router.java.

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type {
  CoreProxyJsHandler,
  CoreProxyJsRouteDeps,
  CoreProxyJsStore,
} from "./generated/core-proxy.teavm.js";
import type {
  HandlerCtx,
  IrEventStream,
  IrRequest,
  IrResponse,
  ProxyHandler,
  RoutingProfile,
} from "./types.js";

/** The store keys Router reads are file names under the app home's `config/` directory. */
export function fileStore(configDir: string): CoreProxyJsStore {
  const dir = join(configDir, "config");
  const pathOf = (key: string) => join(dir, key);
  return {
    get: (key) => {
      try {
        const path = pathOf(key);
        return existsSync(path) ? readFileSync(path, "utf8") : null;
      } catch {
        return null;
      }
    },
    put: (key, value) => {
      try {
        mkdirSync(dir, { recursive: true });
        writeFileSync(pathOf(key), value);
      } catch {}
    },
    exists: (key) => {
      try {
        return existsSync(pathOf(key));
      } catch {
        return false;
      }
    },
    delete: (key) => {
      try {
        rmSync(pathOf(key), { force: true });
      } catch {}
    },
    listKeys: (prefix) => {
      try {
        return existsSync(dir) ? readdirSync(dir).filter((name) => name.startsWith(prefix)) : [];
      } catch {
        return [];
      }
    },
  };
}

/** The profile fields that cross as JSON; its function-valued ones go through the deps instead. */
export function profileJson(profile: RoutingProfile, configDir: string): string {
  return JSON.stringify({
    configFile: profile.configFile,
    routingKey: profile.routingKey,
    tierSourceProvider: profile.tierSourceProvider,
    tierOrder: profile.tierOrder,
    tierFallback: profile.tierFallback,
    tierRegex: profile.tierRegex.source,
    nativeModelPattern: profile.nativeModelPattern ? profile.nativeModelPattern.source : null,
    envPrefix: profile.envPrefix,
    defaultContext: profile.defaultContext,
    defaultOutput: profile.defaultOutput,
    configDir,
  });
}

export async function requestJson(request: Request): Promise<string> {
  const url = new URL(request.url);
  const headers: Record<string, string> = {};
  for (const [name, value] of request.headers) headers[name] = value;
  let body = "";
  try {
    body = await request.clone().text();
  } catch {}
  return JSON.stringify({ method: request.method, url: url.pathname + url.search, headers, body });
}

type TsHandler = {
  handle?: ProxyHandler["handle"];
  handleIr?: (ir: IrRequest, ctx: HandlerCtx) => Promise<IrResponse | IrEventStream>;
};

/**
 * Presents a handler written against this host's typed API to the Java router's JSON one.
 *
 * `wantsStream` decides whether a streamed entry point is offered at all, and it must: the router
 * commits to the streamed path by looking at the handler, before it has a response to inspect, so
 * offering one for a non-streaming request would route every request through the stream machinery.
 */
export function handlerAdapter(
  handler: TsHandler,
  configDir: string,
  log: (message: string) => void,
  wantsStream: boolean,
): CoreProxyJsHandler | null {
  const out: CoreProxyJsHandler = {};
  const contextOf = (ctxJson: string): HandlerCtx => {
    const parsed = JSON.parse(ctxJson) as { configDir?: string; model?: string; handlerId?: string };
    return {
      configDir: parsed.configDir || configDir,
      log,
      model: parsed.model || "",
      provider: parsed.handlerId || "",
    };
  };

  if (typeof handler.handleIr === "function") {
    const callIr = handler.handleIr.bind(handler);

    if (wantsStream) {
      out.handleIrStream = (irRequestJson, ctxJson) => {
        let events: Promise<ReadableStreamDefaultReader<unknown>> | null = null;
        const open = async () => {
          const result = await callIr(JSON.parse(irRequestJson) as IrRequest, contextOf(ctxJson));
          if (!(result instanceof ReadableStream)) {
            // Surfaced on the first pull, which is where the router can still act on it, rather
            // than encoding a buffered response into a stream the client would fail to parse.
            throw new Error("the handler answered a streaming request with a buffered response");
          }
          return result.getReader();
        };
        return {
          next: async () => {
            if (!events) events = open();
            const { value, done } = await (await events).read();
            return done ? null : JSON.stringify(value);
          },
        };
      };
    } else {
      out.handleIr = async (irRequestJson, ctxJson) => {
        const result = await callIr(JSON.parse(irRequestJson) as IrRequest, contextOf(ctxJson));
        if (result instanceof ReadableStream) {
          throw new Error("the handler answered a non-streaming request with a stream");
        }
        return JSON.stringify(result);
      };
    }
  }

  if (typeof handler.handle === "function") {
    const callWire = handler.handle.bind(handler);
    out.handle = async (rawRequestJson, ctxJson) => {
      const parsed = JSON.parse(rawRequestJson) as {
        method: string;
        url: string;
        headers: Record<string, string>;
        body: string;
      };
      const skipBody = parsed.method === "GET" || parsed.method === "HEAD";
      const response = await callWire(
        new Request("http://127.0.0.1" + parsed.url, {
          method: parsed.method,
          headers: parsed.headers,
          body: skipBody ? undefined : parsed.body,
        }),
        contextOf(ctxJson),
      );
      const headers: Record<string, string> = {};
      for (const [name, value] of response.headers) headers[name] = value;
      return JSON.stringify({ status: response.status, headers, body: await response.text() });
    };
  }

  return out.handleIr || out.handleIrStream || out.handle ? out : null;
}

/** The outcome shape `routeRequest` resolves. */
export type RoutedResult = {
  status: number;
  headers: Record<string, string>;
  body?: string;
  streamed: boolean;
  streamError?: string;
};

/**
 * Where each routing event is filed. The engine names WHAT happened; choosing a topic is the host's
 * job, which is why this mapping lives here rather than in the engine.
 */
const ACTIVITY_TOPICS: Record<string, string> = {
  route_healed: "proxy.status",
  model_switched: "proxy.status",
  rate_limit_fallback: "account.rate_limited",
  rate_limited: "account.rate_limited",
};

export type ActivitySpec = {
  topic: string;
  action: string;
  impact?: string;
  details?: unknown;
};

export type RouteDepsOptions = {
  configDir: string;
  profile: RoutingProfile;
  log: (message: string) => void;
  notify: (message: string, level?: string) => void;
  emitActivity: (spec: ActivitySpec) => void;
  resolveHandler: (provider: string) => Promise<TsHandler | null>;
  listProviders: () => string[];
  wantsStream: boolean;
  /** Receives each already-encoded wire frame of a streamed body, in order. */
  emit: (frame: string) => void;
  close: (error: string | null) => void;
};

export async function routeDeps(opts: RouteDepsOptions): Promise<CoreProxyJsRouteDeps> {
  // A profile with no translator is a supported shape: the engine then has no IR front door and
  // routes through a handler's own app-wire path.
  const translator = opts.profile.translator;
  const handles = translator ? await translator.handles() : undefined;

  return {
    store: fileStore(opts.configDir),
    translator: handles,
    resolveHandler: async (provider) => {
      const handler = await opts.resolveHandler(provider);
      return handler ? handlerAdapter(handler, opts.configDir, opts.log, opts.wantsStream) : null;
    },
    notify: (message, level) => opts.notify(message, level ?? undefined),
    event: (action, impact, detailsJson) => {
      let details: unknown;
      try {
        details = JSON.parse(detailsJson);
      } catch {}
      opts.emitActivity({ topic: ACTIVITY_TOPICS[action] ?? "proxy.status", action, impact, details });
    },
    nativeRateLimit: async (infoJson) => {
      const info = JSON.parse(infoJson) as {
        resetMs: number;
        upstreamStatus: number;
        upstreamHeaders: Record<string, string>;
        upstreamBody: string;
      };
      // Rebuilt as a Response because that is what the profile's builder takes; the body arrives
      // already read, which is why nothing here needs a second await on the network.
      const upstream = info.upstreamStatus
        ? new Response(info.upstreamBody, { status: info.upstreamStatus, headers: info.upstreamHeaders })
        : null;
      const built = await opts.profile.nativeRateLimit({ resetMs: info.resetMs, upstream });
      return JSON.stringify(built);
    },
    emit: opts.emit,
    close: opts.close,
    providers: opts.listProviders(),
  };
}
