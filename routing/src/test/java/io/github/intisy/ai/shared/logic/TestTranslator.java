package io.github.intisy.ai.shared.logic;

import io.github.intisy.ai.ir.Block;
import io.github.intisy.ai.ir.IrMessage;
import io.github.intisy.ai.ir.IrRequest;
import io.github.intisy.ai.ir.IrResponse;
import io.github.intisy.ai.ir.TextBlock;
import io.github.intisy.ai.ir.spi.StreamDecoder;
import io.github.intisy.ai.ir.spi.StreamEncoder;
import io.github.intisy.ai.ir.spi.Translator;
import io.github.intisy.ai.ir.stream.IrStreamEvent;
import io.github.intisy.ai.ir.stream.TextDeltaEvent;
import io.github.intisy.ai.api.seam.JsonCodec;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Test-only {@link Translator} over a deliberately plain wire shape
 * ({@code {"model":…,"messages":[{"role":…,"content":…}],"stream":…}} in,
 * {@code {"model":…,"stop_reason":…,"content":[{"type":"text","text":…}]}} out).
 *
 * <p>The router's IR front door is vendor-neutral: it decodes whatever the profile's translator
 * understands, routes on {@code IrRequest.model}, and encodes the provider's {@link IrResponse}
 * back. Proving that needs SOME translator, not a particular vendor's, and core-proxy must not
 * depend on one (every vendor translator lives in its own repo). So the test supplies its own.
 */
final class TestTranslator implements Translator {
    private final JsonCodec codec;

    TestTranslator(JsonCodec codec) {
        this.codec = codec;
    }

    @Override
    public IrRequest decodeRequest(String wireJson) {
        Map<?, ?> root = asMap(codec.parse(wireJson));
        IrRequest request = new IrRequest();
        request.model = str(root.get("model"));
        request.stream = Boolean.TRUE.equals(root.get("stream"));
        request.messages = new ArrayList<IrMessage>();
        Object messages = root.get("messages");
        if (messages instanceof List) {
            for (Object entry : (List<?>) messages) {
                Map<?, ?> message = asMap(entry);
                List<Block> content = new ArrayList<Block>();
                content.add(new TextBlock(str(message.get("content"))));
                request.messages.add(new IrMessage(str(message.get("role")), content));
            }
        }
        return request;
    }

    @Override
    public String encodeRequest(IrRequest request) {
        Map<String, Object> root = new LinkedHashMap<String, Object>();
        root.put("model", request.model);
        root.put("stream", request.stream);
        List<Object> messages = new ArrayList<Object>();
        if (request.messages != null) {
            for (IrMessage message : request.messages) {
                Map<String, Object> encoded = new LinkedHashMap<String, Object>();
                encoded.put("role", message.role);
                encoded.put("content", firstText(message.content));
                messages.add(encoded);
            }
        }
        root.put("messages", messages);
        return codec.stringify(root);
    }

    @Override
    public IrResponse decodeResponse(String wireJson) {
        Map<?, ?> root = asMap(codec.parse(wireJson));
        IrResponse response = new IrResponse();
        response.model = str(root.get("model"));
        response.stopReason = str(root.get("stop_reason"));
        response.content = new ArrayList<Block>();
        Object content = root.get("content");
        if (content instanceof List) {
            for (Object entry : (List<?>) content) {
                response.content.add(new TextBlock(str(asMap(entry).get("text"))));
            }
        }
        return response;
    }

    @Override
    public String encodeResponse(IrResponse response) {
        Map<String, Object> root = new LinkedHashMap<String, Object>();
        root.put("model", response.model);
        root.put("stop_reason", response.stopReason);
        List<Object> content = new ArrayList<Object>();
        if (response.content != null) {
            for (Block block : response.content) {
                Map<String, Object> encoded = new LinkedHashMap<String, Object>();
                encoded.put("type", "text");
                encoded.put("text", block instanceof TextBlock ? ((TextBlock) block).text : "");
                content.add(encoded);
            }
        }
        root.put("content", content);
        return codec.stringify(root);
    }

    @Override
    public StreamDecoder newStreamDecoder() {
        throw new UnsupportedOperationException("streaming is covered by the vendor translators' own tests");
    }

    /**
     * A stateful encoder in the shape a real vendor's is: one SSE-ish frame per event, numbered so a
     * test can tell a fresh encoder from a reused one and can prove the frames arrive in order.
     */
    @Override
    public StreamEncoder newStreamEncoder() {
        return new StreamEncoder() {
            private int frame;

            @Override
            public String encode(IrStreamEvent event) {
                String text = event instanceof TextDeltaEvent ? ((TextDeltaEvent) event).text : "";
                return "frame" + (frame++) + ":" + event.event + ":" + text;
            }
        };
    }

    private static String firstText(List<Block> blocks) {
        if (blocks == null) return "";
        for (Block block : blocks) {
            if (block instanceof TextBlock) return ((TextBlock) block).text;
        }
        return "";
    }

    private static Map<?, ?> asMap(Object value) {
        return value instanceof Map ? (Map<?, ?>) value : new LinkedHashMap<Object, Object>();
    }

    private static String str(Object value) {
        return value == null ? null : String.valueOf(value);
    }
}
