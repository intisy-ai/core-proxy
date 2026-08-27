package io.github.intisy.ai.js.surface;

import io.github.intisy.ai.tsemit.TsModule;
import java.util.concurrent.CompletionStage;
import java.util.function.Function;

/**
 * The JavaScript module surface {@link io.github.intisy.ai.js.CoreProxyJs} exports, typed for a
 * TypeScript consumer.
 *
 * @implNote Never implemented, only emitted: {@link TsModule} renders its members as free functions,
 * which is the shape a TeaVM ES2015 module actually exports. The {@code Json} variants take the
 * store as a JSON snapshot and are for tests and probes; the live members take
 * {@link CoreProxyJsStore} and are what a running proxy calls.
 */
@TsModule
public interface CoreProxySurface {

    /**
     * Routes one request against a store snapshot, with no host seams and no upstream call.
     *
     * @param storeJson the whole store as one JSON object
     * @param requestJson the request as {@code method,url,headers,body}
     * @return the response as {@code status,headers,body}
     */
    String routeJsonSync(String storeJson, String requestJson);

    /**
     * Parse and stringify with no routing involved, proving the JSON codec crosses TeaVM.
     *
     * @param json any JSON document
     * @return the same document, parsed and stringified again
     */
    String jsonRoundTrip(String json);

    /**
     * Resolves the tier chain against a store snapshot.
     *
     * @param profileJson the routing profile as JSON
     * @param storeJson the whole store as one JSON object
     * @return the tier names as a JSON array
     */
    String resolveTiersJson(String profileJson, String storeJson);

    /**
     * Resolves the model map against a store snapshot.
     *
     * @param profileJson the routing profile as JSON
     * @param storeJson the whole store as one JSON object
     * @return each tier's ordered chain, as JSON
     */
    String resolveModelMapJson(String profileJson, String storeJson);

    /**
     * Resolves the tier chain against a live store.
     *
     * @param profileJson the routing profile as JSON
     * @param jsStore the host's store, read through on demand
     * @return the tier names as a JSON array
     */
    String resolveTiers(String profileJson, CoreProxyJsStore jsStore);

    /**
     * Resolves the model map against a live store.
     *
     * @param profileJson the routing profile as JSON
     * @param jsStore the host's store, read through on demand
     * @return each tier's ordered chain, as JSON
     */
    String resolveModelMap(String profileJson, CoreProxyJsStore jsStore);

    /**
     * Routes one request through a host-provided HTTP transport.
     *
     * @param httpSend the transport, taking the request's JSON and resolving the response's
     * @param jsStore the host's store, read through on demand
     * @param requestJson the request as {@code method,url,headers,body}
     * @return the response as {@code status,headers,body}
     * @implNote The transport takes the request's JSON and resolves the response's, which is the
     * whole seam: the router suspends across it without knowing what performs the call.
     */
    CompletionStage<String> routeJsonAsync(Function<String, CompletionStage<String>> httpSend,
                                           CoreProxyJsStore jsStore,
                                           String requestJson);

    /**
     * Routes one real request through every host seam.
     *
     * @param deps every seam the route needs from the host
     * @param profileJson the routing profile as JSON
     * @param requestJson the request as {@code method,url,headers,body}
     * @return the outcome as {@code status, headers, body, streamed}
     * @implNote Resolves {@code status, headers, body, streamed} as JSON. When {@code streamed} is
     * true the body already went out through the deps' emit and close, and {@code streamError}
     * reports a mid-stream death. The request's url may be a bare path or an absolute URL.
     */
    CompletionStage<String> routeRequest(CoreProxyJsRouteDeps deps, String profileJson, String requestJson);
}
