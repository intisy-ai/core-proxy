package io.github.intisy.ai.shared.routing;

/**
 * A single usage bar from a {@link QuotaProvider}, matching one account's flattened entry of the
 * existing {@code GET /v1/quota} wire shape ({@code accounts[].quota[]}, one {@link QuotaBar} per
 * {account, pool} pair). {@link #accountEmail}/{@link #accountStatus} carry the account-level
 * fields ({@code accounts[].email}/{@code accounts[].status}, e.g. active|rate-limited|error) the
 * wire shape attaches per-account rather than per-bar, so flattening to a single list loses no
 * information the existing dashboard consumer ({@code QuotaAdmin}) relies on.
 */
public final class QuotaBar {
    public String accountId;
    public String accountEmail;
    public String accountStatus;
    public String label;
    public double remainingFraction;
    public String resetTime;

    public QuotaBar() {
    }

    public QuotaBar(String accountId, String accountEmail, String accountStatus, String label,
                     double remainingFraction, String resetTime) {
        this.accountId = accountId;
        this.accountEmail = accountEmail;
        this.accountStatus = accountStatus;
        this.label = label;
        this.remainingFraction = remainingFraction;
        this.resetTime = resetTime;
    }
}
