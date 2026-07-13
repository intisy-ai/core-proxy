// Shared Claude tier -> provider-model resolution, used by the proxy (routing), the
// Providers tab (display), and the wrapper (model env injection). Self-heals: a
// stored mapping whose model no longer exists in the live catalog (e.g. after a model
// refresh) is auto-re-derived to the current best model for that tier, so the mapping
// tracks the app's models without the user re-assigning. Pure fs/path only.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { Assignment, CatalogEntry, Chain, ModelMap, RoutingProfile } from "./types.js";

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

// Tiers are DETECTED from the tier-source provider's catalog (family token of each
// model id, via profile.tierRegex, e.g. claude-fable-5 -> "fable"), so new families
// appear as mapping slots automatically. profile.tierOrder keeps known families in a
// familiar order; profile.tierFallback covers pre-login (no catalog yet).
export function claudeTiers(configDir: string, profile: RoutingProfile): string[] {
  const cc = modelCache(configDir)[profile.tierSourceProvider];
  const ids = cc && cc.ranking && cc.ranking.length ? cc.ranking : Object.keys(cc?.models || {});
  const tiers: string[] = [];
  for (const id of ids) {
    const m = profile.tierRegex.exec(String(id));
    if (m && !tiers.includes(m[1])) tiers.push(m[1]);
  }
  if (!tiers.length) return profile.tierFallback.slice();
  tiers.sort((a, b) => {
    const ia = profile.tierOrder.indexOf(a);
    const ib = profile.tierOrder.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
  });
  return tiers;
}

export function readModelMap(configDir: string, profile: RoutingProfile): Record<string, unknown> {
  try {
    const p = join(configFolder(configDir), profile.configFile);
    if (existsSync(p)) return JSON.parse(readFileSync(p, "utf8")).modelMap || {};
  } catch {}
  return {};
}

// Live catalog [{provider, model, name}] from each deployed provider's authProviders,
// preferring core-auth's fetched cache, else the package's static list.
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

// Normalize a stored slot value into an ordered chain: legacy single {provider,model}
// -> [obj]; an array stays; anything else -> []. First entry is the primary, the rest
// are ordered fallbacks the proxy tries when earlier ones are rate-limited.
export function normalizeChain(raw: unknown): Chain {
  if (!raw) return [];
  const arr = Array.isArray(raw) ? raw : [raw];
  return arr.filter((e): e is Assignment => !!e && !!(e as Assignment).provider && !!(e as Assignment).model);
}

// Effective tier -> ORDERED CHAIN of {provider, model, name, derived}. Each stored
// entry is kept while its model still exists in the catalog; a fully stale tier
// heals ONLY within the provider the user chose — never silently to a different
// provider (an Opus->antigravity mapping must not become the tier-source provider and
// then gate on its accounts). When the chosen provider has no catalog at all, the
// stored entry passes through untouched (the catalog may simply not be fetched yet;
// if the model is really gone the provider reports its own clear error). Only a tier
// with NO stored choice derives from the whole catalog. "-auto" ids skipped.
export function resolveModelMap(configDir: string, profile: RoutingProfile): ModelMap {
  const stored = readModelMap(configDir, profile);
  const catalog = catalogEntries(configDir).filter((e) => !/-auto$/.test(e.model));
  const has = (provider: string, model: string) => catalog.some((e) => e.provider === provider && e.model === model);
  const nameOf = (provider: string, model: string) => {
    const m = catalog.find((e) => e.provider === provider && e.model === model);
    return (m && m.name) || model;
  };
  const deriveIn = (entries: CatalogEntry[], keyword: string | null) =>
    entries.find((e) => keyword && e.model.toLowerCase().indexOf(keyword) >= 0) || null;

  const pick = (slot: string, keyword: string | null): Chain => {
    const chain = normalizeChain(stored[slot]);
    const out: Chain = [];
    for (const e of chain) {
      const providerKnown = catalog.some((c) => c.provider === e.provider);
      if (has(e.provider, e.model)) out.push({ provider: e.provider, model: e.model, name: nameOf(e.provider, e.model), derived: false });
      else if (!providerKnown) out.push({ provider: e.provider, model: e.model, name: e.model, derived: false });
    }
    if (out.length) return out;
    // Whole chain stale — heal WITHIN the chosen provider (only its model id
    // changed); cross-provider derivation is reserved for unset tiers, preferring
    // the tier-source provider (the app's own models are the natural default).
    const preferred = chain[0] && chain[0].provider;
    if (preferred) {
      const d = deriveIn(catalog.filter((e) => e.provider === preferred), keyword);
      return d ? [{ provider: d.provider, model: d.model, name: nameOf(d.provider, d.model), derived: true }] : [];
    }
    const d = deriveIn(catalog.filter((e) => e.provider === profile.tierSourceProvider), keyword) || deriveIn(catalog, keyword);
    return d ? [{ provider: d.provider, model: d.model, name: nameOf(d.provider, d.model), derived: true }] : [];
  };

  const eff: Record<string, Chain> = {};
  const tiers = claudeTiers(configDir, profile);
  for (const tier of tiers) eff[tier] = pick(tier, tier);
  const dflt = pick("default", null);
  const first = tiers.find((t) => (eff[t] || []).length);
  eff.default = dflt.length ? dflt : first ? eff[first].map((e) => ({ ...e, derived: true })) : [];
  return eff as ModelMap;
}

// {key,value} env pairs the wrapper exports so the app's /model shows the mapped
// models as custom tier entries (real names via *_NAME) and uses the default tier as
// the session default. Values (display names) can contain spaces/parens, so the
// caller quotes per shell — hence pairs, not pre-joined lines.
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
