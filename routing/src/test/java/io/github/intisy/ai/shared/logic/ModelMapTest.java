package io.github.intisy.ai.shared.logic;

import io.github.intisy.ai.shared.routing.Assignment;
import io.github.intisy.ai.shared.routing.CatalogEntry;
import io.github.intisy.ai.shared.routing.RoutingProfile;
import io.github.intisy.ai.seam.InMemoryStore;
import io.github.intisy.ai.seam.SimpleJsonCodec;
import org.junit.jupiter.api.Test;

import java.util.Arrays;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Exercises {@link ModelMap} over the {@link InMemoryStore} + {@link SimpleJsonCodec} SPI fakes.
 */
class ModelMapTest {

    // Test data only, not engine logic. A real profile (e.g. Claude's) supplies its own
    // configFile/tierSourceProvider/tierRegex/tierOrder.
    private static RoutingProfile testProfile() {
        RoutingProfile p = new RoutingProfile();
        p.configFile = "model-map-test.json";
        p.routingKey = "providerRouting";
        p.tierSourceProvider = "antigravity";
        p.tierOrder = Arrays.asList("opus", "sonnet", "haiku", "fable");
        p.tierFallback = Arrays.asList("opus", "sonnet", "haiku", "fable");
        p.tierRegex = Pattern.compile("^claude-([a-z]+)-\\d");
        p.envPrefix = "ANTHROPIC";
        p.defaultContext = 200000;
        p.defaultOutput = 64000;
        return p;
    }

    // -- normalizeChain -----------------------------------------------------

    @Test
    void normalizeChain_legacyObject_becomesSingleElementList() {
        Map<String, Object> entry = new LinkedHashMap<>();
        entry.put("provider", "antigravity");
        entry.put("model", "m-opus");
        List<Assignment> out = ModelMap.normalizeChain(entry);
        assertEquals(1, out.size());
        assertEquals("antigravity", out.get(0).provider);
        assertEquals("m-opus", out.get(0).model);
    }

    @Test
    void normalizeChain_listWithInvalidEntry_filtersItOut() {
        Map<String, Object> valid = new LinkedHashMap<>();
        valid.put("provider", "antigravity");
        valid.put("model", "m-opus");
        Map<String, Object> invalid = new LinkedHashMap<>();
        invalid.put("provider", "antigravity"); // missing model -> invalid
        List<Assignment> out = ModelMap.normalizeChain(Arrays.asList(valid, invalid));
        assertEquals(1, out.size());
        assertEquals("m-opus", out.get(0).model);
    }

    @Test
    void normalizeChain_null_returnsEmptyList() {
        List<Assignment> out = ModelMap.normalizeChain(null);
        assertNotNull(out);
        assertTrue(out.isEmpty());
    }

    // -- readModelMap ---------------------------------------------------------

    @Test
    void readModelMap_readsModelMapFieldFromConfigFile() {
        InMemoryStore store = new InMemoryStore();
        SimpleJsonCodec json = new SimpleJsonCodec();
        RoutingProfile p = testProfile();
        store.put(p.configFile, "{\"modelMap\":{\"opus\":{\"provider\":\"antigravity\",\"model\":\"m-opus\"}}}");

        Map<String, Object> map = ModelMap.readModelMap(store, json, p);
        assertTrue(map.containsKey("opus"));
    }

    @Test
    void readModelMap_missingFile_returnsEmptyMap() {
        InMemoryStore store = new InMemoryStore();
        SimpleJsonCodec json = new SimpleJsonCodec();
        Map<String, Object> map = ModelMap.readModelMap(store, json, testProfile());
        assertNotNull(map);
        assertTrue(map.isEmpty());
    }

    // -- catalogEntries ---------------------------------------------------------

    @Test
    void catalogEntries_readsFromModelsCache() {
        InMemoryStore store = new InMemoryStore();
        SimpleJsonCodec json = new SimpleJsonCodec();
        store.put("models.json", "{\"antigravity\":{\"models\":{\"m-opus\":{\"name\":\"M Opus\",\"limit\":{\"context\":200000,\"output\":8192}}},\"ranking\":[\"m-opus\"]}}");

        List<CatalogEntry> entries = ModelMap.catalogEntries(store, json, Collections.singletonList("antigravity"));
        assertEquals(1, entries.size());
        assertEquals("antigravity", entries.get(0).provider);
        assertEquals("m-opus", entries.get(0).model);
        assertEquals("M Opus", entries.get(0).name);
        assertEquals(200000, entries.get(0).contextLimit);
        assertEquals(8192, entries.get(0).outputLimit);
    }

    @Test
    void catalogEntries_providerWithNoCache_isSkipped() {
        InMemoryStore store = new InMemoryStore();
        SimpleJsonCodec json = new SimpleJsonCodec();
        List<CatalogEntry> entries = ModelMap.catalogEntries(store, json, Collections.singletonList("unknown-provider"));
        assertTrue(entries.isEmpty());
    }

    // -- resolveModelMap ---------------------------------------------------------

