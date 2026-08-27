package io.github.intisy.ai.shared.store;

import io.github.intisy.ai.api.seam.JsonCodec;
import io.github.intisy.ai.api.seam.Store;
import io.github.intisy.ai.seam.JsonUtil;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Shared model-catalog cache over the {@link Store} + {@link JsonCodec} SPIs, keyed by provider id.
 * Unlocked: a full read-modify-write on every call, best effort.
 *
 * <p>On-disk shape, under the key {@code "models.json"}: {@code {"<providerId>": {models, ranking,
 * defaultModelId, source, sorts, sortOrders, scores, scoreSource, fetchedAt}, ...}}.
 */
public class ModelsCache {
    private static final String KEY = "models.json";

    private final Store store;
    private final JsonCodec json;

    /**
     * Opens the cache over one store.
     *
     * @param store where the document lives
     * @param json the codec that reads and writes it
     */
    public ModelsCache(Store store, JsonCodec json) {
        this.store = store;
        this.json = json;
    }

    /** Per-provider cache entry. */
    public static class Entry {
        /** Every model the provider offers, keyed by model id. */
        public Map<String, Object> models;
        /** Model ids best first, when the provider computed a ranking. */
        public List<String> ranking;
        /** The model served when a request names none. */
        public String defaultModelId;
        /** {@code "live"} when fetched now, {@code "static"} for the shipped fallback, else empty. */
        public String source;
        /** The sort options the dashboard offers, as opaque {@code {id, label}} objects. */
        public List<Object> sorts;
        /** Model ids per sort option, keyed by sort id. */
        public Map<String, List<String>> sortOrders;
        /** Per-model scores, keyed by model id. */
        public Map<String, Object> scores;
        /** Where the scores came from, for a reader deciding how much to trust them. */
        public String scoreSource;
        /** When the entry was fetched, in epoch milliseconds. */
        public Long fetchedAt;
    }

    private Map<String, Object> readAllRaw() {
        String raw = store.get(KEY);
        if (raw != null) {
            try {
                Map<String, Object> all = JsonUtil.asMap(json.parse(raw));
                if (all != null) return all;
            } catch (Exception ignored) {
                // degrade to an empty cache on any parse failure
            }
        }
        return new LinkedHashMap<>();
    }

    private static Entry entryFromMap(Map<String, Object> m) {
        Entry e = new Entry();
        e.models = JsonUtil.asMap(m.get("models"));

        List<Object> rankingRaw = JsonUtil.asList(m.get("ranking"));
        if (rankingRaw != null) {
            List<String> ranking = new ArrayList<>();
            for (Object o : rankingRaw) {
                if (o instanceof String) ranking.add((String) o);
            }
            e.ranking = ranking;
        }

        e.defaultModelId = JsonUtil.asString(m.get("defaultModelId"));
        e.source = JsonUtil.asString(m.get("source"));
        e.sorts = JsonUtil.asList(m.get("sorts"));

        Map<String, Object> sortOrdersRaw = JsonUtil.asMap(m.get("sortOrders"));
        if (sortOrdersRaw != null) {
            Map<String, List<String>> sortOrders = new LinkedHashMap<>();
            for (Map.Entry<String, Object> se : sortOrdersRaw.entrySet()) {
                List<Object> vRaw = JsonUtil.asList(se.getValue());
                List<String> v = new ArrayList<>();
                if (vRaw != null) {
                    for (Object o : vRaw) {
                        if (o instanceof String) v.add((String) o);
                    }
                }
                sortOrders.put(se.getKey(), v);
            }
            e.sortOrders = sortOrders;
        }

        e.scores = JsonUtil.asMap(m.get("scores"));
        e.scoreSource = JsonUtil.asString(m.get("scoreSource"));
        e.fetchedAt = JsonUtil.asLong(m.get("fetchedAt"));
        return e;
    }

    private static Map<String, Object> entryToMap(Entry e) {
        Map<String, Object> m = new LinkedHashMap<>();
        if (e.models != null) m.put("models", e.models);
        if (e.ranking != null) m.put("ranking", e.ranking);
        if (e.defaultModelId != null) m.put("defaultModelId", e.defaultModelId);
        if (e.source != null) m.put("source", e.source);
        if (e.sorts != null) m.put("sorts", e.sorts);
        if (e.sortOrders != null) m.put("sortOrders", e.sortOrders);
        if (e.scores != null) m.put("scores", e.scores);
        if (e.scoreSource != null) m.put("scoreSource", e.scoreSource);
        m.put("fetchedAt", e.fetchedAt != null ? e.fetchedAt : 0L);
        return m;
    }

    /**
     * Returns the provider's cached entry, or {@code null} if there is none or it has no models.
     *
     * @param providerId the provider to look up
     * @return its entry, or {@code null} when nothing usable is cached
     */
    public Entry read(String providerId) {
        Map<String, Object> m = JsonUtil.asMap(readAllRaw().get(providerId));
        if (m == null) return null;
        Entry entry = entryFromMap(m);
        return entry.models != null ? entry : null;
    }

    /**
     * Read-modify-write: merges {@code entry} into the stored map under {@code providerId} and
     * rewrites the whole document.
     *
     * @param providerId the provider to write under
     * @param entry what to store for it
     */
    public void write(String providerId, Entry entry) {
        Map<String, Object> all = readAllRaw();
        all.put(providerId, entryToMap(entry));
        store.put(KEY, json.stringify(all));
    }
}
