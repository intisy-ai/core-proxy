package io.github.intisy.ai.shared.logic;

/**
 * User-notice sink invoked by {@link Router} on heal/fallback/exhaustion events. A plain callback:
 * the caller (JVM daemon, TeaVM host, test) owns delivery.
 */
public interface Notifier {
    void notify(String message, String level);
}
