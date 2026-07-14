package io.github.intisy.ai.js;

import io.github.intisy.ai.shared.logic.HandlerResolvers;
import io.github.intisy.ai.shared.logic.ModelMap;
import io.github.intisy.ai.shared.logic.RateLimit;
import io.github.intisy.ai.shared.logic.Router;
import io.github.intisy.ai.shared.logic.RouterOptions;
import io.github.intisy.ai.shared.routing.Assignment;
import io.github.intisy.ai.shared.routing.ProxyHandler;
import io.github.intisy.ai.shared.routing.RoutingProfile;
import io.github.intisy.ai.shared.spi.HttpClient;
import io.github.intisy.ai.shared.spi.JsonCodec;
import io.github.intisy.ai.shared.spi.Store;
import io.github.intisy.ai.shared.spi.http.HttpResponse;

import org.teavm.jso.JSExport;
import org.teavm.jso.core.JSPromise;
import org.teavm.jso.core.JSString;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * TeaVM JS export surface over core-proxy's routing engine ({@code Router}/{@code ModelMap}) —
 * relocated from ai-java's {@code AiJavaJs} (Phase 4 Task 1), ROUTING-ONLY: every export that
 * touched the account/auth engine ({@code AccountManager}, {@code TokenRefresh}, {@code
 * AccountStore}, {@code Selection}, {@code RateLimitMath}) was dropped here — those relocate to
 * {@code core-auth}'s own Java module instead (Phase 4 Task 2), which is expected to define its
 * own JS export surface alongside this one. {@link #routeJsonAsync} in particular no longer
 * claims an account as part of its canned "test" handler (see this class's git history / the
 * original {@code AiJavaJs.routeJsonAsync} javadoc for the dropped demo) — it now just forwards
 * the request upstream via {@link JsHttpClientBridge}, nothing more.
 */
public final class CoreProxyJs {
    private CoreProxyJs() {
    }

    private static final String CONFIG_FILE = "router-test.json";

    /**
     * Synchronous smoke export: routes {@code requestJson} through a canned in-Java handler
     * (no HttpClient involved at all). {@code storeJson} is a JSON object of
     * {@code {storeKey: jsonStringValue}} used to seed the in-memory {@link Store} (e.g.
     * {@code {"router-test.json":"{\"modelMap\":{...}}"}}) — Store values are themselves
     * opaque JSON strings per the {@link Store} SPI contract.
     */
    @JSExport
    public static String routeJsonSync(String storeJson, String requestJson) {
        Store store = seedStore(storeJson);
        RouterOptions opts = baseOptions(store, syncHandlerRegistry());
        return Router.routeJson(requestJson, opts);
    }

    /**
     * Integer-fidelity check: a bare parse+stringify round trip through {@link SimpleJsonCodec}
     * (the same codec {@link #routeJsonSync}/{@link #routeJsonAsync} use internally), with no
     * {@code Router} involved. Exists so a TS consumer test can prove — through the actually-
     * shipped export surface, not a JVM-only unit test — that a whole-number JSON value stays
     * byte-compatible with the JVM's gson-backed codec output for the same input.
     */
    @JSExport
    public static String jsonRoundTrip(String json) {
        JsonCodec codec = new SimpleJsonCodec();
        return codec.stringify(codec.parse(json));
    }

    /**
     * {@code RateLimit.rateLimitResetMs} export: {@code argsJson} is
     * {@code {"headers":{...},"now":long}}. Returns the bare JSON number result.
     */
    @JSExport
    public static String rateLimitResetMsJson(String argsJson) {
        JsonCodec json = new SimpleJsonCodec();
        Map<?, ?> args = (Map<?, ?>) json.parse(argsJson);
        long now = toLong(args.get("now"));

        Map<String, String> headers = new HashMap<>();
        Object headersObj = args.get("headers");
        if (headersObj instanceof Map) {
            for (Map.Entry<?, ?> e : ((Map<?, ?>) headersObj).entrySet()) {
                headers.put(String.valueOf(e.getKey()), String.valueOf(e.getValue()));
            }
        }
        HttpResponse resp = new HttpResponse();
        resp.status = 200;
        resp.headers = headers;
        resp.body = "";

        long result = RateLimit.rateLimitResetMs(resp, now);
        return json.stringify(result);
    }

    /**
     * {@code ModelMap.resolveTiers} export over a ONE-SHOT store snapshot (parity/test use —
     * see {@link #resolveTiers} for the production version over a LIVE JS store). {@code
     * profileJson} supplies {@code tierSourceProvider}/{@code tierOrder}/{@code tierFallback}/
     * {@code tierRegex}; {@code storeJson} is a Store snapshot (typically just a seeded
     * {@code models.json}). Returns the resolved tier list as a JSON array.
     */
    @JSExport
    public static String resolveTiersJson(String profileJson, String storeJson) {
        JsonCodec json = new SimpleJsonCodec();
        Store store = seedStore(storeJson);
        RoutingProfile p = profileFromJson(json, profileJson);
        List<String> tiers = ModelMap.resolveTiers(store, json, p);
        return json.stringify(tiers);
    }

    /**
     * {@code ModelMap.resolveModelMap} export over a ONE-SHOT store snapshot (parity/test use —
     * see {@link #resolveModelMap} for the production version over a LIVE JS store). Returns
     * {@code {tier: [{provider,model,name,derived}, ...]}} as JSON.
     */
    @JSExport
    public static String resolveModelMapJson(String profileJson, String storeJson) {
        JsonCodec json = new SimpleJsonCodec();
        Store store = seedStore(storeJson);
        RoutingProfile p = profileFromJson(json, profileJson);
        Map<String, List<Assignment>> eff = ModelMap.resolveModelMap(store, json, p);
        return modelMapToJson(json, eff);
    }

    /**
     * PRODUCTION export: {@code ModelMap.resolveTiers} over the LIVE JS store ({@code jsStore},
     * bridged via {@link JsStoreBridge} — no snapshot/discard), reading the tier-source
     * provider's catalog from store key {@code models.json} exactly as a real provider driver
     * would. {@code profileJson} shape matches {@link #resolveTiersJson}'s. Returns the resolved
     * tier list as a JSON array of strings.
     */
    @JSExport
    public static String resolveTiers(String profileJson, JsStoreBridge.JsStore jsStore) {
        JsonCodec json = new SimpleJsonCodec();
        Store store = new JsStoreBridge(jsStore);
        RoutingProfile p = profileFromJson(json, profileJson);
        List<String> tiers = ModelMap.resolveTiers(store, json, p);
        return json.stringify(tiers);
    }

    /**
     * PRODUCTION export: {@code ModelMap.resolveModelMap} over the LIVE JS store (key
     * {@code profile.configFile} for the stored {@code modelMap}, plus {@code models.json} for
     * the live catalog) — the fine-grained call a TS driver makes instead of routing a whole
     * request through {@link #routeJsonAsync}. Returns
     * {@code {tier: [{provider,model,name,derived}, ...]}} JSON.
     */
    @JSExport
    public static String resolveModelMap(String profileJson, JsStoreBridge.JsStore jsStore) {
        JsonCodec json = new SimpleJsonCodec();
        Store store = new JsStoreBridge(jsStore);
        RoutingProfile p = profileFromJson(json, profileJson);
        Map<String, List<Assignment>> eff = ModelMap.resolveModelMap(store, json, p);
        return modelMapToJson(json, eff);
    }

    private static String modelMapToJson(JsonCodec json, Map<String, List<Assignment>> eff) {
        Map<String, Object> out = new LinkedHashMap<>();
        for (Map.Entry<String, List<Assignment>> entry : eff.entrySet()) {
            List<Object> chain = new ArrayList<>();
            for (Assignment a : entry.getValue()) {
                Map<String, Object> m = new LinkedHashMap<>();
                m.put("provider", a.provider);
                m.put("model", a.model);
                m.put("name", a.name);
                m.put("derived", a.derived);
                chain.add(m);
            }
            out.put(entry.getKey(), chain);
        }
        return json.stringify(out);
    }

    // -- parity-export helpers ------------------------------------------------------

    private static RoutingProfile profileFromJson(JsonCodec json, String profileJson) {
        Map<?, ?> m = (Map<?, ?>) json.parse(profileJson);
        RoutingProfile p = new RoutingProfile();
        Object configFile = m.get("configFile");
        p.configFile = configFile instanceof String ? (String) configFile : null;
        p.routingKey = "providerRouting";
        p.tierSourceProvider = (String) m.get("tierSourceProvider");
        p.tierOrder = toStringList(m.get("tierOrder"));
        p.tierFallback = toStringList(m.get("tierFallback"));
        p.tierRegex = Pattern.compile((String) m.get("tierRegex"));
        p.envPrefix = (String) m.get("envPrefix");
        p.defaultContext = 200000;
        p.defaultOutput = 64000;
        return p;
    }

    private static List<String> toStringList(Object o) {
        List<String> out = new ArrayList<>();
        if (o instanceof List) {
            for (Object v : (List<?>) o) out.add(String.valueOf(v));
        }
        return out;
    }

    private static long toLong(Object o) {
        return o instanceof Number ? ((Number) o).longValue() : 0L;
    }

    /**
     * THE decisive export: routes {@code requestJson} through the shared {@code Router}, whose
     * single registered provider handler forwards the request upstream via
     * {@link JsHttpClientBridge} — a blocking-shaped {@code HttpClient.send} actually backed by
     * the JS-provided {@code httpSend} async function (production: {@code fetch}; test harness:
     * a mocked, delayed resolve). Returns a JS {@code Promise<string>}: the whole
     * synchronous-looking Java call chain (routeJson -&gt; handle -&gt; HttpClient.send)
     * suspends at the {@code @Async} native boundary and resumes when the JS Promise the caller
     * supplied settles, all inside the {@link Thread} started below (TeaVM's own
     * {@code JSPromise.callAsync} uses the identical Thread-based mechanism internally).
     *
     * <p>{@code jsStore} is the LIVE JS store object itself, bridged via {@link JsStoreBridge} —
     * no snapshot/discard. Routing-only: the "test" provider handler below is a bare forward
     * (no account claiming/selection) — see this class's javadoc for why that demo bit was
     * dropped relative to ai-java's original {@code routeJsonAsync}.
     */
    @JSExport
    public static JSPromise<JSString> routeJsonAsync(JsHttpClientBridge.JsHttpSend httpSend,
                                                       JsStoreBridge.JsStore jsStore, String requestJson) {
        // Not JSPromise.callAsync(Callable<T>): its internal resolve.accept(result) is a
        // generic JSConsumer<T> call, which (per the JsHttpSend javadoc) leaks a raw jl_String
        // wrapper into the resolved value instead of a real JS string. Building the promise by
        // hand lets us convert explicitly via JSString.valueOf right before the resolve/reject
        // call — the actual CPS-suspension mechanism (a real Thread whose body reaches the
        // @Async awaitSend boundary) is identical to what callAsync does internally.
        return new JSPromise<>((resolve, reject) -> new Thread(() -> {
            try {
                JsonCodec json = new SimpleJsonCodec();
                Store store = new JsStoreBridge(jsStore); // LIVE — no snapshot, no discard on return
                HttpClient httpClient = new JsHttpClientBridge(httpSend, json);

                Map<String, ProxyHandler> registry = new HashMap<>();
                // The "provider handler" a real provider module would supply: forwards the
                // inbound request upstream via HttpClient.send (the async-bridged call). No
                // account claiming here — that lives on core-auth's side of the fence.
                registry.put("test", (req, ctx) -> httpClient.send(req));

                RouterOptions opts = baseOptions(store, registry);
                opts.json = json;
                String result = Router.routeJson(requestJson, opts); // transitively async via httpClient.send
                resolve.accept(JSString.valueOf(result));
            } catch (Throwable e) {
                reject.accept(JSString.valueOf("routeJsonAsync failed: " + e));
            }
        }).start());
    }

    // -- shared wiring ------------------------------------------------------------

    static Store seedStore(String storeJson) {
        InMemoryStore store = new InMemoryStore();
        SimpleJsonCodec json = new SimpleJsonCodec();
        Object parsed = json.parse(storeJson);
        if (parsed instanceof Map) {
            for (Map.Entry<?, ?> e : ((Map<?, ?>) parsed).entrySet()) {
                if (e.getKey() != null && e.getValue() instanceof String) {
                    store.put(String.valueOf(e.getKey()), (String) e.getValue());
                }
            }
        }
        return store;
    }

    static RouterOptions baseOptions(Store store, Map<String, ProxyHandler> registry) {
        RouterOptions opts = new RouterOptions();
        opts.profile = testProfile();
        opts.resolveHandler = HandlerResolvers.fromRegistry(registry);
        opts.store = store;
        opts.json = new SimpleJsonCodec();
        opts.clock = System::currentTimeMillis;
        opts.log = msg -> {
        };
        opts.notify = (message, level) -> {
        };
        opts.listProviders = () -> new java.util.ArrayList<>(registry.keySet());
        opts.configDir = "";
        return opts;
    }

    // Mirrors shared's RouterTest.testProfile(): a minimal, valid RoutingProfile for a single
    // synthetic "test" tier/provider — no real Claude/native profile needed for this spike.
    static RoutingProfile testProfile() {
        RoutingProfile p = new RoutingProfile();
        p.configFile = CONFIG_FILE;
        p.routingKey = "providerRouting";
        p.tierSourceProvider = "test";
        p.tierOrder = Collections.singletonList("default");
        p.tierFallback = Collections.singletonList("default");
        p.tierRegex = Pattern.compile("^model-([a-z]+)-\\d");
        p.envPrefix = "AIJAVA";
        p.defaultContext = 200000;
        p.defaultOutput = 64000;
        p.nativeRateLimit = info -> {
            RoutingProfile.Synth s = new RoutingProfile.Synth();
            s.status = 429;
            s.headers = new HashMap<>();
            s.body = "{\"type\":\"error\",\"error\":{\"type\":\"rate_limit_error\",\"message\":\"rate limited\"}}";
            return s;
        };
        return p;
    }

    private static Map<String, ProxyHandler> syncHandlerRegistry() {
        Map<String, ProxyHandler> registry = new HashMap<>();
        registry.put("test", (req, ctx) -> {
            HttpResponse resp = new HttpResponse();
            resp.status = 200;
            resp.headers = new HashMap<>();
            resp.body = "served " + ctx.model;
            return resp;
        });
        return registry;
    }
}
