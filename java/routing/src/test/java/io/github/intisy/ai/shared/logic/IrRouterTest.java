package io.github.intisy.ai.shared.logic;

import io.github.intisy.ai.ir.IrMessage;
import io.github.intisy.ai.ir.IrRequest;
import io.github.intisy.ai.ir.IrResponse;
import io.github.intisy.ai.ir.TextBlock;
import io.github.intisy.ai.ir.spi.Translator;
import io.github.intisy.ai.ir.translators.anthropic.AnthropicTranslator;
import io.github.intisy.ai.shared.routing.HandleIrException;
import io.github.intisy.ai.shared.routing.HandlerCtx;
import io.github.intisy.ai.shared.routing.HandlerResolver;
import io.github.intisy.ai.shared.routing.Provider;
import io.github.intisy.ai.shared.routing.RoutingProfile;
import io.github.intisy.ai.shared.store.InMemoryStore;
import io.github.intisy.ai.shared.store.TestJsonCodec;
import io.github.intisy.ai.shared.spi.http.HttpRequest;
import io.github.intisy.ai.shared.spi.http.HttpResponse;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.regex.Pattern;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * SP-3 T1: proves the Router's IR front door end to end (an inbound Anthropic-wire request is
 * decoded to the canonical IR via {@link RoutingProfile#translator}, routed on {@code IrRequest
 * .model}, handed to a {@link Provider#handleIr}, and the returned {@link IrResponse} is encoded
 * back to Anthropic wire) alongside the fallback that keeps a legacy handle()-only provider
 * working unchanged even when the profile DOES carry a translator (coexist-then-remove).
 */
class IrRouterTest {

    private static final String CONFIG_FILE = "ir-router-test.json";

    private static RoutingProfile testProfile(Translator translator) {
        RoutingProfile p = new RoutingProfile();
        p.configFile = CONFIG_FILE;
        p.routingKey = "providerRouting";
        p.tierSourceProvider = "ok";
        p.tierOrder = Collections.singletonList("opus");
        p.tierFallback = Collections.singletonList("opus");
        p.tierRegex = Pattern.compile("^claude-([a-z]+)-\\d");
        p.envPrefix = "ANTHROPIC";
        p.defaultContext = 200000;
        p.defaultOutput = 64000;
        p.nativeRateLimit = info -> {
            RoutingProfile.Synth s = new RoutingProfile.Synth();
            s.status = 429;
            s.headers = new HashMap<>();
            s.body = "{\"type\":\"error\",\"error\":{\"type\":\"rate_limit_error\",\"message\":\"rate limited\"}}";
            return s;
        };
        p.translator = translator;
        return p;
    }

    private static RouterOptions baseOptions(InMemoryStore store, RoutingProfile profile, HandlerResolver resolver, List<String> providers) {
        RouterOptions opts = new RouterOptions();
        opts.profile = profile;
        opts.resolveHandler = resolver;
        opts.store = store;
        opts.json = new TestJsonCodec();
        opts.clock = () -> 1_000_000L;
        opts.log = msg -> {
        };
        opts.notify = (message, level) -> {
        };
        opts.listProviders = () -> providers;
        opts.configDir = "";
        return opts;
    }

    private static HttpRequest post(String url, String body) {
        HttpRequest req = new HttpRequest();
        req.method = "POST";
        req.url = url;
        req.headers = new HashMap<>();
        req.body = body;
        return req;
    }

    /** An IR-native echo provider: handleIr overridden, handle() left as the Provider default's
     *  legacy signature but never expected to be called by this test. */
    private static final class EchoIrProvider implements Provider {
        private final String id;

        EchoIrProvider(String id) {
            this.id = id;
        }

        @Override
        public String id() {
            return id;
        }

        @Override
        public HttpResponse handle(HttpRequest req, HandlerCtx ctx) {
            throw new AssertionError("legacy handle() must not be called when the IR path is taken");
        }

        @Override
        public IrResponse handleIr(IrRequest request, HandlerCtx ctx) {
            IrResponse resp = new IrResponse();
            resp.id = "msg_echo";
            resp.model = ctx.model;
            resp.stopReason = "end_turn";
            TextBlock echoed = new TextBlock("handled via IR: " + firstUserText(request));
            List<io.github.intisy.ai.ir.Block> content = new ArrayList<>();
            content.add(echoed);
            resp.content = content;
            return resp;
        }

        private static String firstUserText(IrRequest request) {
            if (request.messages == null) return "";
            for (IrMessage m : request.messages) {
                if (!"user".equals(m.role) || m.content == null) continue;
                for (io.github.intisy.ai.ir.Block b : m.content) {
                    if (b instanceof TextBlock) return ((TextBlock) b).text;
                }
            }
            return "";
        }
    }

    /** A legacy Provider that only implements handle() -- handleIr is left as Provider's default
     *  (throws UnsupportedOperationException), proving the Router's fallback. */
    private static final class LegacyOnlyProvider implements Provider {
        @Override
        public String id() {
            return "legacy";
        }

