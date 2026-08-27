package io.github.intisy.ai.js.surface;

import io.github.intisy.ai.tsemit.TsInterface;

/**
 * A host-provided stream encode handle, as a TypeScript consumer sees it.
 *
 * @implNote Never implemented, only emitted, for the same reason as
 * {@link CoreProxyJsStreamDecoder}.
 */
@TsInterface
public interface CoreProxyJsStreamEncoder {

    /**
     * Encodes one IR stream event to the vendor's wire text.
     *
     * @param irEventJson the IR event
     * @return the wire text to emit
     */
    String encode(String irEventJson);
}
