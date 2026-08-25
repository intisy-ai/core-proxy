package io.github.intisy.ai.shared.logic;

/**
 * User-notice sink invoked by {@link Router} on heal/fallback/exhaustion events. A plain callback:
 * the caller (JVM daemon, TeaVM host, test) owns delivery.
 */
public interface Notifier {
    void notify(String message, String level);

    /**
     * The same event described structurally, for a host that records routing events rather than only
     * showing a message.
     *
     * @implNote A default no-op, so a host that only shows messages needs no change. {@code details}
     * is JSON because its shape belongs to the event, not to this interface, and the topic a host
     * files the event under is the host's choice: this layer names WHAT happened, never where it goes.
     */
    default void event(String action, String impact, String detailsJson) {
    }
}