        @Override
        public HttpResponse handle(HttpRequest req, HandlerCtx ctx) {
            HttpResponse resp = new HttpResponse();
            resp.status = 200;
            resp.headers = new HashMap<>();
            resp.body = "served " + ctx.model;
            return resp;
        }
    }

    /** An IR-native provider whose handleIr always throws (either a {@link HandleIrException} or
     *  a plain exception, per the test), proving the Router's typed-vs-unexpected-throw handling. */
    private static final class ThrowingIrProvider implements Provider {
        private final String id;
        private final Exception toThrow;
        final AtomicBoolean called = new AtomicBoolean(false);

        ThrowingIrProvider(String id, Exception toThrow) {
            this.id = id;
            this.toThrow = toThrow;
        }

        @Override
        public String id() {
            return id;
        }

        @Override
        public HttpResponse handle(HttpRequest req, HandlerCtx ctx) {
            throw new AssertionError("legacy handle() must not be called when the IR path is taken");
        }

        @Override
        public IrResponse handleIr(IrRequest request, HandlerCtx ctx) throws Exception {
            called.set(true);
            throw toThrow;
        }
    }

    private static Translator anthropicTranslator() {
        return new AnthropicTranslator(new IrJsonCodecAdapter(new TestJsonCodec()));
    }

    @Test
    void irCapableProvider_decodesRoutesHandlesAndEncodesThroughIr() {
        InMemoryStore store = new InMemoryStore();
        store.put(CONFIG_FILE, "{\"modelMap\":{\"opus\":[{\"provider\":\"ok\",\"model\":\"m-ok\"}]}}");
        RoutingProfile profile = testProfile(anthropicTranslator());
        HandlerResolver resolver = HandlerResolvers.fromProviders(
                Collections.singletonList((Provider) new EchoIrProvider("ok")));
        RouterOptions opts = baseOptions(store, profile, resolver, List.of("ok"));

        String wireRequest = "{\"model\":\"claude-opus-4-1\",\"messages\":"
                + "[{\"role\":\"user\",\"content\":\"hi there\"}],\"stream\":false}";
        HttpResponse resp = Router.route(post("/v1/messages", wireRequest), opts);

        assertEquals(200, resp.status);
        // The Router encoded the provider's IrResponse back to Anthropic wire via the profile's
        // translator -- decode it again to assert on the neutral shape, not a raw string match.
        IrResponse decoded = anthropicTranslator().decodeResponse(resp.body);
        assertEquals("m-ok", decoded.model, "ctx.model (the ASSIGNED model) must reach the provider, matching the legacy handle() contract");
        assertEquals("end_turn", decoded.stopReason);
        assertTrue(decoded.content.get(0) instanceof TextBlock);
        assertEquals("handled via IR: hi there", ((TextBlock) decoded.content.get(0)).text);
    }

    @Test
    void legacyOnlyProvider_stillServesViaHandleFallback_evenWhenProfileHasTranslator() {
        InMemoryStore store = new InMemoryStore();
        store.put(CONFIG_FILE, "{\"modelMap\":{\"opus\":[{\"provider\":\"legacy\",\"model\":\"m-legacy\"}]}}");
        RoutingProfile profile = testProfile(anthropicTranslator());
        HandlerResolver resolver = HandlerResolvers.fromProviders(
                Collections.singletonList((Provider) new LegacyOnlyProvider()));
        RouterOptions opts = baseOptions(store, profile, resolver, List.of("legacy"));

        String wireRequest = "{\"model\":\"claude-opus-4-1\",\"messages\":"
                + "[{\"role\":\"user\",\"content\":\"hi there\"}],\"stream\":false}";
        HttpResponse resp = Router.route(post("/v1/messages", wireRequest), opts);

        assertEquals(200, resp.status);
        // Untranslated, verbatim legacy body -- proves the UnsupportedOperationException fallback
        // reached handle() rather than trying (and failing) to encode anything through the IR.
        assertEquals("served m-legacy", resp.body);
    }

    // T3c-1: a thrown HandleIrException must reconstruct a real HttpResponse and flow through the
    // SAME RateLimit.isRateLimited/fallback/final-429-synthesis logic as a legacy handle() response,
    // instead of collapsing to a flat 502 (which lost status fidelity and broke rate-limit fallback).
    @Test
    void handleIrThrows429TypedException_triggersFallback_thenSynthesizesFinal429() {
        InMemoryStore store = new InMemoryStore();
        store.put(CONFIG_FILE, "{\"modelMap\":{\"opus\":["
                + "{\"provider\":\"primary\",\"model\":\"m-primary\"},"
                + "{\"provider\":\"fallback\",\"model\":\"m-fallback\"}]}}");
        RoutingProfile profile = testProfile(anthropicTranslator());
        ThrowingIrProvider primary = new ThrowingIrProvider("primary",
                new HandleIrException(429, new HashMap<>(), "{\"type\":\"error\"}", 5000L));
        ThrowingIrProvider fallback = new ThrowingIrProvider("fallback",
                new HandleIrException(429, new HashMap<>(), "{\"type\":\"error\"}"));
        HandlerResolver resolver = HandlerResolvers.fromProviders(Arrays.<Provider>asList(primary, fallback));
        RouterOptions opts = baseOptions(store, profile, resolver, List.of("primary", "fallback"));

        String wireRequest = "{\"model\":\"claude-opus-4-1\",\"messages\":"
                + "[{\"role\":\"user\",\"content\":\"hi there\"}],\"stream\":false}";
        HttpResponse resp = Router.route(post("/v1/messages", wireRequest), opts);

        assertTrue(primary.called.get());
        assertTrue(fallback.called.get());
        assertEquals(429, resp.status);
        // Body comes from profile.nativeRateLimit's final synthesis -- proves the fallback +
        // final-429 path ran, not the flat 502 error shape.
        assertTrue(resp.body.contains("rate_limit_error"));
    }

