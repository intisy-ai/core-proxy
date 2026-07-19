package io.github.intisy.ai.shared.routing;

import java.util.Map;

/**
 * The typed transport error a {@link Provider#handleIr} implementation throws for a non-2xx upstream
 * outcome (rate limit, bad request, etc.), carrying status/headers/body so {@code Router.route} can
 * reconstruct an equivalent {@code HttpResponse} and feed it through the same
 * {@code RateLimit.isRateLimited}/fallback/final-429-synthesis logic used for any response, instead
 * of collapsing every throw to a flat 502. A throw that is not a {@code HandleIrException} is a
 * genuine unexpected failure and stays a flat 502.
 */
public class HandleIrException extends Exception {
    public final int status;
    public final Map<String, String> headers;
    public final String body;
    /** When set and no x-hub-retry-after-ms header is already present, Router injects it so
     *  RateLimit.rateLimitResetMs can compute the reset time without the thrower knowing the header
     *  name. Null means no hint supplied. */
    public final Long retryAfterMs;

    public HandleIrException(int status, Map<String, String> headers, String body, Long retryAfterMs) {
        super("handleIr transport error: " + status);
        this.status = status;
        this.headers = headers;
        this.body = body;
        this.retryAfterMs = retryAfterMs;
    }

    public HandleIrException(int status, Map<String, String> headers, String body) {
        this(status, headers, body, null);
    }
}
