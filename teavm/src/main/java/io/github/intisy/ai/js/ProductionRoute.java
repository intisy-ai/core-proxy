package io.github.intisy.ai.js;

import io.github.intisy.ai.api.seam.EventSink;
import io.github.intisy.ai.api.seam.EventSource;
import io.github.intisy.ai.api.seam.HttpRequest;
import io.github.intisy.ai.api.seam.HttpResponse;
import io.github.intisy.ai.api.seam.JsonCodec;
import io.github.intisy.ai.api.seam.Store;
import io.github.intisy.ai.ir.IrRequest;
import io.github.intisy.ai.ir.IrResponse;
import io.github.intisy.ai.ir.spi.HandlerCtx;
import io.github.intisy.ai.ir.spi.IrHandler;
import io.github.intisy.ai.seam.NoopLogger;
import io.github.intisy.ai.seam.SimpleJsonCodec;
import io.github.intisy.ai.shared.logic.Router;
import io.github.intisy.ai.shared.logic.RouterOptions;
import io.github.intisy.ai.shared.routing.RoutingProfile;

import org.teavm.interop.Async;
import org.teavm.interop.AsyncCallback;
import org.teavm.jso.core.JSArrayReader;
import org.teavm.jso.core.JSObjects;
import org.teavm.jso.core.JSString;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * Routes one real request: every seam the engine needs is supplied by the JS host through
 * {@link JsRouteDeps}, so nothing here is synthesised for a test the way {@code routeJsonSync} and
 * {@code routeJsonAsync} synthesise their profile and their single {@code "test"} provider.
 *
 * <p>A streamed response is delivered through the host's sink as it is produced, and the returned
 * JSON then carries {@code streamed: true} with no body, because the body has already gone out.
 */
final class ProductionRoute {

    private ProductionRoute() {
    }

    static String route(JsRouteDeps deps, String profileJson, String requestJson) {
        JsonCodec json = new SimpleJsonCodec();
        io.github.intisy.ai.ir.spi.JsonCodec irJson = new io.github.intisy.ai.ir.json.SimpleJsonCodec();

        Map<?, ?> profileMap = asMap(json.parse(profileJson));
        RoutingProfile profile = profile(profileMap);
        profile.translator = new JsTranslatorBridge(deps.getTranslator(), irJson);
        profile.nativeRateLimit = nativeRateLimit(deps, json);

        RouterOptions opts = new RouterOptions();
        opts.profile = profile;
        opts.store = new JsStoreBridge(deps.getStore());
        opts.json = json;
        opts.clock = System::currentTimeMillis;
        opts.log = NoopLogger.INSTANCE;
        opts.notify = (message, level) -> deps.getNotify().notify(JSString.valueOf(message),
                level == null ? null : JSString.valueOf(level));
        opts.listProviders = () -> providers(deps.getProviders());
        opts.configDir = str(profileMap.get("configDir"), "");
        opts.resolveHandler = provider -> resolve(deps, provider, irJson);

        HttpResponse resp = Router.route(request(json, requestJson), opts);
        return respond(json, resp, deps);
    }

    /**
     * Drains a streamed body into the host's sink, then reports the outcome as data rather than by
     * throwing: the status line is long gone by the time a mid-stream failure happens, so the caller
     * can only be told that the stream ended badly.
     */
    private static String respond(JsonCodec json, HttpResponse resp, JsRouteDeps deps) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("status", resp.status);
        out.put("headers", resp.headers != null ? resp.headers : new LinkedHashMap<String, String>());

        if (resp.bodyStream == null) {
            out.put("body", resp.body != null ? resp.body : "");
            out.put("streamed", Boolean.FALSE);
            return json.stringify(out);
        }

