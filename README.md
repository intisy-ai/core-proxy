# core-proxy

The shared routing + HTTP-proxy engine for the intisy AI-tooling ecosystem. It
holds the `:34567` daemon logic (tier→provider routing chains, rate-limit
fallback, model rewrite, the native-429 synthesis, and the node↔web request
adapter) as a single source of truth, so both the loaders and the dashboard
sidecar drive identical behavior.

This is a **library repo consumed as a git submodule and bundled from source**
(the same treatment as `core` / `core-auth` / `core-loader`); it is not
published to npm.

## Under-the-Hood Architecture

```mermaid
flowchart LR
  A[cc / oc request] --> S[createProxyServer :34567]
  S -->|/health| H[ok]
  S -->|/v1/models| C[catalogEntries]
  S -->|/v1/messages| R[resolveModelMap → tier chain]
  R --> W{walk chain}
  W -->|resolveHandler provider| P[provider handle]
  P -->|isRateLimited| W
  W -->|chain exhausted| N[rateLimitFinal → profile.nativeRateLimit]
```

Routing is parameterized by a `RoutingProfile`: everything app-specific
(config filename, routing key, tier order/fallback, tier regex, env prefix,
default context/output limits, and the native rate-limit response) lives in a
profile supplied by the caller. This engine is **generic**: it contains no
per-app logic. Each app's concrete profile lives in its own project (e.g.
`claude-code-proxy` provides the Anthropic/Claude profile); a new proxy-using
app adds its own `<app>-proxy` on top of this engine rather than forking it.

## Structure

- `src/types.ts`: the ABI (`HandlerCtx`, `ProxyHandler`, `HandlerResolver`,
  `Assignment`, `Chain`, `ModelMap`, `CatalogEntry`, `RateLimitInfo`,
  `RoutingProfile`, `ProxyOptions`, `ProxyServer`) + `isValidProfile`.
- `src/rate-limit.ts`: `isRateLimited`, `rateLimitResetMs`, `rateLimitFinal`.
- `src/model-map.ts`: `resolveModelMap`, `claudeTiers`, `readModelMap`,
  `catalogEntries`, `normalizeChain`, `modelEnvPairs`.
- `src/handler-resolver.ts`: `makeDynamicResolver` (mtime-cache-busting
  dynamic import of provider handlers, provider list injected).
- `src/server.ts`: `createProxyServer(opts)` (the daemon + node↔web adapter).
- `src/index.ts`: the public barrel. (App profiles live in their own
  project, not here; see `claude-code-proxy`.)
- `dist/`: compiled output (gitignored, never committed).

## Usage

```ts
import { createProxyServer, makeDynamicResolver, type RoutingProfile } from "../core-proxy/src/index.js";

// `profile` is supplied by an app-specific project (e.g. claude-code-proxy's anthropicProfile()).
const resolveHandler = makeDynamicResolver(() =>
  listProviders().map((p) => ({ provider: p.provider, handlerPath: p.handlerPath }))
);
const server = createProxyServer({ configDir, profile, port: 34567, resolveHandler });
await server.listen();
```

## Testing

`npm run build && npx vitest run` runs unit tests for each module plus an
integration test that binds an ephemeral port and exercises `/health`,
chain fallback past a rate-limited provider, and native-429 exhaustion.

## License

MIT