    @Test
    void resolveModelMap_honorsExplicitTierMapping_andDefaultIsNonNull() {
        InMemoryStore store = new InMemoryStore();
        SimpleJsonCodec json = new SimpleJsonCodec();
        RoutingProfile p = testProfile();
        store.put(p.configFile, "{\"modelMap\":{\"opus\":{\"provider\":\"antigravity\",\"model\":\"m-opus\"}}}");
        store.put("models.json", "{\"antigravity\":{\"models\":{\"m-opus\":{\"name\":\"M Opus\"}},\"ranking\":[\"m-opus\"]}}");

        Map<String, List<Assignment>> map = ModelMap.resolveModelMap(store, json, p);

        assertNotNull(map.get("opus"));
        assertFalse(map.get("opus").isEmpty());
        assertEquals("antigravity", map.get("opus").get(0).provider);
        assertEquals("m-opus", map.get("opus").get(0).model);

        assertNotNull(map.get("default"));
    }

    @Test
    void resolveModelMap_staleProviderModel_healsWithinSameProvider() {
        InMemoryStore store = new InMemoryStore();
        SimpleJsonCodec json = new SimpleJsonCodec();
        RoutingProfile p = testProfile();
        // stored mapping points at a model that no longer exists for antigravity
        store.put(p.configFile, "{\"modelMap\":{\"opus\":{\"provider\":\"antigravity\",\"model\":\"m-opus-old\"}}}");
        // the live catalog now only has m-opus-new for antigravity
        store.put("models.json", "{\"antigravity\":{\"models\":{\"m-opus-new\":{\"name\":\"M Opus New\"}},\"ranking\":[\"m-opus-new\"]}}");

        Map<String, List<Assignment>> map = ModelMap.resolveModelMap(store, json, p);

        List<Assignment> opus = map.get("opus");
        assertNotNull(opus);
        assertFalse(opus.isEmpty());
        assertEquals("antigravity", opus.get(0).provider);
        assertEquals("m-opus-new", opus.get(0).model);
        assertTrue(opus.get(0).derived);
    }

    // -- resolveModelMap: supplied "catalog" store key --------------------------

    @Test
    void resolveModelMap_suppliedCatalogKey_resolvesAProviderAbsentFromModelsJson() {
        InMemoryStore store = new InMemoryStore();
        SimpleJsonCodec json = new SimpleJsonCodec();
        RoutingProfile p = testProfile();
        // "newprov" has no models.json entry at all: without the supplied catalog key it would be
        // completely invisible to resolveModelMap (cachedProviderIds only reads models.json).
        store.put(p.configFile, "{\"modelMap\":{\"opus\":{\"provider\":\"newprov\",\"model\":\"newprov-model-1\"}}}");
        store.put("catalog", "[{\"provider\":\"newprov\",\"model\":\"newprov-model-1\",\"name\":\"New Provider Model\"}]");

        Map<String, List<Assignment>> map = ModelMap.resolveModelMap(store, json, p);

        List<Assignment> opus = map.get("opus");
        assertNotNull(opus);
        assertEquals(1, opus.size());
        assertEquals("newprov", opus.get(0).provider);
        assertEquals("newprov-model-1", opus.get(0).model);
        assertEquals("New Provider Model", opus.get(0).name);
        assertFalse(opus.get(0).derived);
    }

    @Test
    void resolveModelMap_noCatalogKey_fallsBackToModelsJsonCachedProviderIds() {
        // No "catalog" key at all (the JVM backend's real usage): behavior must be identical to
        // before the catalog key existed, proving ai-java is unaffected.
        InMemoryStore store = new InMemoryStore();
        SimpleJsonCodec json = new SimpleJsonCodec();
        RoutingProfile p = testProfile();
        store.put(p.configFile, "{\"modelMap\":{\"opus\":{\"provider\":\"antigravity\",\"model\":\"m-opus\"}}}");
        store.put("models.json", "{\"antigravity\":{\"models\":{\"m-opus\":{\"name\":\"M Opus\"}},\"ranking\":[\"m-opus\"]}}");

        Map<String, List<Assignment>> map = ModelMap.resolveModelMap(store, json, p);

        assertEquals("antigravity", map.get("opus").get(0).provider);
        assertEquals("m-opus", map.get("opus").get(0).model);
        assertEquals("M Opus", map.get("opus").get(0).name);
        assertFalse(map.get("opus").get(0).derived);
    }

    // -- modelEnvPairs ---------------------------------------------------------

    @Test
    void modelEnvPairs_containsDefaultOpusModel() {
        InMemoryStore store = new InMemoryStore();
        SimpleJsonCodec json = new SimpleJsonCodec();
        RoutingProfile p = testProfile();
        store.put(p.configFile, "{\"modelMap\":{\"opus\":{\"provider\":\"antigravity\",\"model\":\"m-opus\"}}}");
        store.put("models.json", "{\"antigravity\":{\"models\":{\"m-opus\":{\"name\":\"M Opus\"}},\"ranking\":[\"m-opus\"]}}");

        List<ModelMap.KV> pairs = ModelMap.modelEnvPairs(store, json, p);

        boolean found = false;
        for (ModelMap.KV kv : pairs) {
            if ("ANTHROPIC_DEFAULT_OPUS_MODEL".equals(kv.key)) {
                assertEquals("m-opus", kv.value);
                found = true;
            }
        }
        assertTrue(found, "expected ANTHROPIC_DEFAULT_OPUS_MODEL in " + pairs);
    }
}
