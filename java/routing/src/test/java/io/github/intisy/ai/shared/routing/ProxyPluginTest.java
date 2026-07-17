package io.github.intisy.ai.shared.routing;

import org.junit.jupiter.api.Test;

import java.util.ServiceLoader;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Shape + discoverability contract for the {@link ProxyPlugin} SPI: a tiered proxy exposes a valid
 * {@link RoutingProfile}, a native/passthrough proxy is representable with a {@code null} profile,
 * and implementations are discoverable via {@link ServiceLoader} (the JVM host's seam in SP-D).
 */
class ProxyPluginTest {

    /** A native/passthrough proxy (e.g. opencode): id + name, no routing profile. */
    private static final class NativeProxyPlugin implements ProxyPlugin {
        public String id() { return "opencode"; }
        public String displayName() { return "OpenCode"; }
        public RoutingProfile profile() { return null; }
    }

    @Test
    void tieredPluginExposesValidProfile() {
        ProxyPlugin plugin = new ProxyPluginServiceFixture();
        assertNotNull(plugin.id());
        assertNotNull(plugin.displayName());
        assertTrue(RoutingProfile.isValid(plugin.profile()), "a tiered proxy must supply a valid RoutingProfile");
        assertTrue(plugin.profile().tierOrder.size() > 0, "tiered proxy's profile carries the tier slots");
    }

    @Test
    void nativePluginHasNoProfile() {
        ProxyPlugin plugin = new NativeProxyPlugin();
        assertEquals("opencode", plugin.id());
        assertNotNull(plugin.displayName());
        assertNull(plugin.profile(), "a native/passthrough proxy declares no routing surface");
    }

    @Test
    void discoverableViaServiceLoader() {
        boolean found = false;
        for (ProxyPlugin plugin : ServiceLoader.load(ProxyPlugin.class)) {
            if ("fixture-code".equals(plugin.id())) {
                assertTrue(RoutingProfile.isValid(plugin.profile()));
                found = true;
            }
        }
        assertTrue(found, "ServiceLoader must discover the registered ProxyPlugin (SP-D's host seam)");
    }
}
