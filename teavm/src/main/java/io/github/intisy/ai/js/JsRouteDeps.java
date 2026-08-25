package io.github.intisy.ai.js;

import org.teavm.jso.JSFunctor;
import org.teavm.jso.JSObject;
import org.teavm.jso.JSProperty;
import org.teavm.jso.core.JSArrayReader;
import org.teavm.jso.core.JSPromise;
import org.teavm.jso.core.JSString;

/**
 * Everything a production route needs from the JS host, as one object rather than a dozen positional
 * arguments.
 *
 * @implNote Each member is declared as its own {@code @JSFunctor} interface at the crossing point,
 * never as a bare {@link JSObject}. Declared loosely, TeaVM hands JavaScript an object carrying a
 * prototype method instead of a callable function, and the generated declarations still claim a
 * function, so the failure appears only at run time.
 */
public interface JsRouteDeps extends JSObject {

    /** Resolves a provider id to its handler object, or to null/undefined when none is installed. */
    @JSFunctor
    interface JsResolveHandler extends JSObject {
        JSPromise<JsIrHandlerBridge.JsIrHandler> resolve(JSString provider);
    }

    /** Delivers a user-visible notice; {@code level} may be null. */
    @JSFunctor
    interface JsNotify extends JSObject {
        void notify(JSString message, JSString level);
    }

    /** Records a routing event: what happened, how much it matters, and its JSON details. */
    @JSFunctor
    interface JsEvent extends JSObject {
        void record(JSString action, JSString impact, JSString detailsJson);
    }

    /**
     * Builds this app's native rate-limit response from the observed rate-limit info.
     *
     * @implNote Asynchronous, so a host can hand over the profile's existing promise-returning
     * builder unchanged rather than being made to supply a second synchronous one.
     */
    @JSFunctor
    interface JsNativeRateLimit extends JSObject {
        JSPromise<JSString> synthesize(JSString infoJson);
    }

    @JSProperty
    JsStoreBridge.JsStore getStore();

    @JSProperty
    JsTranslatorBridge.JsTranslator getTranslator();

    @JSProperty
    JsResolveHandler getResolveHandler();

    @JSProperty
    JsNotify getNotify();

    /** Records a routing event structurally; the host chooses what to file it under. */
    @JSProperty
    JsEvent getEvent();

    @JSProperty
    JsNativeRateLimit getNativeRateLimit();

    /** Where a streamed body's already-encoded wire frames are pushed, in order. */
    @JSProperty
    JsEventSinkBridge.JsStreamEmit getEmit();

    /** Called once a streamed body ends, with the failure that ended it or null. */
    @JSProperty
    JsEventSinkBridge.JsStreamClose getClose();

    /** The provider ids the {@code /v1/models} catalog and model recovery should scan. */
    @JSProperty
    JSArrayReader<JSString> getProviders();
}