    @Test
    void handleIrThrows400TypedException_surfacesVerbatim_noFallbackAttempted() {
        InMemoryStore store = new InMemoryStore();
        store.put(CONFIG_FILE, "{\"modelMap\":{\"opus\":["
                + "{\"provider\":\"primary\",\"model\":\"m-primary\"},"
                + "{\"provider\":\"fallback\",\"model\":\"m-fallback\"}]}}");
        RoutingProfile profile = testProfile(anthropicTranslator());
        ThrowingIrProvider primary = new ThrowingIrProvider("primary",
                new HandleIrException(400, new HashMap<>(), "{\"type\":\"error\",\"error\":{\"type\":\"invalid_request_error\"}}"));
        ThrowingIrProvider fallback = new ThrowingIrProvider("fallback",
                new RuntimeException("fallback must never be attempted for a non-rate-limit error"));
        HandlerResolver resolver = HandlerResolvers.fromProviders(Arrays.<Provider>asList(primary, fallback));
        RouterOptions opts = baseOptions(store, profile, resolver, List.of("primary", "fallback"));

        String wireRequest = "{\"model\":\"claude-opus-4-1\",\"messages\":"
                + "[{\"role\":\"user\",\"content\":\"hi there\"}],\"stream\":false}";
        HttpResponse resp = Router.route(post("/v1/messages", wireRequest), opts);

        assertTrue(primary.called.get());
        assertFalse(fallback.called.get());
        assertEquals(400, resp.status);
        assertTrue(resp.body.contains("invalid_request_error"));
    }

    @Test
    void handleIrThrowsPlainException_stillCollapsesToFlat502_unchanged() {
        InMemoryStore store = new InMemoryStore();
        store.put(CONFIG_FILE, "{\"modelMap\":{\"opus\":[{\"provider\":\"ok\",\"model\":\"m-ok\"}]}}");
        RoutingProfile profile = testProfile(anthropicTranslator());
        ThrowingIrProvider ok = new ThrowingIrProvider("ok", new RuntimeException("boom"));
        HandlerResolver resolver = HandlerResolvers.fromProviders(Collections.singletonList((Provider) ok));
        RouterOptions opts = baseOptions(store, profile, resolver, List.of("ok"));

        String wireRequest = "{\"model\":\"claude-opus-4-1\",\"messages\":"
                + "[{\"role\":\"user\",\"content\":\"hi there\"}],\"stream\":false}";
        HttpResponse resp = Router.route(post("/v1/messages", wireRequest), opts);

        assertEquals(502, resp.status);
        assertTrue(resp.body.contains("loader_proxy_error"));
    }

    @Test
    void noTranslatorOnProfile_neverAttemptsIrEvenForAnIrCapableProvider() {
        InMemoryStore store = new InMemoryStore();
        store.put(CONFIG_FILE, "{\"modelMap\":{\"opus\":[{\"provider\":\"ok\",\"model\":\"m-ok\"}]}}");
        RoutingProfile profile = testProfile(null); // no translator -> legacy-only, unconditionally
        Provider provider = new Provider() {
            @Override
            public String id() {
                return "ok";
            }

            @Override
            public HttpResponse handle(HttpRequest req, HandlerCtx ctx) {
                HttpResponse resp = new HttpResponse();
                resp.status = 200;
                resp.headers = new HashMap<>();
                resp.body = "served " + ctx.model;
                return resp;
            }

            @Override
            public IrResponse handleIr(IrRequest request, HandlerCtx ctx) {
                throw new AssertionError("handleIr must never be called when the profile has no translator");
            }
        };
        HandlerResolver resolver = HandlerResolvers.fromProviders(Collections.singletonList(provider));
        RouterOptions opts = baseOptions(store, profile, resolver, List.of("ok"));

        String wireRequest = "{\"model\":\"claude-opus-4-1\",\"messages\":[{\"role\":\"user\",\"content\":\"hi\"}]}";
        HttpResponse resp = Router.route(post("/v1/messages", wireRequest), opts);

        assertEquals(200, resp.status);
        assertEquals("served m-ok", resp.body);
    }
}
