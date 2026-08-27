package io.github.intisy.ai.shared.routing;

/**
 * A resolved provider/model assignment for a request.
 */
public class Assignment {
    /** The provider id that will serve the request. */
    public String provider;
    /** The upstream model id to send, after any tier or alias rewrite. */
    public String model;
    /** The display name for the assignment, as a dashboard or log line shows it. */
    public String name;
    /** Whether the model was derived from a tier rather than named by the request. */
    public boolean derived;

    /** Creates an empty assignment, for a codec that fills the fields afterwards. */
    public Assignment() {
    }

    /**
     * Creates a fully resolved assignment.
     *
     * @param provider the provider id that will serve the request
     * @param model the upstream model id to send
     * @param name the display name for the assignment
     * @param derived whether the model came from a tier rather than from the request
     */
    public Assignment(String provider, String model, String name, boolean derived) {
        this.provider = provider;
        this.model = model;
        this.name = name;
        this.derived = derived;
    }
}
