package io.github.intisy.ai.shared.logic;

import io.github.intisy.ai.api.seam.HttpRequest;
import io.github.intisy.ai.api.seam.HttpResponse;
import io.github.intisy.ai.ir.IrRequest;
import io.github.intisy.ai.ir.IrResponse;
import io.github.intisy.ai.ir.spi.HandleIrException;
import io.github.intisy.ai.ir.spi.HandlerCtx;
import io.github.intisy.ai.ir.spi.IrHandler;
import io.github.intisy.ai.ir.spi.IrStreamHandler;
import io.github.intisy.ai.ir.spi.Translator;
import io.github.intisy.ai.ir.stream.IrEventSource;
import io.github.intisy.ai.ir.stream.IrStreamEvent;
import io.github.intisy.ai.ir.stream.MessageStopEvent;
import io.github.intisy.ai.ir.stream.TextDeltaEvent;
import io.github.intisy.ai.seam.InMemoryStore;
import io.github.intisy.ai.seam.NoopLogger;
import io.github.intisy.ai.seam.SimpleJsonCodec;
import io.github.intisy.ai.shared.routing.Assignment;
import io.github.intisy.ai.shared.routing.HandlerResolver;
import io.github.intisy.ai.shared.routing.RoutingProfile;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Proves the Router's streamed IR path: a request whose {@code stream} flag is set reaches an
 * {@link IrStreamHandler}, its events are encoded one frame at a time through the profile's
 * {@code StreamEncoder}, and the response carries them on {@code bodyStream} rather than buffering
 * them into {@code body}.
 *
 * <p>Also pins the retryability rule the streamed path turns on: a failure BEFORE the first event
 * still advances the fallback chain, because nothing has reached the wire yet, while a failure after
 * it cannot.
 */
class StreamRouterTest {

    private static final String CONFIG_FILE = "stream-router-test.json";

    // -- the streamed happy path ----------------------------------------------

    @Test
    void streamsEventsThroughTheEncoderWithoutBuffering() {
        InMemoryStore store = seededStore("ok");
        HttpResponse resp = route(store, resolver(new StreamingProvider("ok", "Hel", "lo")), providers("ok"));

        assertEquals(200, resp.status);
        assertEquals("text/event-stream", resp.headers.get("content-type"));
        // The body is the stream, not a buffer: a caller that read `body` would send nothing.
        assertNull(resp.body);
        assertNotNull(resp.bodyStream);

        assertEquals("frame0:text_delta:Hel", resp.bodyStream.next());
        assertEquals("frame1:text_delta:lo", resp.bodyStream.next());
        assertEquals("frame2:message_stop:", resp.bodyStream.next());
        assertNull(resp.bodyStream.next());
    }

    @Test
    void pullsTheFirstEventEagerlyAndReplaysIt() {
        InMemoryStore store = seededStore("ok");
        StreamingProvider provider = new StreamingProvider("ok", "one");
        HttpResponse resp = route(store, resolver(provider), providers("ok"));

        // route() already pulled the first event to decide retryability, before anyone read the body.
        assertEquals(1, provider.source.pulls);
        // It is replayed rather than dropped.
        assertEquals("frame0:text_delta:one", resp.bodyStream.next());
        assertEquals("frame1:message_stop:", resp.bodyStream.next());
        assertNull(resp.bodyStream.next());
    }

    // -- the retryability rule ------------------------------------------------

    @Test
    void aFailureBeforeTheFirstEventStillAdvancesTheChain() {
        InMemoryStore store = seededStore("limited", "ok");
        StreamingProvider healthy = new StreamingProvider("ok", "served");
        HandlerResolver resolver = name -> "limited".equals(name)
                ? new RateLimitedStreamProvider("limited")
                : healthy;

        HttpResponse resp = route(store, resolver, providers("limited", "ok"));

        // The 429 arrived before any event, so the chain advanced and the fallback served.
        assertEquals(200, resp.status);
        assertNotNull(resp.bodyStream);
        assertEquals("frame0:text_delta:served", resp.bodyStream.next());
    }

