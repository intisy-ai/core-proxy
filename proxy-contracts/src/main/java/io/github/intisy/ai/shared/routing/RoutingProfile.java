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
    /** Store key holding the app's loader config, whose {@code modelMap} object carries the mapping. */
    public String configFile;
    /**
     * Loader-facing config field name for the routing-enable toggle, read by the loader rather than
     * by this engine. It is NOT the field the model map lives under.
     */
    public String routingKey;
    /** The provider whose catalog the tier names are derived from. */
    public String tierSourceProvider;
    /** Known tier names, in the order a reader expects to see them. */
    public List<String> tierOrder;
    /** Tiers offered before any catalog exists, which is what a pre-login host sees. */
    public List<String> tierFallback;
    /** Extracts a tier name from a model id, so a new model family gets a mapping slot on its own. */
    public Pattern tierRegex;
    /** Prefix for the environment variables the model map exports, which the host app reads. */
    public String envPrefix;
    /** Input-token limit reported for a catalog entry that names none. */
    public int defaultContext;
    /** Output-token limit reported for a catalog entry that names none. */
    public int defaultOutput;
    /** Builds the app-shaped rate-limit response this proxy returns instead of a bare 429. */
    public NativeRateLimit nativeRateLimit;
    /**
     * Matches a model native to this app. A requested model that matches suppresses the
     * "not in catalog" notification; a null pattern notifies for every unknown model.
     */
    public Pattern nativeModelPattern;
    /**
     * The app&lt;-&gt;IR translator for this profile (e.g. {@code AnthropicTranslator} for Claude Code
     * and OpenCode, which both speak the Anthropic wire format). {@code null} means this profile has
     * no IR front-door: {@code Router} then uses only the {@link ProxyHandler#handle} path.
     */
    public Translator translator;

    /**
     * Builds a native-shaped rate-limit {@link Synth} response from observed
     * {@link RateLimitInfo}.
     */
    public interface NativeRateLimit {
        /**
         * Shapes one rate-limit reply the way this app's clients expect it.
         *
         * @param info the signal observed upstream
         * @return the response to serve in place of the upstream one
         */
        Synth build(RateLimitInfo info);
    }

    /** A synthesized native rate-limit response (status/headers/body). */
    public static class Synth {
        /** HTTP status to serve, normally 429. */
        public int status;
        /** Response headers, including whatever retry hint the app reads. */
        public Map<String, String> headers;
        /** Response body, in the app's own error shape. */
        public String body;
    }

    /**
     * Shallow copy, sufficient for producing an invalid variant to validate against.
     *
     * @return a new profile carrying the same field values
     */
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
     *
     * @param p the profile to judge, which may be null
     * @return whether the profile carries everything the router needs
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
