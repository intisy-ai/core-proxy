package io.github.intisy.ai.shared.routing;

import io.github.intisy.ai.ir.IrRequest;
import io.github.intisy.ai.ir.IrResponse;
import io.github.intisy.ai.shared.spi.http.HttpRequest;
import io.github.intisy.ai.shared.spi.http.HttpResponse;

/**
 * Runtime extension point that a provider module implements to serve one provider id's requests. A
 * JVM host discovers implementations via {@code ServiceLoader.load(Provider.class)} (a provider jar
 * registers itself under {@code META-INF/services/io.github.intisy.ai.shared.routing.Provider}); a
 * non-JVM (TeaVM-transpiled) host has no classpath/ServiceLoader and instead instantiates its
 * provider class directly and registers it by {@link #id()}. The same interface works in both worlds
 * because it declares nothing ServiceLoader-specific (no annotations, no static factory) and nothing
 * JVM-only (no reflection, no {@code java.net}/{@code java.nio}), so it transpiles cleanly.
 *
 * <p>{@link #handle} is identical to {@link ProxyHandler#handle}: a {@code Provider} is a
 * {@link ProxyHandler} that additionally knows its own id, so a {@code List<Provider>} adapts into a
 * {@link HandlerResolver} with nothing but an id-keyed lookup (see
 * {@link io.github.intisy.ai.shared.logic.HandlerResolvers#fromProviders}), no separate
 * handler-registration step and no wrapper class needed.
 */
public interface Provider extends ProxyHandler {
    /**
     * The provider id this instance serves (matches the {@code provider} field routing
     * assigns via {@link io.github.intisy.ai.shared.logic.ModelMap}/{@code Assignment}).
     */
    String id();

    /**
     * IR-native entry point: receives an already-decoded {@link IrRequest} and returns an
     * {@link IrResponse}, with no app-wire format knowledge in the provider at all. The front-door
     * (Router/proxy server) owns decoding the inbound app request into IR (via
     * {@link RoutingProfile#translator}) and encoding the returned {@link IrResponse} back to the
     * app's wire format.
     *
     * <p>The default throws {@link UnsupportedOperationException}, which {@code Router} treats as
     * "this provider has no IR path" and falls back to calling {@link #handle}, so a provider that
     * only implements {@link #handle} still works. The Router prefers handleIr over {@link #handle}
     * whenever the routing profile also supplies a {@link RoutingProfile#translator}.
     */
    default IrResponse handleIr(IrRequest request, HandlerCtx ctx) throws Exception {
        throw new UnsupportedOperationException(id() + " has no handleIr, call handle instead");
    }

    /**
     * App-wire entry point inherited from {@link ProxyHandler}. An IR-native provider does not
     * implement it (the front-door owns app&lt;-&gt;IR translation), so this default throws to satisfy
     * the {@link ProxyHandler} contract without carrying any wire code. The Router only reaches it
     * when a profile supplies no translator (no IR to run) and the provider overrides this.
     */
    default HttpResponse handle(HttpRequest req, HandlerCtx ctx) throws Exception {
        throw new UnsupportedOperationException(id() + " is IR-native, call handleIr, not handle");
    }
}
