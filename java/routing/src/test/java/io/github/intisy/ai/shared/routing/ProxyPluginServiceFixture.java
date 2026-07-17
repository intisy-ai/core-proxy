package io.github.intisy.ai.shared.routing;

import java.util.Arrays;
import java.util.regex.Pattern;

/**
 * Public, no-arg {@link ProxyPlugin} used only by {@code ProxyPluginTest} to prove the SPI is
 * discoverable via {@code ServiceLoader}. Registered through the test-resources services file
 * {@code META-INF/services/io.github.intisy.ai.shared.routing.ProxyPlugin}.
 */
public final class ProxyPluginServiceFixture implements ProxyPlugin {
    @Override
    public String id() {
        return "fixture-code";
    }

    @Override
    public String displayName() {
        return "Fixture Code";
    }

    @Override
    public RoutingProfile profile() {
        RoutingProfile p = new RoutingProfile();
        p.configFile = "fixture-loader.json";
        p.routingKey = "providerRouting";
        p.tierSourceProvider = "fixture-code";
        p.tierOrder = Arrays.asList("opus", "sonnet", "haiku");
        p.tierFallback = Arrays.asList("opus", "sonnet");
        p.tierRegex = Pattern.compile("^fixture-([a-z]+)-\\d");
        p.nativeModelPattern = Pattern.compile("^fixture-");
        p.envPrefix = "FIXTURE";
        p.defaultContext = 200000;
        p.defaultOutput = 64000;
        p.nativeRateLimit = info -> {
            RoutingProfile.Synth s = new RoutingProfile.Synth();
            s.status = 429;
            s.body = "{}";
            return s;
        };
        return p;
    }
}