    @Test
    void aFailureAfterTheFirstEventSurfacesInTheStream() {
        InMemoryStore store = seededStore("ok");
        HttpResponse resp = route(store, resolver(new FailsMidStreamProvider("ok")), providers("ok"));

        // Status and headers were already committed, so the chain cannot advance: the response is a
        // successful stream whose failure can only appear once it is being read.
        assertEquals(200, resp.status);
        assertEquals("frame0:text_delta:partial", resp.bodyStream.next());
        RuntimeException thrown = assertThrows(RuntimeException.class, () -> resp.bodyStream.next());
        assertTrue(thrown.getMessage().contains("upstream died mid-stream"), thrown.getMessage());
    }

    @Test
    void aTranslatorThatCannotStreamIsSurfacedRatherThanDowngraded() {
        InMemoryStore store = seededStore("ok");
        RoutingProfile profile = profile(new NonStreamingTranslator(new SimpleJsonCodec()));
        RouterOptions opts = options(store, profile, resolver(new StreamingProvider("ok", "x")), providers("ok"));

        HttpResponse resp = Router.route(post(streamingBody()), opts);

        // Not a fall-through to the app-wire path, which would answer SSE with a buffered body.
        assertEquals(502, resp.status);
    }

    @Test
    void aTypedFailureOnTheFIRSTPullAlsoAdvancesTheChain() {
        // The shape the JS bridge actually produces: handleIrStream returns a source, and the 429
        // only surfaces when that source is first pulled. Router's eager first pull is what turns
        // this into a retryable outcome instead of a mid-stream death.
        InMemoryStore store = seededStore("limited", "ok");
        StreamingProvider healthy = new StreamingProvider("ok", "served");
        HandlerResolver resolver = name -> "limited".equals(name)
                ? new FailsOnFirstPullProvider("limited")
                : healthy;

        HttpResponse resp = route(store, resolver, providers("limited", "ok"));

        assertEquals(200, resp.status);
        assertEquals("frame0:text_delta:served", resp.bodyStream.next());
    }

    // -- the non-streamed path is untouched -----------------------------------

    @Test
    void aNonStreamRequestStillTakesTheBufferedPath() {
        InMemoryStore store = seededStore("ok");
        RouterOptions opts = options(store, profile(new TestTranslator(new SimpleJsonCodec())),
                resolver(new StreamingProvider("ok", "unused")), providers("ok"));

        HttpResponse resp = Router.route(post(bufferedBody()), opts);

        assertEquals(200, resp.status);
        assertNull(resp.bodyStream);
        assertTrue(resp.body.contains("buffered reply"), resp.body);
    }

    @Test
    void aStreamRequestToaHandlerThatCannotStreamTakesTheBufferedPath() {
        InMemoryStore store = seededStore("ok");
        // Not an IrStreamHandler, so the stream flag has nothing to select and handleIr serves it.
        RouterOptions opts = options(store, profile(new TestTranslator(new SimpleJsonCodec())),
                resolver(new BufferedOnlyProvider("ok")), providers("ok"));

        HttpResponse resp = Router.route(post(streamingBody()), opts);

        assertEquals(200, resp.status);
        assertNull(resp.bodyStream);
        assertTrue(resp.body.contains("buffered reply"), resp.body);
    }

    // -- the request target ---------------------------------------------------

    @Test
    void servesTheCatalogForABarePathAndForAnAbsoluteUrl() {
        InMemoryStore store = seededStore("ok");
        RouterOptions opts = options(store, profile(new TestTranslator(new SimpleJsonCodec())),
                resolver(new StreamingProvider("ok", "unused")), providers("ok"));

        HttpRequest bare = post(bufferedBody());
        bare.method = "GET";
        bare.url = "/v1/models";
        assertEquals(200, Router.route(bare, opts).status);

        // An absolute URL must not fall through to routing, which would answer 503 while
        // /v1/messages kept working, hiding the mistake.
        HttpRequest absolute = post(bufferedBody());
        absolute.method = "GET";
        absolute.url = "http://localhost:34567/v1/models";
        assertEquals(200, Router.route(absolute, opts).status);

        HttpRequest health = post("");
        health.method = "GET";
        health.url = "http://localhost:34567/health";
        assertEquals(200, Router.route(health, opts).status);
    }

    // -- harness --------------------------------------------------------------

    private static HttpResponse route(InMemoryStore store, HandlerResolver resolver, List<String> providers) {
        RouterOptions opts = options(store, profile(new TestTranslator(new SimpleJsonCodec())), resolver, providers);
        return Router.route(post(streamingBody()), opts);
    }

