package io.github.intisy.ai.shared.logic;

import io.github.intisy.ai.api.seam.HttpRequest;
import io.github.intisy.ai.api.seam.HttpResponse;
import io.github.intisy.ai.ir.IrRequest;
import io.github.intisy.ai.ir.IrResponse;
import io.github.intisy.ai.ir.spi.HandlerCtx;
import io.github.intisy.ai.ir.spi.IrHandler;
import io.github.intisy.ai.shared.routing.HandlerResolver;
import io.github.intisy.ai.shared.routing.ProxyHandler;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Supplier;

/**
 * Factory methods for creating {@link HandlerResolver} implementations. Java providers are compiled
 * classes rather than dynamically imported modules, so resolution is a registry lookup.
 */
public final class HandlerResolvers {

    private HandlerResolvers() {
    }

    /**
     * Creates a {@link HandlerResolver} that resolves handlers from a fixed registry.
     * The registry is defensively copied so external mutations do not leak in.
     *
     * @param registry a map from handler name to {@link IrHandler}
     * @return a resolver that looks up handlers by name
     */
    public static HandlerResolver fromRegistry(Map<String, IrHandler> registry) {
        Map<String, IrHandler> copy = new HashMap<>(registry);
        return new HandlerResolver() {
            @Override
            public IrHandler resolve(String provider) {
                return copy.get(provider);
            }
        };
    }

    /**
     * Creates a {@link HandlerResolver} that resolves handlers from a dynamically
     * supplied map. The supplier is called on each {@code resolve()} call, allowing
     * the underlying registry to be mutated between calls (useful for servers that
     * register providers dynamically).
     *
     * @param supplier a function that returns a map from handler name to {@link IrHandler}
     * @return a resolver that re-reads from the supplier each time
     */
    public static HandlerResolver fromSupplier(Supplier<Map<String, IrHandler>> supplier) {
        return new HandlerResolver() {
            @Override
            public IrHandler resolve(String provider) {
                Map<String, IrHandler> current = supplier.get();
                if (current == null) return null;
                return current.get(provider);
            }
        };
    }

    /**
     * Adapts a list of {@link IrHandler} SPI instances (JVM: discovered via
     * {@code ServiceLoader.load(IrHandler.class)}; TeaVM: instantiated directly by the JS host)
     * into a {@link HandlerResolver}, keyed by each handler's own {@link IrHandler#id()}, so no
     * separate registration map is needed since a handler already carries its id.
     * Last-registered-wins on a duplicate id, consistent with {@link #fromRegistry}'s plain
     * {@code Map.put} semantics.
     *
     * @param handlers the discovered/registered {@link IrHandler} instances
     * @return a resolver that looks up a handler by id
     */
    public static HandlerResolver fromHandlers(List<IrHandler> handlers) {
        Map<String, IrHandler> registry = new HashMap<>();
        for (IrHandler handler : handlers) {
            registry.put(handler.id(), handler);
        }
        return fromRegistry(registry);
    }

    /**
     * Adapts wire-only handlers, which serve {@link ProxyHandler#handle} and have no IR path at all,
     * into a {@link HandlerResolver}.
     *
     * @implNote The engine resolves an {@link IrHandler}, so a wire-only handler reaches it wrapped in
     * one whose {@code handleIr} refuses. That is the same signal the Router already falls back on,
     * and it keeps the app-wire path available without a second resolver nothing in this ecosystem
     * would supply: every handler here is IR-native.
     *
     * @param registry a map from handler name to the wire-only {@link ProxyHandler} serving it
     * @return a resolver that looks up a wire-only handler by name
     */
    public static HandlerResolver fromWireHandlers(Map<String, ProxyHandler> registry) {
        Map<String, IrHandler> wrapped = new HashMap<>();
        for (Map.Entry<String, ProxyHandler> entry : registry.entrySet()) {
            wrapped.put(entry.getKey(), new WireOnly(entry.getKey(), entry.getValue()));
        }
        return fromRegistry(wrapped);
    }

    private static final class WireOnly implements IrHandler, ProxyHandler {
        private final String id;
        private final ProxyHandler wire;

        WireOnly(String id, ProxyHandler wire) {
            this.id = id;
            this.wire = wire;
        }

        @Override
        public String id() {
            return id;
        }

        @Override
        public IrResponse handleIr(IrRequest request, HandlerCtx ctx) {
            throw new UnsupportedOperationException(id + " has no handleIr, call handle instead");
        }

        @Override
        public HttpResponse handle(HttpRequest req, HandlerCtx ctx) throws Exception {
            return wire.handle(req, ctx);
        }
    }
}
