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
        /**
         * Looks one provider up.
         *
         * @param provider the provider id a request routed to
         * @return its handler, resolving to null when none is installed
         */
        JSPromise<JsIrHandlerBridge.JsIrHandler> resolve(JSString provider);
    }

    /** Delivers a user-visible notice; {@code level} may be null. */
    @JSFunctor
    interface JsNotify extends JSObject {
        /**
         * Shows the operator a message.
         *
         * @param message the text to show
         * @param level its severity, which may be null
         */
        void notify(JSString message, JSString level);
    }

    /** Records a routing event: what happened, how much it matters, and its JSON details. */
    @JSFunctor
    interface JsEvent extends JSObject {
        /**
         * Records one routing event.
         *
         * @param action what happened, as a stable identifier
         * @param impact what it cost the request
         * @param detailsJson the event's own payload
         */
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
        /**
         * Shapes one rate-limit reply the way this app's clients expect it.
         *
         * @param infoJson the observed rate-limit signal
         * @return the response to serve in place of the upstream one
         */
        JSPromise<JSString> synthesize(JSString infoJson);
    }

    /**
     * Where the router reads its tiers, its model map and its rate-limit state.
     *
     * @return the host's store
     */
    @JSProperty
    JsStoreBridge.JsStore getStore();

    /**
     * The app-to-IR translator, absent on a wire-only profile.
     *
     * @return the translator, or null when the profile has none
     */
    @JSProperty
    JsTranslatorBridge.JsTranslator getTranslator();

    /**
     * How a provider id becomes the handler that serves it.
     *
     * @return the resolver
     */
    @JSProperty
    JsResolveHandler getResolveHandler();

    /**
     * Where user-visible notices go.
     *
     * @return the notice sink
     */
    @JSProperty
    JsNotify getNotify();

    /**
     * Records a routing event structurally; the host chooses what to file it under.
     *
     * @return the event sink
     */
    @JSProperty
    JsEvent getEvent();

    /**
     * How this app shapes a rate-limit response.
     *
     * @return the builder
     */
    @JSProperty
    JsNativeRateLimit getNativeRateLimit();

    /**
     * Where a streamed body's already-encoded wire frames are pushed, in order.
     *
     * @return the frame sink
     */
    @JSProperty
    JsEventSinkBridge.JsStreamEmit getEmit();

    /**
     * Called once a streamed body ends, with the failure that ended it or null.
     *
     * @return the end-of-stream callback
     */
    @JSProperty
    JsEventSinkBridge.JsStreamClose getClose();

    /**
     * The provider ids the {@code /v1/models} catalog and model recovery should scan.
     *
     * @return the provider ids, read fresh on every request
     */
    @JSProperty
    JSArrayReader<JSString> getProviders();
}