    private static String streamingBody() {
        return "{\"model\":\"claude-opus-4\",\"stream\":true,\"messages\":[{\"role\":\"user\",\"content\":\"hi\"}]}";
    }

    private static String bufferedBody() {
        return "{\"model\":\"claude-opus-4\",\"stream\":false,\"messages\":[{\"role\":\"user\",\"content\":\"hi\"}]}";
    }

    private static List<String> providers(String... names) {
        return Arrays.asList(names);
    }

    private static HandlerResolver resolver(IrHandler handler) {
        return name -> handler;
    }

    /** Seeds the model catalog and the tier mapping so the chain resolves to {@code providers}. */
    private static InMemoryStore seededStore(String... providerNames) {
        InMemoryStore store = new InMemoryStore();
        SimpleJsonCodec json = new SimpleJsonCodec();

        Map<String, Object> models = new LinkedHashMap<>();
        List<Object> chain = new ArrayList<>();
        for (String provider : providerNames) {
            Map<String, Object> entry = new LinkedHashMap<>();
            Map<String, Object> byId = new LinkedHashMap<>();
            Map<String, Object> info = new LinkedHashMap<>();
            info.put("name", provider + " opus");
            byId.put("claude-opus-4", info);
            entry.put("ranking", Collections.singletonList("claude-opus-4"));
            entry.put("models", byId);
            models.put(provider, entry);

            Map<String, Object> assignment = new LinkedHashMap<>();
            assignment.put("provider", provider);
            assignment.put("model", "claude-opus-4");
            chain.add(assignment);
        }
        store.put("models.json", json.stringify(models));

        Map<String, Object> routing = new LinkedHashMap<>();
        routing.put("opus", chain);
        Map<String, Object> root = new LinkedHashMap<>();
        root.put("providerRouting", routing);
        store.put(CONFIG_FILE, json.stringify(root));
        return store;
    }

