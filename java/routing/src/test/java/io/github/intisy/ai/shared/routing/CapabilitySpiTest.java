package io.github.intisy.ai.shared.routing;

import org.junit.jupiter.api.Test;

import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Shape + implementability contract for the optional provider capability SPI (E-A): each POJO's
 * public fields round-trip, and a trivial in-test implementation of each interface proves the
 * method signatures compile and can return populated objects — same intent as {@link
 * ProxyPluginTest} for {@link ProxyPlugin}.
 */
class CapabilitySpiTest {

    // -- ConfigField / ConfigGroup / ConfigSchema --------------------------------------------

    @Test
    void configField_fieldsRoundTrip() {
        ConfigField f = new ConfigField();
        f.key = "max_account_attempts";
        f.label = "Max account attempts";
        f.type = "number";
        f.options = Arrays.asList("a", "b");
        f.defaultValue = 4L;

        assertEquals("max_account_attempts", f.key);
        assertEquals("Max account attempts", f.label);
        assertEquals("number", f.type);
        assertEquals(Arrays.asList("a", "b"), f.options);
        assertEquals(4L, f.defaultValue);
    }

    @Test
    void configSchema_holdsNestedGroupsAndFields() {
        ConfigField field = new ConfigField("logging", "Logging", "bool", null, Boolean.TRUE);
        ConfigGroup group = new ConfigGroup("Claude", Collections.singletonList(field));
        ConfigSchema schema = new ConfigSchema(Collections.singletonList(group));

        assertEquals(1, schema.groups.size());
        ConfigGroup readGroup = schema.groups.get(0);
        assertEquals("Claude", readGroup.title);
        assertEquals(1, readGroup.fields.size());
        assertEquals("logging", readGroup.fields.get(0).key);
        assertEquals(Boolean.TRUE, readGroup.fields.get(0).defaultValue);
    }

    /** A trivial provider proving the {@link ConfigurableProvider} method signatures are implementable. */
    private static final class FakeConfigurableProvider implements ConfigurableProvider {
        Map<String, Object> stored = Collections.singletonMap("logging", (Object) Boolean.TRUE);

        public ConfigSchema configSchema(HandlerCtx ctx) {
            ConfigField field = new ConfigField("logging", "Logging", "bool", null, Boolean.TRUE);
            return new ConfigSchema(Collections.singletonList(new ConfigGroup("Group", Collections.singletonList(field))));
        }

        public Map<String, Object> getConfigValues(HandlerCtx ctx) {
            return stored;
        }

        public Map<String, Object> putConfigValues(HandlerCtx ctx, Map<String, Object> values) {
            stored = values;
            return stored;
        }
    }

    @Test
    void configurableProvider_isImplementableAndReturnsPopulatedObjects() {
        FakeConfigurableProvider provider = new FakeConfigurableProvider();
        HandlerCtx ctx = new HandlerCtx();

        ConfigSchema schema = provider.configSchema(ctx);
        assertEquals(1, schema.groups.size());

        Map<String, Object> values = provider.getConfigValues(ctx);
        assertEquals(Boolean.TRUE, values.get("logging"));

        Map<String, Object> updated = provider.putConfigValues(ctx, Collections.singletonMap("logging", Boolean.FALSE));
        assertEquals(Boolean.FALSE, updated.get("logging"));
    }

    // -- ModelInfo / ModelCatalogProvider -----------------------------------------------------

    @Test
    void modelInfo_fieldsRoundTrip() {
        ModelInfo m = new ModelInfo("claude-opus-4", "Opus", 200000, 64000);
        assertEquals("claude-opus-4", m.id);
        assertEquals("Opus", m.name);
        assertEquals(200000, m.context);
        assertEquals(64000, m.output);
    }

    private static final class FakeModelCatalogProvider implements ModelCatalogProvider {
        public List<ModelInfo> models(HandlerCtx ctx) {
            return Arrays.asList(
                    new ModelInfo("claude-opus-4", "Opus", 200000, 64000),
                    new ModelInfo("claude-sonnet-4", "Sonnet", 200000, 64000));
        }
    }

    @Test
    void modelCatalogProvider_isImplementable_andListOrderIsRanking() {
        ModelCatalogProvider provider = new FakeModelCatalogProvider();
        List<ModelInfo> models = provider.models(new HandlerCtx());
        assertEquals(2, models.size());
        assertEquals("claude-opus-4", models.get(0).id, "list order is the ranking order");
        assertEquals("claude-sonnet-4", models.get(1).id);
    }

    // -- QuotaBar / QuotaProvider --------------------------------------------------------------

    @Test
    void quotaBar_fieldsRoundTrip() {
        QuotaBar bar = new QuotaBar("acct-1", "user@example.com", "active", "5-hour", 0.75, "2026-07-18T00:00:00Z");
        assertEquals("acct-1", bar.accountId);
        assertEquals("user@example.com", bar.accountEmail);
        assertEquals("active", bar.accountStatus);
        assertEquals("5-hour", bar.label);
        assertEquals(0.75, bar.remainingFraction);
        assertEquals("2026-07-18T00:00:00Z", bar.resetTime);
    }

    private static final class FakeQuotaProvider implements QuotaProvider {
        public List<QuotaBar> quota(HandlerCtx ctx) {
            return Collections.singletonList(new QuotaBar("acct-1", null, "active", "5-hour", 0.5, null));
        }
    }

    @Test
    void quotaProvider_isImplementable_andReturnsPopulatedBars() {
        QuotaProvider provider = new FakeQuotaProvider();
        List<QuotaBar> bars = provider.quota(new HandlerCtx());
        assertEquals(1, bars.size());
        assertEquals("acct-1", bars.get(0).accountId);
        assertEquals(0.5, bars.get(0).remainingFraction);
    }

    // -- AuthorizeInfo / OAuthProvider ---------------------------------------------------------

    @Test
    void authorizeInfo_fieldsRoundTrip() {
        AuthorizeInfo info = new AuthorizeInfo("https://example.com/authorize", "loopback", "state-123", 51121, "/callback");
        assertEquals("https://example.com/authorize", info.authorizeUrl);
        assertEquals("loopback", info.completion);
        assertEquals("state-123", info.state);
        assertEquals(51121, info.loopbackPort);
        assertEquals("/callback", info.loopbackPath);
    }

    private static final class FakeOAuthProvider implements OAuthProvider {
        public AuthorizeInfo authorize(HandlerCtx ctx) {
            return new AuthorizeInfo("https://example.com/authorize", "paste", "state-abc", null, null);
        }

        public Map<String, Object> exchange(HandlerCtx ctx, String body) {
            return Collections.singletonMap("account", Collections.singletonMap("id", "acct-1"));
        }
    }

    @Test
    void oAuthProvider_isImplementable_andReturnsPopulatedObjects() {
        OAuthProvider provider = new FakeOAuthProvider();
        AuthorizeInfo info = provider.authorize(new HandlerCtx());
        assertEquals("paste", info.completion);
        assertTrue(info.authorizeUrl.startsWith("https://"));

        Map<String, Object> result = provider.exchange(new HandlerCtx(), "{\"code\":\"c\",\"state\":\"s\"}");
        assertNotNull(result.get("account"));
    }
}
