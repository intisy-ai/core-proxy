package io.github.intisy.ai.shared.logic;

import io.github.intisy.ai.shared.routing.HandlerResolver;
import io.github.intisy.ai.shared.routing.Provider;
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
     * @param registry a map from handler name to {@link ProxyHandler}
     * @return a resolver that looks up handlers by name
     */
    public static HandlerResolver fromRegistry(Map<String, ProxyHandler> registry) {
        Map<String, ProxyHandler> copy = new HashMap<>(registry);
        return new HandlerResolver() {
            @Override
            public ProxyHandler resolve(String provider) {
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
     * @param supplier a function that returns a map from handler name to {@link ProxyHandler}
     * @return a resolver that re-reads from the supplier each time
     */
    public static HandlerResolver fromSupplier(Supplier<Map<String, ProxyHandler>> supplier) {
        return new HandlerResolver() {
            @Override
            public ProxyHandler resolve(String provider) {
                Map<String, ProxyHandler> current = supplier.get();
                if (current == null) return null;
                return current.get(provider);
            }
        };
    }

    /**
     * Adapts a list of {@link Provider} SPI instances (JVM: discovered via
     * {@code ServiceLoader.load(Provider.class)}; TeaVM: instantiated directly by the JS host)
     * into a {@link HandlerResolver}, keyed by each provider's own {@link Provider#id()}, so no
     * separate registration map is needed since a {@code Provider} already carries its id.
     * Last-registered-wins on a duplicate id, consistent with {@link #fromRegistry}'s plain
     * {@code Map.put} semantics.
     *
     * @param providers the discovered/registered {@link Provider} instances
     * @return a resolver that looks up a provider by id
     */
    public static HandlerResolver fromProviders(List<Provider> providers) {
        Map<String, ProxyHandler> registry = new HashMap<>();
        for (Provider p : providers) {
            registry.put(p.id(), p);
        }
        return fromRegistry(registry);
    }
}
