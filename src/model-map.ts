// Shared tier -> provider-model resolution, used by the proxy (routing), the Providers tab
// (display), and the wrapper (model env injection). Self-heals: a stored mapping whose model no
// longer exists in the live catalog (e.g. after a model refresh) is auto-re-derived to the current
// best model for that tier, so the mapping tracks the app's models without the user re-assigning.
// fs/path reads stay here; the pure tier-detect and heal/derive resolution is delegated to
// CoreProxyJs (ModelMap.java, single source shared with the JVM backend).

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { getCoreProxy } from "./core-proxy-loader.js";
import type { Assignment, CatalogEntry, Chain, ModelMap, RoutingProfile } from "./types.js";

// Only the DATA fields CoreProxyJs.profileFromJson reads; RoutingProfile also carries functions
// (nativeRateLimit, translator) that never cross the JSON boundary.
function profileToJson(profile: RoutingProfile) {
  return {
    configFile: profile.configFile,
    tierSourceProvider: profile.tierSourceProvider,
    tierOrder: profile.tierOrder,
    tierFallback: profile.tierFallback,
    tierRegex: profile.tierRegex.source,
    envPrefix: profile.envPrefix,
  };
}

function configFolder(configDir: string): string {
  return join(configDir, "config");
}

type ModelCacheEntry = {
  ranking?: string[];
  models?: Record<string, { name?: string; limit?: { context?: number; output?: number } }>;
  scores?: Record<string, number>;
};
type ModelCacheMap = Record<string, ModelCacheEntry>;

// core-auth writes the live per-provider catalog here on login / "Refresh models".
function modelCache(configDir: string): ModelCacheMap {
  try {
    const p = join(configFolder(configDir), "models.json");
    if (existsSync(p)) return JSON.parse(readFileSync(p, "utf8")) || {};
  } catch {}
  return {};
}

/**
 * Detects the tier names from the tier-source provider's catalog.
 *
 * @remarks
 * A tier is the family token of each model id, taken with `profile.tierRegex`, so a new model
 * family gets a mapping slot on its own. `profile.tierOrder` keeps known families in a familiar
 * order and `profile.tierFallback` covers pre-login, when there is no catalog yet.
 *
 * @param configDir where the catalog cache lives
 * @param profile the profile naming the tier source, order and fallback
 * @returns the tier names, in the order a reader expects them
 */
export function claudeTiers(configDir: string, profile: RoutingProfile): string[] {
  const storeJson = JSON.stringify({ "models.json": JSON.stringify(modelCache(configDir)) });
  const profileJson = JSON.stringify(profileToJson(profile));
  const core = getCoreProxy();
  return JSON.parse(core.resolveTiersJson(profileJson, storeJson)) as string[];
}

/**
 * Reads the stored mapping out of the app's loader config.
 *
 * @param configDir where the config lives
 * @param profile the profile naming the config file
 * @returns the stored mapping, empty on absence or any parse failure
 */
export function readModelMap(configDir: string, profile: RoutingProfile): Record<string, unknown> {
  try {
    const p = join(configFolder(configDir), profile.configFile);
    if (existsSync(p)) return JSON.parse(readFileSync(p, "utf8")).modelMap || {};
  } catch {}
  return {};
}

/**
 * Gathers the live catalog from every deployed provider.
 *
 * @remarks
 * Prefers core-auth's fetched cache and falls back to each package's static list, so a host that
 * has never logged in still has models to map.
 *
 * @param configDir where the deployed providers and the cache live
 * @returns every model on offer, across all providers
 */
export function catalogEntries(configDir: string): CatalogEntry[] {
  const out: CatalogEntry[] = [];
  const reposDir = join(configDir, "repos");
  let repos: string[] = [];
  try {
    repos = readdirSync(reposDir);
  } catch {
    return out;
  }
  const cache = modelCache(configDir);
  for (const repo of repos) {
    try {
      const pkg = JSON.parse(readFileSync(join(reposDir, repo, "package.json"), "utf8"));
      const declared = (pkg.claudeHub && pkg.claudeHub.authProviders) || pkg.authProviders || [];
      for (const p of declared) {
        const provider = p.name || repo;
        const cached = cache[provider] && cache[provider].models;
        if (cached) {
          // ranking (best first) if core-auth computed one, else catalog order
          const order = cache[provider].ranking && cache[provider].ranking!.length ? cache[provider].ranking! : Object.keys(cached);
          const scores = cache[provider].scores || {};
          for (const model of order) {
            if (!cached[model]) continue;
            out.push({
              provider,
              model,
              name: cached[model].name || model,
              score: typeof scores[model] === "number" ? scores[model] : undefined,
              limit: cached[model].limit,
            });
          }
        } else {
          for (const m of p.models || []) {
            const model = typeof m === "string" ? m : m.id;
            out.push({ provider, model, name: typeof m === "string" ? m : m.name || m.id });
          }
        }
      }
    } catch {}
  }
  return out;
}

