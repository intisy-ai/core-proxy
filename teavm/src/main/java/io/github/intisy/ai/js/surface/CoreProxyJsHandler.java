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

    /** Handles one IR request, resolving the IR response's JSON. */
    @TsOptional
    CompletionStage<String> handleIr(String irRequestJson, String ctxJson);

    /** Handles one IR request as a stream of IR events. */
    @TsOptional
    CoreProxyJsIrStream handleIrStream(String irRequestJson, String ctxJson);

    /**
     * Handles one request on the app-wire path.
     *
     * @implNote A {@code {method,url,headers,body}} request in, a {@code {status,headers,body}} out.
     */
    @TsOptional
    CompletionStage<String> handle(String requestJson, String ctxJson);
}
