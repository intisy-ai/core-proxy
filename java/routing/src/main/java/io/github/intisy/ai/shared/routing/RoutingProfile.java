package io.github.intisy.ai.shared.routing;

import io.github.intisy.ai.ir.spi.Translator;

import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * Describes how to route/tier-map a provider's native model catalog, and how to synthesize a
 * native-shaped rate-limit response for that provider.
 */
public class RoutingProfile {
    public String configFile;
    public String routingKey;
    public String tierSourceProvider;
    public List<String> tierOrder;
    public List<String> tierFallback;
    public Pattern tierRegex;
    public String envPrefix;
    public int defaultContext;
    public int defaultOutput;
    public NativeRateLimit nativeRateLimit;
    public Pattern nativeModelPattern;
    /**
     * The app&lt;-&gt;IR translator for this profile (e.g. {@code AnthropicTranslator} for Claude Code
     * and OpenCode, which both speak the Anthropic wire format). {@code null} means this profile has
     * no IR front-door: {@link io.github.intisy.ai.shared.logic.Router} then uses only the
     * {@link ProxyHandler#handle} path.
     */
    public Translator translator;

    /**
     * Builds a native-shaped rate-limit {@link Synth} response from observed
     * {@link RateLimitInfo}.
     */
    public interface NativeRateLimit {
        Synth build(RateLimitInfo info);
    }

    /** A synthesized native rate-limit response (status/headers/body). */
    public static class Synth {
        public int status;
        public Map<String, String> headers;
        public String body;
    }

    /** Shallow copy, sufficient for producing an invalid variant to validate against. */
    public RoutingProfile copy() {
        RoutingProfile c = new RoutingProfile();
        c.configFile = configFile;
        c.routingKey = routingKey;
        c.tierSourceProvider = tierSourceProvider;
        c.tierOrder = tierOrder;
        c.tierFallback = tierFallback;
        c.tierRegex = tierRegex;
        c.envPrefix = envPrefix;
        c.defaultContext = defaultContext;
        c.defaultOutput = defaultOutput;
        c.nativeRateLimit = nativeRateLimit;
        c.nativeModelPattern = nativeModelPattern;
        c.translator = translator;
        return c;
    }

    /**
     * Valid when: configFile non-null and non-empty, routingKey/tierSourceProvider non-null strings,
     * tierOrder/tierFallback non-null lists, tierRegex non-null, envPrefix non-null string,
     * nativeRateLimit non-null (defaultContext/defaultOutput are primitive ints, always present).
     */
    public static boolean isValid(RoutingProfile p) {
        return p != null
                && p.configFile != null && !p.configFile.isEmpty()
                && p.routingKey != null
                && p.tierSourceProvider != null
                && p.tierOrder != null
                && p.tierFallback != null
                && p.tierRegex != null
                && p.envPrefix != null
                && p.nativeRateLimit != null;
    }
}
