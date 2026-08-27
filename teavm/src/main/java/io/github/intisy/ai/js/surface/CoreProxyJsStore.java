package io.github.intisy.ai.js.surface;

import io.github.intisy.ai.tsemit.TsInterface;
import io.github.intisy.ai.tsemit.TsNullable;

/**
 * A host-provided key-value store the router reads and writes, as a TypeScript consumer sees it.
 *
 * @implNote Never implemented, only emitted: the Java bridge it describes speaks JSO types that mean
 * nothing to a TypeScript caller. Every member is synchronous, because the router calls them from
 * transpiled Java that has no way to await.
 */
@TsInterface
public interface CoreProxyJsStore {

    /**
     * Reads one key.
     *
     * @param key the key to read
     * @return the stored value, or null when the key is absent or unreadable
     */
    @TsNullable(asNull = true)
    String get(String key);

    /**
     * Stores a value, silently doing nothing when the write is impossible.
     *
     * @param key the key to write
     * @param value what to store under it
     */
    void put(String key, String value);

    /**
     * Tests for a key.
     *
     * @param key the key to test
     * @return whether it is present
     */
    boolean exists(String key);

    /**
     * Removes the key, silently doing nothing when it is absent.
     *
     * @param key the key to remove
     */
    void delete(String key);

    /**
     * Lists a subtree.
     *
     * @param prefix the prefix to list under
     * @return every key under it
     */
    String[] listKeys(String prefix);
}
