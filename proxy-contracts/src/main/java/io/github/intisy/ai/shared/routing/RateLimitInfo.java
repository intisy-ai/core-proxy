package io.github.intisy.ai.shared.routing;

import io.github.intisy.ai.api.seam.HttpResponse;

/**
 * Rate-limit signal observed from an upstream response, used to synthesize a native
 * rate-limit response via {@link RoutingProfile.NativeRateLimit}.
 */
public class RateLimitInfo {
    /** Epoch milliseconds at which the limit lifts, or 0 when the upstream named no reset. */
    public long resetMs;
    /** The upstream response the signal was read from, kept so a synthesized reply can echo it. */
    public HttpResponse upstream;

    /** Creates an empty signal, for a codec that fills the fields afterwards. */
    public RateLimitInfo() {
    }

    /**
     * Creates a rate-limit signal read from one upstream response.
     *
     * @param resetMs epoch milliseconds at which the limit lifts, or 0 when none was given
     * @param upstream the response the signal was read from
     */
    public RateLimitInfo(long resetMs, HttpResponse upstream) {
        this.resetMs = resetMs;
        this.upstream = upstream;
    }
}
