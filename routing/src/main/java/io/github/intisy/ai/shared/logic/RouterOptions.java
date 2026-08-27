package io.github.intisy.ai.shared.logic;

import io.github.intisy.ai.shared.routing.HandlerResolver;
import io.github.intisy.ai.shared.routing.RoutingProfile;
import io.github.intisy.ai.api.seam.Clock;
import io.github.intisy.ai.api.seam.JsonCodec;
import io.github.intisy.ai.api.seam.Logger;
import io.github.intisy.ai.api.seam.Store;

import java.util.Collections;
import java.util.List;
import java.util.function.Supplier;

/**
 * Options for {@link Router#route}, with no transport concerns (port/listen): the caller (server
 * daemon, TeaVM host, test) owns the actual HTTP transport, while {@link Router} only resolves a
 * request to a response.
 */
public class RouterOptions {
    /** How this app tiers, maps and rate-limits. */
    public RoutingProfile profile;
    /** Turns a provider id into the handler that serves it. */
    public HandlerResolver resolveHandler;
    /** Where the config, the model map and the catalog cache are read from. */
    public Store store;
    /** The codec every JSON read and write in the route goes through. */
    public JsonCodec json;
    /** The clock every retry and reset computation reads, injectable so a test can pin it. */
    public Clock clock;
    /** Where the route's own diagnostics go. */
    public Logger log;
    /** Callback for user-visible notices (heal/fallback/exhaustion). Delivery is the caller's job,
     *  supplied via its own {@link Notifier} implementation. */
    public Notifier notify;
    /** Supplies the provider ids the {@code /v1/models} catalog and model-recovery lookups
     *  should scan (the caller's registered handlers), read fresh on every request. */
    public Supplier<List<String>> listProviders = Collections::emptyList;
    /** Passed through to {@code HandlerCtx.configDir}; Router carries no filesystem notion
     *  of its own, so this is just an opaque string threaded to the handler. */
    public String configDir = "";
}