    private static RoutingProfile profile(Translator translator) {
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
            s.body = "{\"type\":\"error\",\"error\":{\"type\":\"rate_limit_error\"}}";
            return s;
        };
        p.translator = translator;
        return p;
    }

    private static RouterOptions options(InMemoryStore store, RoutingProfile profile,
                                        HandlerResolver resolver, List<String> providers) {
        RouterOptions opts = new RouterOptions();
        opts.profile = profile;
        opts.resolveHandler = resolver;
        opts.store = store;
        opts.json = new SimpleJsonCodec();
        opts.clock = () -> 1_000_000L;
        opts.log = NoopLogger.INSTANCE;
        opts.notify = (message, level) -> {
        };
        opts.listProviders = () -> providers;
        opts.configDir = "";
        return opts;
    }

    private static HttpRequest post(String body) {
        HttpRequest req = new HttpRequest();
        req.method = "POST";
        req.url = "http://localhost:34567/v1/messages";
        req.headers = new HashMap<>();
        req.body = body;
        return req;
    }

    // -- doubles --------------------------------------------------------------

    /** Yields one text delta per supplied chunk, then a message stop, counting its own pulls. */
    private static final class ListEventSource implements IrEventSource {
        private final List<IrStreamEvent> events = new ArrayList<>();
        private int cursor;
        int pulls;

        ListEventSource(String... texts) {
            for (int i = 0; i < texts.length; i++) {
                TextDeltaEvent delta = new TextDeltaEvent();
                delta.index = i;
                delta.text = texts[i];
                events.add(delta);
            }
            events.add(new MessageStopEvent());
        }

        @Override
        public IrStreamEvent next() {
            pulls++;
            return cursor < events.size() ? events.get(cursor++) : null;
        }
    }

    private static class StreamingProvider implements IrStreamHandler {
        private final String id;
        final ListEventSource source;

        StreamingProvider(String id, String... texts) {
            this.id = id;
            this.source = new ListEventSource(texts);
        }

        @Override
        public String id() {
            return id;
        }

        @Override
        public IrResponse handleIr(IrRequest request, HandlerCtx ctx) {
            return bufferedReply(ctx);
        }

        @Override
        public IrEventSource handleIrStream(IrRequest request, HandlerCtx ctx) {
            return source;
        }
    }

    /** Streams nothing: throws a 429 before the first event, so the chain may still advance. */
    private static final class RateLimitedStreamProvider implements IrStreamHandler {
        private final String id;

        RateLimitedStreamProvider(String id) {
            this.id = id;
        }

        @Override
        public String id() {
            return id;
        }

        @Override
        public IrResponse handleIr(IrRequest request, HandlerCtx ctx) {
            throw new UnsupportedOperationException("stream only");
        }

        @Override
        public IrEventSource handleIrStream(IrRequest request, HandlerCtx ctx) throws HandleIrException {
            Map<String, String> headers = new LinkedHashMap<>();
            headers.put("retry-after", "1");
            throw new HandleIrException(429, headers, "{\"error\":\"rate limited\"}", 1000L);
        }
    }

    /** Returns a source that throws a typed 429 on its very first pull, nothing yet on the wire. */
    private static final class FailsOnFirstPullProvider implements IrStreamHandler {
        private final String id;

        FailsOnFirstPullProvider(String id) {
            this.id = id;
        }

        @Override
        public String id() {
            return id;
        }

        @Override
        public IrResponse handleIr(IrRequest request, HandlerCtx ctx) {
            throw new UnsupportedOperationException("stream only");
        }

        @Override
        public IrEventSource handleIrStream(IrRequest request, HandlerCtx ctx) {
            return () -> {
                Map<String, String> headers = new LinkedHashMap<>();
                headers.put("retry-after", "1");
                throw new HandleIrException(429, headers, "{\"error\":\"rate limited\"}", 1000L);
            };
        }
    }

    /** Delivers one event, then fails: the point past which the chain cannot advance. */
    private static final class FailsMidStreamProvider implements IrStreamHandler {
        private final String id;

        FailsMidStreamProvider(String id) {
            this.id = id;
        }

        @Override
        public String id() {
            return id;
        }

        @Override
        public IrResponse handleIr(IrRequest request, HandlerCtx ctx) {
            throw new UnsupportedOperationException("stream only");
        }

        @Override
        public IrEventSource handleIrStream(IrRequest request, HandlerCtx ctx) {
            return new IrEventSource() {
                private int pulls;

                @Override
                public IrStreamEvent next() {
                    if (pulls++ == 0) {
                        TextDeltaEvent delta = new TextDeltaEvent();
                        delta.text = "partial";
                        return delta;
                    }
                    throw new RuntimeException("upstream died mid-stream");
                }
            };
        }
    }

    /** Serves only the buffered path, so a stream request has no streaming handler to select. */
    private static final class BufferedOnlyProvider implements IrHandler {
        private final String id;

        BufferedOnlyProvider(String id) {
            this.id = id;
        }

        @Override
        public String id() {
            return id;
        }

        @Override
        public IrResponse handleIr(IrRequest request, HandlerCtx ctx) {
            return bufferedReply(ctx);
        }
    }

    private static IrResponse bufferedReply(HandlerCtx ctx) {
        IrResponse resp = new IrResponse();
        resp.id = "msg_buffered";
        resp.model = ctx.model;
        resp.stopReason = "end_turn";
        List<io.github.intisy.ai.ir.Block> content = new ArrayList<>();
        content.add(new io.github.intisy.ai.ir.TextBlock("buffered reply"));
        resp.content = content;
        return resp;
    }

    /**
     * A translator with no streaming support, the misconfiguration the Router must surface.
     * Delegates the rest to {@link TestTranslator} rather than subclassing it, which is final.
     */
    private static final class NonStreamingTranslator implements Translator {
        private final TestTranslator delegate;

        NonStreamingTranslator(io.github.intisy.ai.api.seam.JsonCodec codec) {
            this.delegate = new TestTranslator(codec);
        }

        @Override
        public IrRequest decodeRequest(String wireJson) {
            return delegate.decodeRequest(wireJson);
        }

        @Override
        public String encodeRequest(IrRequest request) {
            return delegate.encodeRequest(request);
        }

        @Override
        public IrResponse decodeResponse(String wireJson) {
            return delegate.decodeResponse(wireJson);
        }

        @Override
        public String encodeResponse(IrResponse response) {
            return delegate.encodeResponse(response);
        }

        @Override
        public io.github.intisy.ai.ir.spi.StreamDecoder newStreamDecoder() {
            throw new UnsupportedOperationException("no streaming here");
        }

        @Override
        public io.github.intisy.ai.ir.spi.StreamEncoder newStreamEncoder() {
            throw new UnsupportedOperationException("no streaming here");
        }
    }
}
