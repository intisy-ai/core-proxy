package io.github.intisy.ai.shared.routing;

import io.github.intisy.ai.ir.IrRequest;
import io.github.intisy.ai.ir.IrResponse;
import io.github.intisy.ai.shared.spi.http.HttpRequest;
import io.github.intisy.ai.shared.spi.http.HttpResponse;

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

    /**
     * IR-native alternative to {@link #handle} (SP-3, the layering flip): receives an already
     * app-wire-decoded {@link IrRequest} and returns an {@link IrResponse}, with no app-wire
     * format knowledge in the provider at all — the front-door (Router/proxy server) owns
     * decoding the inbound app request into IR (via {@link RoutingProfile#translator}) and
     * encoding the returned {@link IrResponse} back to the app's wire format.
     *
     * <p>Default throws {@link UnsupportedOperationException} so a legacy provider (one that
     * only implements {@link #handle}) needs zero changes to keep working — {@code Router}
     * treats that specific exception as "this provider has no IR path" and falls back to
     * calling {@link #handle} with the original request, exactly as before. A provider that
     * migrates overrides this method; the Router prefers it over {@link #handle} whenever the
     * routing profile also supplies a {@link RoutingProfile#translator}. Both paths coexist
     * (coexist-then-remove) until every provider and caller has migrated (T4).
     */
    default IrResponse handleIr(IrRequest request, HandlerCtx ctx) throws Exception {
        throw new UnsupportedOperationException(id() + " has no handleIr — legacy handle() only");
    }

    /**
     * Legacy app-wire entry point inherited from {@link ProxyHandler}. Post-T4 an IR-native provider
     * no longer implements it — the front-door (Router/proxy server) owns app&lt;-&gt;IR translation, so
     * the provider has no app-wire format knowledge at all. This default throws so such a provider
     * satisfies the {@link ProxyHandler} contract without carrying any wire code; the Router only
     * reaches it when a profile supplies no translator (no IR to run) AND the provider is legacy
     * (overrides this), which the ecosystem's providers never are. A legacy handle()-only provider
     * still works by overriding this (see the Router's UnsupportedOperationException fallback).
     */
    default HttpResponse handle(HttpRequest req, HandlerCtx ctx) throws Exception {
        throw new UnsupportedOperationException(id() + " is IR-native — call handleIr, not handle");
    }
}
