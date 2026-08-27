package io.github.intisy.ai.shared.routing;

import io.github.intisy.ai.api.seam.HttpRequest;
import io.github.intisy.ai.api.seam.HttpResponse;
import io.github.intisy.ai.ir.spi.HandlerCtx;

/**
 * Handles a single proxied request for a given provider.
 */
public interface ProxyHandler {
    /**
     * Serves one request in the app's own wire format, bypassing the IR path.
     *
     * @param req the request as the app sent it
     * @param ctx the per-request runtime the host supplies
     * @return the response to hand back to the app
     * @throws Exception when the upstream call fails; the router turns it into a proxied error
     */
    HttpResponse handle(HttpRequest req, HandlerCtx ctx) throws Exception;
}
