namespace KasiFlow.Core.Integrations;

/// <summary>A staff-recorded ledger transaction that might be the same sale as a provider payment.</summary>
public sealed record LedgerCandidate(Guid TransactionId, long AmountCents, DateOnly Date, string? Reference, string PaymentMethod, bool AlreadyLinked);

public enum MatchDecisionKind
{
    /// <summary>Exactly one transaction carries the payment's own reference → link automatically.</summary>
    AutoMatchExactReference,
    /// <summary>Possible matches by amount and date → hold for a person to decide.</summary>
    NeedsReview,
    /// <summary>Nothing recorded for this payment → create the sale from the payment.</summary>
    CreateSale,
}

public sealed record MatchSuggestion(Guid TransactionId, decimal Confidence, string Reason);

public sealed record MatchDecision(MatchDecisionKind Kind, Guid? TransactionId, IReadOnlyList<MatchSuggestion> Suggestions, string Reason);

/// <summary>
/// Reconciliation policy (documented in docs/AUTOMATION.md):
/// <list type="number">
/// <item>Exact provider/merchant reference is the only automatic match, and only when exactly one unlinked
/// transaction with that reference and the same amount exists.</item>
/// <item>Same amount within one day (non-cash payment methods) is secondary evidence: it produces suggestions for review,
/// never an automatic match.</item>
/// <item>With no candidates at all, the payment becomes a new sale.</item>
/// </list>
/// Amounts are never changed to force a match.
/// </summary>
public static class ReconciliationPolicy
{
    public const int DateWindowDays = 1;

    public static MatchDecision Decide(long grossCents, DateOnly paymentDate, string? merchantReference, IReadOnlyList<LedgerCandidate> candidates)
    {
        var open = candidates.Where(c => !c.AlreadyLinked).ToList();

        if (!string.IsNullOrWhiteSpace(merchantReference))
        {
            var byRef = open.Where(c => string.Equals(c.Reference?.Trim(), merchantReference.Trim(), StringComparison.OrdinalIgnoreCase)).ToList();
            var exact = byRef.Where(c => c.AmountCents == grossCents).ToList();
            if (exact.Count == 1)
                return new MatchDecision(MatchDecisionKind.AutoMatchExactReference, exact[0].TransactionId,
                    new[] { new MatchSuggestion(exact[0].TransactionId, 1.0m, $"Reference '{merchantReference}' and amount match exactly.") },
                    "Exact reference and amount match.");
            if (byRef.Count > 0)
                return new MatchDecision(MatchDecisionKind.NeedsReview, null,
                    byRef.Select(c => new MatchSuggestion(c.TransactionId, c.AmountCents == grossCents ? 0.7m : 0.4m,
                        c.AmountCents == grossCents
                            ? $"Reference '{merchantReference}' matches, but more than one transaction has it."
                            : $"Reference '{merchantReference}' matches, but the amount differs ({c.AmountCents} vs {grossCents} cents).")).ToList(),
                    "Reference found but not unambiguous.");
        }

        var nonCash = open.Where(c => c.PaymentMethod != Domain.PaymentMethods.Cash
                                      && c.AmountCents == grossCents
                                      && Math.Abs(c.Date.DayNumber - paymentDate.DayNumber) <= DateWindowDays).ToList();
        if (nonCash.Count > 0)
        {
            var confidence = nonCash.Count == 1 ? 0.6m : 0.3m;
            return new MatchDecision(MatchDecisionKind.NeedsReview, null,
                nonCash.Select(c => new MatchSuggestion(c.TransactionId, confidence,
                    $"Same amount, recorded {(c.Date == paymentDate ? "the same day" : "within a day")} as a non-cash sale. Needs a person to confirm.")).ToList(),
                nonCash.Count == 1 ? "One possible match by amount and date." : $"{nonCash.Count} possible matches by amount and date.");
        }

        return new MatchDecision(MatchDecisionKind.CreateSale, null, Array.Empty<MatchSuggestion>(), "No recorded sale matches this payment.");
    }
}

/// <summary>Cash-up maths for a shift. Card and QR payments never count as physical cash.</summary>
public static class CashUp
{
    public sealed record CashMovement(string Kind, long AmountCents);

    public static class Kinds
    {
        public const string CashSale = "cash_sale";
        public const string CashRefund = "cash_refund";
        public const string PaidOut = "paid_out";
        public const string CashDrop = "cash_drop";      // cash removed to a safe or bank
        public const string FloatTopUp = "float_top_up"; // cash added to the till
    }

    public static long Expected(long openingFloatCents, IEnumerable<CashMovement> movements)
    {
        if (openingFloatCents < 0) throw new ArgumentOutOfRangeException(nameof(openingFloatCents));
        var total = openingFloatCents;
        foreach (var m in movements)
        {
            if (m.AmountCents < 0) throw new ArgumentOutOfRangeException(nameof(movements));
            total += m.Kind switch
            {
                Kinds.CashSale or Kinds.FloatTopUp => m.AmountCents,
                Kinds.CashRefund or Kinds.PaidOut or Kinds.CashDrop => -m.AmountCents,
                _ => throw new ArgumentException($"Unknown cash movement '{m.Kind}'.")
            };
        }
        return total;
    }

    /// <summary>Positive = more cash than expected (over), negative = short.</summary>
    public static long Variance(long countedCents, long expectedCents) => countedCents - expectedCents;

    public static bool NeedsReview(long varianceCents, long thresholdCents) => Math.Abs(varianceCents) >= Math.Max(1, thresholdCents);
}
