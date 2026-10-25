namespace KasiFlow.Api.Services;

/// <summary>
/// Extension point for a future, legitimate payment-provider integration (for example a PSP that can
/// verify that an EFT or card payment really settled).
///
/// KasiFlow SA currently does NOT receive, initiate, settle or verify payments. Every payment is
/// "recorded manually" by the owner (or "awaiting confirmation"). The <c>confirmed_external</c> payment
/// status is reserved for a provider implementation of this interface and cannot be set through the API.
///
/// To integrate a provider later: implement this interface in a new class, register it in Program.cs
/// instead of <see cref="NoPaymentVerificationProvider"/>, add a webhook endpoint that verifies the
/// provider's signature, and only then update matching transactions to <c>confirmed_external</c>.
/// Never store card numbers, banking passwords, PINs or one-time passwords.
/// </summary>
public interface IPaymentVerificationProvider
{
    string Name { get; }
    bool IsConfigured { get; }
    Task<PaymentVerificationResult> VerifyAsync(string providerReference, long expectedAmountCents, CancellationToken ct);
}

public sealed record PaymentVerificationResult(bool Verified, string Status, string? Message);

public sealed class NoPaymentVerificationProvider : IPaymentVerificationProvider
{
    public string Name => "none";
    public bool IsConfigured => false;

    public Task<PaymentVerificationResult> VerifyAsync(string providerReference, long expectedAmountCents, CancellationToken ct) =>
        Task.FromResult(new PaymentVerificationResult(false, "not_supported",
            "No payment provider is integrated. Check your bank or payment app directly before relying on a payment."));
}
