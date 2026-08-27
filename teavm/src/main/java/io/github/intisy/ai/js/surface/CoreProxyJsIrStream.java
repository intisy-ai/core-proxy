package io.github.intisy.ai.js.surface;

import io.github.intisy.ai.tsemit.TsInterface;
import io.github.intisy.ai.tsemit.TsUnion;
import java.util.concurrent.CompletionStage;

/**
 * A host-provided IR event stream, pulled one event at a time, as a TypeScript consumer sees it.
 *
 * @implNote Never implemented, only emitted. A pull interface rather than an iterable, because the
 * router consuming it is transpiled Java with no for-await.
 */
@TsInterface
public interface CoreProxyJsIrStream {

    /**
     * Pulls the next event.
     *
     * @return the next IR event's JSON, or null once the stream has ended
     */
    @TsUnion({"string", "null"})
    CompletionStage<String> next();
}
