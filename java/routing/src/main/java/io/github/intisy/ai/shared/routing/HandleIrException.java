package io.github.intisy.ai.shared.routing;

import java.util.Map;

/**
 * T3c-1 Java analog of TypeScript's {@code HandleIrError} (core-proxy's {@code src/types.ts}):
 * the typed transport error a {@link Provider#handleIr} implementation throws for a non-2xx
 * upstream outcome (rate limit, bad request, etc.), carrying exactly what the legacy
 * {@link ProxyHandler#handle} path's real {@code HttpResponse} carried -- status/headers/body --
 * so {@code Router.route} can reconstruct an equivalent {@code HttpResponse} and feed it through
 * the SAME {@code RateLimit.isRateLimited}/fallback/final-429-synthesis logic used for a legacy
 * response, instead of collapsing every throw to a flat 502 (which lost status fidelity and
 * broke rate-limit fallback). A throw that is NOT a {@code HandleIrException} is a genuine
 * unexpected failure and stays a flat 502, unchanged.
 */
public class HandleIrException extends Exception {
    public final int status;
    public final Map<String, String> headers;
    public final String body;
    /** Optional convenience: when set and no x-hub-retry-after-ms header is already present,
     *  Router injects it so RateLimit.rateLimitResetMs can compute the reset time without the
     *  thrower having to know the header name. Null means "no hint supplied". */
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
