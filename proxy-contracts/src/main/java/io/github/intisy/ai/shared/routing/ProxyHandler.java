package io.github.intisy.ai.shared.routing;

import io.github.intisy.ai.api.seam.HttpRequest;
import io.github.intisy.ai.api.seam.HttpResponse;
import io.github.intisy.ai.ir.spi.HandlerCtx;

/**
 * Handles a single proxied request for a given provider.
 */
public interface ProxyHandler {
    HttpResponse handle(HttpRequest req, HandlerCtx ctx) throws Exception;
}
