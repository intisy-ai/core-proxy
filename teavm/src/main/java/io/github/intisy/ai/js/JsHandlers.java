package io.github.intisy.ai.js;

import io.github.intisy.ai.api.seam.EventSource;
import io.github.intisy.ai.api.seam.HttpRequest;
import io.github.intisy.ai.api.seam.HttpResponse;
import io.github.intisy.ai.api.seam.JsonCodec;
import io.github.intisy.ai.ir.IrRequest;
import io.github.intisy.ai.ir.IrResponse;
import io.github.intisy.ai.ir.spi.HandlerCtx;
import io.github.intisy.ai.ir.spi.IrHandler;
import io.github.intisy.ai.ir.spi.IrStreamHandler;
import io.github.intisy.ai.ir.stream.IrEventSource;
import io.github.intisy.ai.shared.routing.ProxyHandler;

import org.teavm.interop.Async;
import org.teavm.interop.AsyncCallback;
import org.teavm.jso.JSBody;
import org.teavm.jso.JSFunctor;
import org.teavm.jso.JSObject;
import org.teavm.jso.core.JSObjects;
import org.teavm.jso.core.JSPromise;
import org.teavm.jso.core.JSString;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Presents a JS provider handler to {@code Router} as whichever combination of capabilities it
 * actually offers.
 *
 * @implNote Router selects a path by {@code instanceof}, so a handler must not claim a capability it
 * would then refuse: declaring {@code IrStreamHandler} on a handler with no streamed entry point
 * gets it chosen for a stream request and then thrown out of. Java cannot implement an interface
 * conditionally, so the combinations are separate small classes over one shared delegate rather than
 * one class with feature flags.
 */
final class JsHandlers {

    private JsHandlers() {
    }

    /** A JS app-wire handler: {@code (requestJson, ctxJson) => Promise<responseJson>}. */
    @JSFunctor
    interface JsWireHandle extends JSObject {
        JSPromise<JSString> handle(JSString requestJson, JSString ctxJson);
    }

    /**
     * Wraps {@code jsHandler} as the narrowest interface set matching what it exposes.
     *
     * @param jsHandler the JS handler object, carrying any of {@code handleIr}, {@code handleIrStream}
     * and {@code handle}.
     */
    static IrHandler wrap(String id, JsIrHandlerBridge.JsIrHandler jsHandler, JsonCodec json,
                          io.github.intisy.ai.ir.spi.JsonCodec irJson) {
        JsIrHandlerBridge ir = new JsIrHandlerBridge(id, jsHandler, irJson);
        boolean canStream = ir.canStream();
        boolean hasIr = has(jsHandler, "handleIr");
        JsWireHandle wire = has(jsHandler, "handle") ? wireOf(jsHandler) : null;

        if (!hasIr && !canStream) {
            // Router calls handleIr first and reads UnsupportedOperationException as "no IR path
            // here", which is what makes a wire-only handler reachable at all.
            return wire == null ? null : new WireOnly(id, wire, json);
        }
        if (canStream) {
            return wire == null ? new IrStream(id, ir) : new IrStreamWire(id, ir, wire, json);
        }
        return wire == null ? new IrBuffered(id, ir) : new IrBufferedWire(id, ir, wire, json);
    }

    // -- capability combinations ----------------------------------------------

    private static final class IrBuffered implements IrHandler {
        private final String id;
        private final JsIrHandlerBridge ir;

        IrBuffered(String id, JsIrHandlerBridge ir) {
            this.id = id;
            this.ir = ir;
        }

        @Override
        public String id() {
            return id;
        }

        @Override
        public IrResponse handleIr(IrRequest request, HandlerCtx ctx) throws Exception {
            return ir.handleIr(request, ctx);
        }
    }

    private static final class IrBufferedWire implements IrHandler, ProxyHandler {
        private final String id;
        private final JsIrHandlerBridge ir;
        private final JsWireHandle wire;
        private final JsonCodec json;

        IrBufferedWire(String id, JsIrHandlerBridge ir, JsWireHandle wire, JsonCodec json) {
            this.id = id;
            this.ir = ir;
            this.wire = wire;
            this.json = json;
        }

        @Override
        public String id() {
            return id;
        }

        @Override
        public IrResponse handleIr(IrRequest request, HandlerCtx ctx) throws Exception {
            return ir.handleIr(request, ctx);
        }

        @Override
        public HttpResponse handle(HttpRequest req, HandlerCtx ctx) {
            return callWire(wire, json, req, ctx);
        }
    }

    private static final class IrStream implements IrStreamHandler {
        private final String id;
        private final JsIrHandlerBridge ir;

        IrStream(String id, JsIrHandlerBridge ir) {
            this.id = id;
            this.ir = ir;
        }

        @Override
        public String id() {
            return id;
        }