/**
 * Normalizes a stored slot value into an ordered chain.
 *
 * @remarks
 * A single assignment becomes a one-entry chain, an array stays one, anything else becomes empty.
 * The first entry is the primary and the rest are the fallbacks the proxy tries when earlier ones
 * are rate-limited.
 *
 * @param raw the stored slot value, of whatever shape it was written in
 * @returns the chain, empty when nothing usable was stored
 */
export function normalizeChain(raw: unknown): Chain {
  if (!raw) return [];
  const arr = Array.isArray(raw) ? raw : [raw];
  return arr.filter((e): e is Assignment => !!e && !!(e as Assignment).provider && !!(e as Assignment).model);
}

/**
 * Resolves each tier to the chain the proxy will actually route through.
 *
 * @remarks
 * A stored entry is kept while its model still exists in the catalog. A fully stale tier heals only
 * within the provider the user chose, never silently to a different one: a mapping to one provider's
 * model must not become a mapping to another and then gate on its accounts. When the chosen provider
 * has no catalog at all the stored entry passes through untouched, because the catalog may simply
 * not be fetched yet and a genuinely missing model draws the provider's own clear error. Only a tier
 * with no stored choice derives from the whole catalog, and `-auto` ids are skipped.
 *
 * @param configDir where the stored mapping and the catalog live
 * @param profile the profile naming the config file and the tier source
 * @returns each tier's ordered chain, always including `default`
 */
export function resolveModelMap(configDir: string, profile: RoutingProfile): ModelMap {
  const storeJson = JSON.stringify({
    // read by ModelMap.resolveTiers internally, to detect the tier list from the tier-source
    // provider's cached ranking
    "models.json": JSON.stringify(modelCache(configDir)),
    [profile.configFile]: JSON.stringify({ modelMap: readModelMap(configDir, profile) }),
    catalog: JSON.stringify(catalogEntries(configDir)),
  });
  const profileJson = JSON.stringify(profileToJson(profile));
  const core = getCoreProxy();
  return JSON.parse(core.resolveModelMapJson(profileJson, storeJson)) as ModelMap;
}

/**
 * Builds the environment pairs the wrapper exports.
 *
 * @remarks
 * They make the app's own model picker show the mapped models as custom tier entries, with real
 * names through the `_NAME` variables, and make the default tier the session default. Returned as
 * pairs rather than joined lines because a display name can contain spaces and parentheses, so the
 * caller quotes each value for whichever shell it writes for.
 *
 * @param configDir where the stored mapping and the catalog live
 * @param profile the profile naming the variable prefix
 * @returns the pairs to export, in the order they should be written
 */
export function modelEnvPairs(configDir: string, profile: RoutingProfile): { key: string; value: string }[] {
  const eff = resolveModelMap(configDir, profile);
  const pairs: { key: string; value: string }[] = [];
  for (const tier of Object.keys(eff)) {
    if (tier === "default") continue;
    const primary = (eff[tier] || [])[0]; // the tier's primary drives /model display
    if (!primary || !primary.model) continue;
    const upper = tier.toUpperCase(); // e.g. fable -> ..._DEFAULT_FABLE_MODEL
    pairs.push({ key: `${profile.envPrefix}_DEFAULT_${upper}_MODEL`, value: primary.model });
    pairs.push({ key: `${profile.envPrefix}_DEFAULT_${upper}_MODEL_NAME`, value: primary.name || primary.model });
  }
  const dflt = (eff.default || [])[0];
  if (dflt && dflt.model) pairs.push({ key: `${profile.envPrefix}_MODEL`, value: dflt.model });
  return pairs;
}
