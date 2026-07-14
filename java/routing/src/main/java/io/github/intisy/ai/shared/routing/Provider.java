package io.github.intisy.ai.shared.routing;

/**
 * Runtime extension point that a provider module implements to serve one provider id's
 * requests. This is the seam Task 3/4 of the Phase 4 plan dynamically load: a JVM host
 * discovers implementations via {@code ServiceLoader.load(Provider.class)} (a provider jar
 * registers itself under {@code META-INF/services/io.github.intisy.ai.shared.routing.Provider}),
 * while a non-JVM (TeaVM-transpiled) host has no classpath/ServiceLoader and instead
 * instantiates its provider class directly and registers it by {@link #id()} — the same
 * interface works in both worlds because it declares nothing ServiceLoader-specific (no
 * annotations, no static factory) and nothing JVM-only (no reflection, no {@code java.net}/
 * {@code java.nio}), so it transpiles cleanly.
 *
 * <p>{@link #handle} is deliberately identical to {@link ProxyHandler#handle} — a
 * {@code Provider} IS a {@link ProxyHandler} that additionally knows its own id, so a
 * {@code List<Provider>} adapts into a {@link HandlerResolver} with nothing but an id-keyed
 * lookup (see {@link io.github.intisy.ai.shared.logic.HandlerResolvers#fromProviders}) — no
 * separate handler-registration step, no wrapper class needed.
 */
public interface Provider extends ProxyHandler {
    /**
     * The provider id this instance serves (matches the {@code provider} field routing
     * assigns via {@link io.github.intisy.ai.shared.logic.ModelMap}/{@code Assignment}).
     */
    String id();
}
