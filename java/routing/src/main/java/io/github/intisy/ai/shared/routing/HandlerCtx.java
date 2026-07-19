package io.github.intisy.ai.shared.routing;

import io.github.intisy.ai.shared.spi.Logger;
import io.github.intisy.ai.shared.spi.Store;

/**
 * Context passed to a {@link ProxyHandler} for a single request. {@code store} is the server's
 * injected key/value store; a provider must serve from it rather than self-assembling its own. It is
 * {@code null} only for a store-less host, where a provider may fall back to its own store.
 */
public class HandlerCtx {
    public String configDir;
    public Store store;
    public Logger log;
    public String model;

    public HandlerCtx() {
    }

    public HandlerCtx(String configDir, Logger log, String model) {
        this.configDir = configDir;
        this.log = log;
        this.model = model;
    }

    public HandlerCtx(String configDir, Store store, Logger log, String model) {
        this.configDir = configDir;
        this.store = store;
        this.log = log;
        this.model = model;
    }
}
