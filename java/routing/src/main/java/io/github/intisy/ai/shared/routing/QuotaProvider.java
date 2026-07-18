package io.github.intisy.ai.shared.routing;

import java.util.List;

/**
 * Optional capability: a provider that exposes per-account usage bars as a typed method instead
 * of a {@code /v1/quota} URL branch inside {@code handle()}.
 */
public interface QuotaProvider {
    List<QuotaBar> quota(HandlerCtx ctx);
}