        out.put("streamed", Boolean.TRUE);
        EventSink sink = new JsEventSinkBridge(deps.getEmit(), deps.getClose());
        String failure = drain(resp.bodyStream, sink);
        sink.close(failure);
        if (failure != null) out.put("streamError", failure);
        return json.stringify(out);
    }

    private static String drain(EventSource events, EventSink sink) {
        try {
            while (true) {
                String frame = events.next();
                if (frame == null) return null;
                sink.emit(frame);
            }
        } catch (RuntimeException e) {
            return e.getMessage() != null ? e.getMessage() : e.toString();
        }
    }

    private static IrHandler resolve(JsRouteDeps deps, String provider, io.github.intisy.ai.ir.spi.JsonCodec irJson) {
        JsIrHandlerBridge.JsIrHandler jsHandler = awaitResolve(deps.getResolveHandler(), JSString.valueOf(provider));
        if (jsHandler == null || JSObjects.isUndefined(jsHandler)) return null;
        JsIrHandlerBridge bridge = new JsIrHandlerBridge(provider, jsHandler, irJson);
        // Router selects the streamed path by `instanceof IrStreamHandler`, so a handler with no
        // streamed entry point must not present as one: it would be chosen and then refuse.
        return bridge.canStream() ? bridge : new BufferedOnly(bridge);
    }

    /** Presents a JS handler that cannot stream as buffered-only, hiding the streamed interface. */
    private static final class BufferedOnly implements IrHandler {
        private final JsIrHandlerBridge delegate;

        BufferedOnly(JsIrHandlerBridge delegate) {
            this.delegate = delegate;
        }

        @Override
        public String id() {
            return delegate.id();
        }

        @Override
        public IrResponse handleIr(IrRequest request, HandlerCtx ctx) throws Exception {
            return delegate.handleIr(request, ctx);
        }
    }

    private static RoutingProfile.NativeRateLimit nativeRateLimit(JsRouteDeps deps, JsonCodec json) {
        return info -> {
            Map<String, Object> args = new LinkedHashMap<>();
            args.put("resetMs", info != null ? info.resetMs : 0L);
            args.put("upstreamStatus", info != null && info.upstream != null ? info.upstream.status : 0);
            JSString built = deps.getNativeRateLimit().synthesize(JSString.valueOf(json.stringify(args)));
            return synth(json, built == null || JSObjects.isUndefined(built) ? null : built.stringValue());
        };
    }

    private static HttpRequest request(JsonCodec json, String requestJson) {
        HttpRequest req = new HttpRequest();
        req.headers = new LinkedHashMap<>();
        Object parsed = json.parse(requestJson);
        if (!(parsed instanceof Map)) return req;
        Map<?, ?> m = (Map<?, ?>) parsed;
        req.method = str(m.get("method"), "POST");
        req.url = str(m.get("url"), "/");
        req.body = str(m.get("body"), "");
        Object headers = m.get("headers");
        if (headers instanceof Map) {
            for (Map.Entry<?, ?> e : ((Map<?, ?>) headers).entrySet()) {
                if (e.getKey() != null && e.getValue() != null) {
                    req.headers.put(String.valueOf(e.getKey()), String.valueOf(e.getValue()));
                }
            }
        }
        return req;
    }

    private static List<String> providers(JSArrayReader<JSString> raw) {
        List<String> out = new ArrayList<>();
        if (raw == null || JSObjects.isUndefined(raw)) return out;
        int n = raw.getLength();
        for (int i = 0; i < n; i++) {
            JSString entry = raw.get(i);
            if (entry != null && !JSObjects.isUndefined(entry)) out.add(entry.stringValue());
        }
        return out;
    }

    /**
     * The profile's DATA fields. Its function-valued ones are supplied by the caller from
     * {@link JsRouteDeps}, because a function cannot cross the boundary as JSON.
     */
    private static RoutingProfile profile(Map<?, ?> m) {
        RoutingProfile p = new RoutingProfile();
        p.configFile = str(m.get("configFile"), null);
        p.routingKey = str(m.get("routingKey"), "providerRouting");
        p.tierSourceProvider = str(m.get("tierSourceProvider"), "");
        p.tierOrder = strings(m.get("tierOrder"));
        p.tierFallback = strings(m.get("tierFallback"));
        p.tierRegex = Pattern.compile(str(m.get("tierRegex"), "^$"));
        p.envPrefix = str(m.get("envPrefix"), "");
        p.defaultContext = intOf(m.get("defaultContext"), 200000);
        p.defaultOutput = intOf(m.get("defaultOutput"), 64000);
        String nativeModel = str(m.get("nativeModelPattern"), null);
        if (nativeModel != null) p.nativeModelPattern = Pattern.compile(nativeModel);
        return p;
    }

    private static RoutingProfile.Synth synth(JsonCodec json, String builtJson) {
        RoutingProfile.Synth out = new RoutingProfile.Synth();
        out.status = 429;
        out.headers = new LinkedHashMap<>();
        out.body = "";
        if (builtJson == null) return out;
        Map<?, ?> m = asMap(json.parse(builtJson));
        out.status = intOf(m.get("status"), 429);
        out.body = str(m.get("body"), "");
        Object headers = m.get("headers");
        if (headers instanceof Map) {
            for (Map.Entry<?, ?> e : ((Map<?, ?>) headers).entrySet()) {
                if (e.getKey() != null && e.getValue() != null) {
                    out.headers.put(String.valueOf(e.getKey()), String.valueOf(e.getValue()));
                }
            }
        }
        return out;
    }

    private static Map<?, ?> asMap(Object value) {
        return value instanceof Map ? (Map<?, ?>) value : new LinkedHashMap<Object, Object>();
    }

    private static List<String> strings(Object value) {
        List<String> out = new ArrayList<>();
        if (value instanceof List) {
            for (Object entry : (List<?>) value) out.add(String.valueOf(entry));
        }
        return out;
    }

    private static int intOf(Object value, int fallback) {
        return value instanceof Number ? ((Number) value).intValue() : fallback;
    }

    private static String str(Object value, String fallback) {
        return value instanceof String ? (String) value : fallback;
    }

    // -- @Async bridge ------------------------------------------------------------

    @Async
    private static native JsIrHandlerBridge.JsIrHandler awaitResolve(JsRouteDeps.JsResolveHandler fn, JSString provider);

    private static void awaitResolve(JsRouteDeps.JsResolveHandler fn, JSString provider,
                                     AsyncCallback<JsIrHandlerBridge.JsIrHandler> callback) {
        fn.resolve(provider).then(
                value -> {
                    callback.complete(value);
                    return null;
                },
                error -> {
                    callback.error(new RuntimeException("resolving a handler rejected: " + error));
                    return null;
                });
    }
}
