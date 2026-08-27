package io.github.intisy.ai.shared.routing;

import io.github.intisy.ai.ir.spi.IrHandler;

/**
 * Resolves a provider name to the {@link IrHandler} that serves it.
 *
 * @implNote Resolves to {@link IrHandler} rather than to {@link ProxyHandler} because the engine
 * carries IR: every handler in this ecosystem serves {@code handleIr}, and the app-wire path is the
 * optional one a handler opts into by also implementing {@link ProxyHandler}.
 */
public interface HandlerResolver {
    /**
     * Looks one provider up.
     *
     * @param provider the provider id a request routed to
     * @return the handler for {@code provider}, or {@code null} when unknown.
     */
    IrHandler resolve(String provider);
}
