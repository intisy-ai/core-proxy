package io.github.intisy.ai.js.surface;

import io.github.intisy.ai.tsemit.TsInterface;
import io.github.intisy.ai.tsemit.TsOptional;
import java.util.concurrent.CompletionStage;

/**
 * A host-provided provider handler, as a TypeScript consumer sees it.
 *
 * @implNote Never implemented, only emitted. Every member is optional and the engine reads which are
 * present: a buffered-only handler carries no {@code handleIrStream}, a wire-only one no
 * {@code handleIr}, and an IR-native one no {@code handle}. A handler offering both IR and wire
 * always takes the IR path.
 */
@TsInterface
public interface CoreProxyJsHandler {

    /**
     * Handles one IR request, resolving the IR response's JSON.
     *
     * @param irRequestJson the canonical IR request
     * @param ctxJson the per-request runtime the router supplies
     * @return the IR response's JSON
     */
    @TsOptional
    CompletionStage<String> handleIr(String irRequestJson, String ctxJson);

    /**
     * Handles one IR request as a stream of IR events.
     *
     * @param irRequestJson the canonical IR request
     * @param ctxJson the per-request runtime the router supplies
     * @return the stream, pulled one event at a time
     */
    @TsOptional
    CoreProxyJsIrStream handleIrStream(String irRequestJson, String ctxJson);

    /**
     * Handles one request on the app-wire path.
     *
     * @param requestJson the request as {@code method,url,headers,body}
     * @param ctxJson the per-request runtime the router supplies
     * @return the response as {@code status,headers,body}
     * @implNote A {@code method,url,headers,body} request in, a {@code status,headers,body} out.
     */
    @TsOptional
    CompletionStage<String> handle(String requestJson, String ctxJson);
}
