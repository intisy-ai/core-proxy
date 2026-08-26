package io.github.intisy.ai.js.surface;

import io.github.intisy.ai.tsemit.TsInterface;

/**
 * A host-provided vendor translator, as a TypeScript consumer sees it.
 *
 * @implNote Never implemented, only emitted. This is the shape a transpiled vendor translator's own
 * string functions already have, so a caller passes that module's exports straight through.
 */
@TsInterface
public interface CoreProxyJsTranslator {

    /** Vendor wire JSON to an IR request. */
    String decodeRequest(String wireJson);

    /** An IR request to vendor wire JSON. */
    String encodeRequest(String irRequestJson);

    /** Vendor wire JSON to an IR response. */
    String decodeResponse(String wireJson);

    /** An IR response to vendor wire JSON. */
    String encodeResponse(String irResponseJson);

    /** Opens a decode handle for one connection's stream. */
    CoreProxyJsStreamDecoder newStreamDecoder();

    /** Opens an encode handle for one connection's stream. */
    CoreProxyJsStreamEncoder newStreamEncoder();
}