        @Override
        public IrResponse handleIr(IrRequest request, HandlerCtx ctx) throws Exception {
            return ir.handleIr(request, ctx);
        }

        @Override
        public IrEventSource handleIrStream(IrRequest request, HandlerCtx ctx) {
            return ir.handleIrStream(request, ctx);
        }
    }

    private static final class IrStreamWire implements IrStreamHandler, ProxyHandler {
        private final String id;
        private final JsIrHandlerBridge ir;
        private final JsWireHandle wire;
        private final JsonCodec json;

        IrStreamWire(String id, JsIrHandlerBridge ir, JsWireHandle wire, JsonCodec json) {
            this.id = id;
            this.ir = ir;
            this.wire = wire;
            this.json = json;
        }

        @Override
        public String id() {
            return id;
        }

        @Override
        public IrResponse handleIr(IrRequest request, HandlerCtx ctx) throws Exception {
            return ir.handleIr(request, ctx);
        }

        @Override
        public IrEventSource handleIrStream(IrRequest request, HandlerCtx ctx) {
            return ir.handleIrStream(request, ctx);
        }

        @Override
        public HttpResponse handle(HttpRequest req, HandlerCtx ctx) {
            return callWire(wire, json, req, ctx);
        }
    }

    private static final class WireOnly implements IrHandler, ProxyHandler {
        private final String id;
        private final JsWireHandle wire;
        private final JsonCodec json;

        WireOnly(String id, JsWireHandle wire, JsonCodec json) {
            this.id = id;
            this.wire = wire;
            this.json = json;
        }

        @Override
        public String id() {
            return id;
        }

        @Override
        public IrResponse handleIr(IrRequest request, HandlerCtx ctx) {
            throw new UnsupportedOperationException("this handler serves only the app-wire path");
        }

        @Override
        public HttpResponse handle(HttpRequest req, HandlerCtx ctx) {
            return callWire(wire, json, req, ctx);
        }
    }

    // -- the wire call --------------------------------------------------------

    private static HttpResponse callWire(JsWireHandle wire, JsonCodec json, HttpRequest req, HandlerCtx ctx) {
        Map<String, Object> reqMap = new LinkedHashMap<>();
        reqMap.put("method", req.method != null ? req.method : "POST");
        reqMap.put("url", req.url != null ? req.url : "/");
        reqMap.put("headers", req.headers != null ? req.headers : new LinkedHashMap<String, String>());
        reqMap.put("body", req.body != null ? req.body : "");

        Map<String, Object> ctxMap = new LinkedHashMap<>();
        ctxMap.put("configDir", ctx.configDir);
        ctxMap.put("model", ctx.model);

        String responseJson = awaitWire(wire, JSString.valueOf(json.stringify(reqMap)),
                JSString.valueOf(json.stringify(ctxMap)));
        return parseResponse(json, responseJson);
    }

    private static HttpResponse parseResponse(JsonCodec json, String responseJson) {
        HttpResponse resp = new HttpResponse();
        resp.status = 502;
        resp.headers = new LinkedHashMap<>();
        resp.body = "";
        Object parsed = json.parse(responseJson);
        if (!(parsed instanceof Map)) return resp;
        Map<?, ?> m = (Map<?, ?>) parsed;
        Object status = m.get("status");
        if (status instanceof Number) resp.status = ((Number) status).intValue();
        Object body = m.get("body");
        if (body instanceof String) resp.body = (String) body;
        Object headers = m.get("headers");
        if (headers instanceof Map) {
            for (Map.Entry<?, ?> e : ((Map<?, ?>) headers).entrySet()) {
                if (e.getKey() != null && e.getValue() != null) {
                    resp.headers.put(String.valueOf(e.getKey()), String.valueOf(e.getValue()));
                }
            }
        }
        return resp;
    }

    private static boolean has(JSObject target, String member) {
        return !JSObjects.isUndefined(readMember(target, member));
    }

    @JSBody(params = {"target", "name"}, script = "return target[name];")
    private static native JSObject readMember(JSObject target, String name);

    // The functor type must be the DECLARED type at the crossing point, so the member is read
    // through a @JSBody typed as the functor rather than cast from a generic JSObject.
    @JSBody(params = {"target"}, script = "return target.handle.bind(target);")
    private static native JsWireHandle wireOf(JSObject target);

    @Async
    private static native String awaitWire(JsWireHandle fn, JSString requestJson, JSString ctxJson);

    private static void awaitWire(JsWireHandle fn, JSString requestJson, JSString ctxJson,
                                  AsyncCallback<String> callback) {
        fn.handle(requestJson, ctxJson).then(
                value -> {
                    callback.complete(value == null || JSObjects.isUndefined(value) ? null : value.stringValue());
                    return null;
                },
                error -> {
                    callback.error(new RuntimeException("the JS wire handler rejected: " + error));
                    return null;
                });
    }
}
