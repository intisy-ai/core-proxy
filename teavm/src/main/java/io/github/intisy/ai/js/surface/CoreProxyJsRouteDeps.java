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

    /**
     * Where the router reads its tiers, its model map and its rate-limit state.
     *
     * @return the host's store
     */
    @TsProperty
    CoreProxyJsStore store();

    /**
     * Absent on a wire-only profile, which routes through a handler's own wire path instead.
     *
     * @return the app-to-IR translator, or absent when there is none
     */
    @TsProperty
    @TsOptional
    CoreProxyJsTranslator translator();

    /**
     * Resolves a provider's handler.
     *
     * @param provider the provider id a request routed to
     * @return the handler, or null when that provider has none
     */
    @TsUnion({"CoreProxyJsHandler", "null"})
    CompletionStage<CoreProxyJsHandler> resolveHandler(String provider);

    /**
     * Shows the operator a message.
     *
     * @param message the text to show
     * @param level its severity, or null to leave it to the host
     */
    void notify(String message, @TsNullable String level);

    /**
     * Records a routing event structurally, alongside the message notify shows.
     *
     * @param action what happened, as a stable identifier
     * @param impact what it cost the request
     * @param detailsJson the event's own payload
     */
    void event(String action, String impact, String detailsJson);

    /**
     * Builds this app's native rate-limit response.
     *
     * @implNote Takes {@code resetMs, now, upstreamStatus, upstreamHeaders, upstreamBody} and
     * returns {@code status, headers, body}. It can be synchronous on the host side, because the
     * upstream body has already been read by the time it is called.
     *
     * @param infoJson the rate-limit signal, with the upstream response it was read from
     * @return the response to serve, as {@code status, headers, body}
     */
    CompletionStage<String> nativeRateLimit(String infoJson);

    /**
     * Receives each already-encoded wire frame of a streamed body, in order.
     *
     * @param frame one encoded frame
     */
    void emit(String frame);

    /**
     * Called once a streamed body ends.
     *
     * @param error the failure that ended it, or null on a clean end
     */
    void close(@TsNullable String error);

    /**
     * Every provider the router may route to.
     *
     * @return the provider ids, read fresh on every request
     */
    @TsProperty
    String[] providers();
}
