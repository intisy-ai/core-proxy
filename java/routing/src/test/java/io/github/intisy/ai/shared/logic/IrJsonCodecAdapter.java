package io.github.intisy.ai.shared.logic;

import io.github.intisy.ai.shared.spi.JsonCodec;

/**
 * Test-only adapter from routing's own {@link JsonCodec} SPI to core-ir's structurally identical
 * {@link io.github.intisy.ai.ir.spi.JsonCodec}, so a test can hand the SAME codec instance
 * (routing's {@code TestJsonCodec}) to a real {@code AnthropicTranslator}/{@code GeminiTranslator}
 * instead of duplicating a codec. Mirrors claude-code-auth's production
 * {@code io.github.intisy.ai.claude.IrJsonCodecAdapter} (SP-2) -- here it stays test-only because
 * core-proxy itself never constructs a Translator (that is the front-door caller's job); only
 * RouterTest needs one to prove the IR path end to end.
 */
final class IrJsonCodecAdapter implements io.github.intisy.ai.ir.spi.JsonCodec {
    private final JsonCodec delegate;

    IrJsonCodecAdapter(JsonCodec delegate) {
        this.delegate = delegate;
    }

    @Override
    public Object parse(String json) {
        return delegate.parse(json);
    }

    @Override
    public String stringify(Object value) {
        return delegate.stringify(value);
    }
}
