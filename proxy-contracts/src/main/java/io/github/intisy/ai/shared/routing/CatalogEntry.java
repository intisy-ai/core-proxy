package io.github.intisy.ai.shared.routing;

/**
 * A single catalog entry describing a provider/model combination available for routing.
 */
public class CatalogEntry {
    /** The provider id offering this model. */
    public String provider;
    /** The upstream model id, as the provider names it. */
    public String model;
    /** The display name for the model. */
    public String name;
    /** Ranking weight within a tier, higher first; null leaves the entry unranked. */
    public Double score;
    /** Maximum input tokens the model accepts, or null when the provider does not say. */
    public Integer contextLimit;
    /** Maximum output tokens the model produces, or null when the provider does not say. */
    public Integer outputLimit;

    /** Creates an empty entry, for a codec that fills the fields afterwards. */
    public CatalogEntry() {
    }

    /**
     * Creates a fully described catalog entry.
     *
     * @param provider the provider id offering this model
     * @param model the upstream model id
     * @param name the display name for the model
     * @param score ranking weight within a tier, or null to leave it unranked
     * @param contextLimit maximum input tokens, or null when unknown
     * @param outputLimit maximum output tokens, or null when unknown
     */
    public CatalogEntry(String provider, String model, String name, Double score, Integer contextLimit, Integer outputLimit) {
        this.provider = provider;
        this.model = model;
        this.name = name;
        this.score = score;
        this.contextLimit = contextLimit;
        this.outputLimit = outputLimit;
    }
}
