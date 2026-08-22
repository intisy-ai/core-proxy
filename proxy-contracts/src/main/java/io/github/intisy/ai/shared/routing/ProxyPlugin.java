package io.github.intisy.ai.shared.routing;

import io.github.intisy.ai.ir.spi.IrHandler;

/**
 * Declarative descriptor a proxy module publishes so a JVM host can host a proxy for it generically,
 * the proxy-side mirror of {@link IrHandler}. Where an {@link IrHandler} serves one id's requests
 * upstream, a {@code ProxyPlugin} represents a host app whose traffic the {@code :34567} proxy fronts
 * (claude-code, opencode, …) and declares only how that proxy should route.
 *
 * <p>Discovered on the JVM via {@code ServiceLoader.load(ProxyPlugin.class)} (a proxy jar registers
 * under {@code META-INF/services/io.github.intisy.ai.shared.routing.ProxyPlugin}); a non-JVM
 * (TeaVM-transpiled) host has no ServiceLoader and instead instantiates the class directly and keys
 * it by {@link #id()}. The interface declares nothing ServiceLoader-specific (no annotations, no
 * static factory) and nothing JVM-only (no reflection, no {@code java.net}/{@code java.nio}), so it
 * transpiles cleanly, same rationale as {@link IrHandler}.
 *
 * <p>Unlike an {@link IrHandler}, a {@code ProxyPlugin} serves nothing itself: the
 * {@link io.github.intisy.ai.shared.logic.Router} plus the installed handlers do. A
 * {@code ProxyPlugin} is purely declarative: it names the proxy and supplies the
 * {@link RoutingProfile} that configures a proxy instance for it.
 */
public interface ProxyPlugin {
    /** The proxy / host-app id (e.g. {@code "claude-code"}, {@code "opencode"}). */
    String id();

    /** Human-readable name for the dashboard proxy card. */
    String displayName();

    /**
     * The routing behavior this proxy applies, or {@code null} for a native / passthrough proxy that
     * does no tier mapping (e.g. opencode, which manages its own model list). A non-null profile with
     * a non-empty {@link RoutingProfile#tierOrder} is the host's signal to render that proxy's routing
     * (tier) surface; a {@code null} profile means "no routing surface".
     */
    RoutingProfile profile();
}
