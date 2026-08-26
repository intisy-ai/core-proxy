package io.github.intisy.ai.js.surface;

import io.github.intisy.ai.tsemit.TsInterface;

/**
 * A host-provided stream decode handle, as a TypeScript consumer sees it.
 *
 * @implNote Never implemented, only emitted. Named rather than inlined into
 * {@link CoreProxyJsTranslator}, because the processor emits a type reference and an anonymous shape
 * has no name to reference.
 */
@TsInterface
public interface CoreProxyJsStreamDecoder {

    /** Feeds one raw vendor chunk and returns the IR events it completed, as a JSON array. */
    String decode(String chunk);
}
