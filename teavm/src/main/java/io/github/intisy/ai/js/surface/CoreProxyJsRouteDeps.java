package io.github.intisy.ai.js.surface;

import io.github.intisy.ai.tsemit.TsInterface;
import io.github.intisy.ai.tsemit.TsNullable;
import io.github.intisy.ai.tsemit.TsOptional;
import io.github.intisy.ai.tsemit.TsProperty;
import io.github.intisy.ai.tsemit.TsUnion;
import java.util.concurrent.CompletionStage;

/**
 * Every seam a production route needs from the host, as a TypeScript consumer sees it.
 *
 * @implNote Never implemented, only emitted. The store and the provider list are properties because
 * the host hands over values; everything else is a call the router makes back out.
 */
@TsInterface
public interface CoreProxyJsRouteDeps {

    /** Where the router reads its tiers, its model map and its rate-limit state. */
    @TsProperty
    CoreProxyJsStore store();

    /** Absent on a wire-only profile, which routes through a handler's own wire path instead. */
    @TsProperty
    @TsOptional
    CoreProxyJsTranslator translator();

    /** Resolves a provider's handler, or null when that provider has none. */
    @TsUnion({"CoreProxyJsHandler", "null"})
    CompletionStage<CoreProxyJsHandler> resolveHandler(String provider);

    /** Shows the operator a message. */
    void notify(String message, @TsNullable String level);

    /** Records a routing event structurally, alongside the message notify shows. */
    void event(String action, String impact, String detailsJson);

    /**
     * Builds this app's native rate-limit response.
     *
     * @implNote Takes {@code {resetMs, now, upstreamStatus, upstreamHeaders, upstreamBody}} and
     * returns {@code {status, headers, body}}. It can be synchronous on the host side, because the
     * upstream body has already been read by the time it is called.
     */
    CompletionStage<String> nativeRateLimit(String infoJson);

    /** Receives each already-encoded wire frame of a streamed body, in order. */
    void emit(String frame);

    /** Called once a streamed body ends, with the failure that ended it or null. */
    void close(@TsNullable String error);

    /** Every provider the router may route to. */
    @TsProperty
    String[] providers();
}
