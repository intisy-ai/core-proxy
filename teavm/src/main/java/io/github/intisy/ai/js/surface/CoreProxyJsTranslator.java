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

    /**
     * Vendor wire JSON to an IR request.
     *
     * @param wireJson the request in the vendor's own format
     * @return the canonical IR request
     */
    String decodeRequest(String wireJson);

    /**
     * An IR request to vendor wire JSON.
     *
     * @param irRequestJson the canonical IR request
     * @return the request in the vendor's own format
     */
    String encodeRequest(String irRequestJson);

    /**
     * Vendor wire JSON to an IR response.
     *
     * @param wireJson the response in the vendor's own format
     * @return the canonical IR response
     */
    String decodeResponse(String wireJson);

    /**
     * An IR response to vendor wire JSON.
     *
     * @param irResponseJson the canonical IR response
     * @return the response in the vendor's own format
     */
    String encodeResponse(String irResponseJson);

    /**
     * Opens a decode handle for one connection's stream.
     *
     * @return a handle carrying that connection's decode state
     */
    CoreProxyJsStreamDecoder newStreamDecoder();

    /**
     * Opens an encode handle for one connection's stream.
     *
     * @return a handle carrying that connection's encode state
     */
    CoreProxyJsStreamEncoder newStreamEncoder();
}
