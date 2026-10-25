using KasiFlow.Core.Domain;
using static KasiFlow.Core.Common.Money;

namespace KasiFlow.Core.Growth;

public sealed record EventSignal(Guid Id, string Provider, DateOnly Date, string Detail);
public sealed record PaymentSignal(Guid Id, string Provider, long AmountCents, DateOnly Date, string Status, string? Reference);
public sealed record LedgerSignal(Guid Id, string Type, long AmountCents, DateOnly Date, string Description, string Origin);
public sealed record CashUpSignal(Guid ShiftId, string StaffName, string BranchName, long VarianceCents, DateOnly Date);
public sealed record StockAdjustmentSignal(Guid MovementId, string ProductName, string BranchName, int QuantityDelta, long ValueCents, DateOnly Date, string Status, string Type);
public sealed record ConfigChangeSignal(Guid? ConnectionId, string Action, DateOnly Date, string Detail);

/// <summary>Inputs for the anomaly rules. All built from stored records by the API.</summary>
public sealed record AnomalySignals(
    IReadOnlyList<EventSignal> DuplicateEvents,
    IReadOnlyList<PaymentSignal> ProviderPayments,     // last 35 days, all statuses
    IReadOnlyList<PaymentSignal> Refunds,              // last 35 days
    IReadOnlyList<LedgerSignal> LedgerHistory,         // counted transactions, last 120 days
    IReadOnlyList<CashUpSignal> UnreviewedCashUpVariances,
    IReadOnlyList<StockAdjustmentSignal> StockAdjustments, // last 14 days
    IReadOnlyList<ConfigChangeSignal> IntegrationChanges,  // last 7 days
    decimal LargeTransactionMultiplier,
    long CashUpThresholdCents,
    IReadOnlyList<BookingPaymentSignal>? BookingPayments = null,      // completed bookings, last 30 days
    IReadOnlyList<ProofSignal>? Proofs = null,                         // payment proofs, last 30 days
    IReadOnlyList<BankChangeSignal>? BankChanges = null,               // supplier bank-detail records not yet verified
    IReadOnlyList<RecordChangeSignal>? RecordChanges = null,           // edits/voids of older financial records, last 14 days
    IReadOnlyList<CollectionSignal>? Collections = null,               // overdue debts with collection attempts
    IReadOnlyList<HouseCallCostSignal>? HouseCallCosts = null,         // completed house calls, last 60 days
    IReadOnlyList<ServiceSaleSignal>? ServiceSales = null,             // completed booking items, last 60 days
    IReadOnlyList<LowStockSignal>? LowStock = null)
{
    public static readonly AnomalySignals Empty = new([], [], [], [], [], [], [], 3m, 5_000);
}

public sealed record BookingPaymentSignal(Guid BookingId, string Reference, long TotalCents, long PaidCents, long PendingCents, bool HasDebt, DateOnly Date);
public sealed record ProofSignal(Guid Id, long? ClaimedCents, DateOnly Date, string Status, bool DuplicateFile, int AgeDays, string? Reference);
public sealed record BankChangeSignal(Guid Id, Guid SupplierId, string SupplierName, string NewLast4, string? VerifiedLast4, string Source, DateOnly Date);
public sealed record RecordChangeSignal(Guid TransactionId, string Action, string Description, long AmountCents, DateOnly RecordDate, DateOnly ChangedOn);
public sealed record CollectionSignal(Guid DebtId, string CustomerName, long OutstandingCents, int DaysOverdue, int FailedAttempts, bool Disputed);
public sealed record HouseCallCostSignal(Guid BookingId, long TravelFeeCents, long ActualCostsCents, DateOnly Date);
public sealed record ServiceSaleSignal(string ServiceName, long AmountCents, DateOnly Date);
public sealed record LowStockSignal(Guid ProductId, string ProductName, string BranchName, int Quantity, int MinStock, string StockClass);

internal static class A
{
    public static AnomalySignals S(GrowthContext c) => c.Signals ?? AnomalySignals.Empty;
    public static string Ids(IEnumerable<Guid> ids) => string.Join(",", ids.OrderBy(i => i));
}

public sealed class DuplicateEventsRule : IGrowthRule
{
    public string Code => "DUPLICATE_PROVIDER_EVENTS";
    public string Name => "Repeated provider deliveries";
    public string Description => "Reports payment events that a provider delivered more than once in the last 7 days. Duplicates are ignored, never double counted.";
    public string DefaultSeverity => Severities.Informational;

    public IEnumerable<RecommendationDraft> Evaluate(GrowthContext ctx)
    {
        var recent = A.S(ctx).DuplicateEvents.Where(e => ctx.Today.DayNumber - e.Date.DayNumber <= 6).ToList();
        if (recent.Count == 0) yield break;
        yield return new RecommendationDraft(Code, RuleText.Fingerprint(Code, recent.Select(e => e.Id.ToString())),
            $"{recent.Count} repeated payment notification{(recent.Count == 1 ? "" : "s")} ignored",
            recent.Count >= 10 ? Severities.Warning : Severities.Informational,
            "A payment provider sent the same event more than once. KasiFlow recorded each payment only once, so your figures are not affected. " +
            "Occasional repeats are normal (providers retry when a reply is slow); many repeats can mean a misconfigured webhook or a replayed message.",
            recent.Select(e => new EvidenceItem("provider_event", e.Id, $"{e.Provider}: {e.Detail}", null, e.Date, "Duplicate ignored")).ToList(),
            [],
            ["No action is needed for occasional repeats.", "If repeats keep growing, check the webhook settings with the provider.", "Look at the integration activity log for details."],
            null);
    }
}

public sealed class PaymentFailuresRule : IGrowthRule
{
    public string Code => "PAYMENT_FAILURES";
    public string Name => "Repeated failed payments";
    public string Description => "Flags 3 or more failed provider payments in the last 7 days when failures are rising or at least 30% of attempts.";
    public string DefaultSeverity => Severities.Warning;

    public IEnumerable<RecommendationDraft> Evaluate(GrowthContext ctx)
    {
        var s = A.S(ctx);
        var last7 = s.ProviderPayments.Where(p => ctx.Today.DayNumber - p.Date.DayNumber <= 6).ToList();
        var failed = last7.Where(p => p.Status == "failed").ToList();
        if (failed.Count < 3) yield break;
        var prior = s.ProviderPayments.Where(p => ctx.Today.DayNumber - p.Date.DayNumber is > 6 and <= 34 && p.Status == "failed").Count();
        var priorWeekly = prior / 4m;
        var ratio = last7.Count == 0 ? 0m : (decimal)failed.Count / last7.Count;
        if (failed.Count < priorWeekly * 2 && ratio < 0.3m) yield break;
        yield return new RecommendationDraft(Code, RuleText.Fingerprint(Code, failed.Select(f => f.Id.ToString())),
            $"{failed.Count} payments failed in the last 7 days",
            Severities.Warning,
            $"{failed.Count} of {last7.Count} payment attempts failed this week ({Math.Round(ratio * 100)}%), compared with about {Math.Round(priorWeekly, 1)} failures a week before. " +
            "Failed payments mean no money arrived. Common causes are poor signal, declined cards or customers cancelling.",
            failed.Select(f => new EvidenceItem("provider_payment", f.Id, $"{f.Provider} payment {f.Reference ?? ""}".Trim(), f.AmountCents, f.Date, "Failed")).ToList(),
            [],
            ["Before handing over goods, confirm the payment shows as completed, not just started.",
             "Check your device's internet connection and the provider's status page.",
             "If failures continue, contact the provider's support."],
            null);
    }
}

public sealed class UnusualRefundsRule : IGrowthRule
{
    public string Code => "UNUSUAL_REFUNDS";
    public string Name => "Unexpected refunds";
    public string Description => "Flags refunds in the last 14 days when there are 2 or more totalling at least R300, or any single refund of R1,000 or more.";
    public string DefaultSeverity => Severities.Warning;

    public IEnumerable<RecommendationDraft> Evaluate(GrowthContext ctx)
    {
        var recent = A.S(ctx).Refunds.Where(r => ctx.Today.DayNumber - r.Date.DayNumber <= 13).ToList();
        var total = recent.Sum(r => r.AmountCents);
        if (!(recent.Count >= 2 && total >= 30_000) && !recent.Any(r => r.AmountCents >= 100_000)) yield break;
        yield return new RecommendationDraft(Code, RuleText.Fingerprint(Code, recent.Select(r => r.Id.ToString())),
            $"{FormatZar(total)} refunded in the last 14 days",
            Severities.Warning,
            $"{recent.Count} refund{(recent.Count == 1 ? " was" : "s were")} processed recently. Refunds are normal, but unexpected ones are worth checking because refund fraud often looks like an ordinary refund.",
            recent.Select(r => new EvidenceItem("provider_payment", r.Id, $"Refund via {r.Provider} {r.Reference ?? ""}".Trim(), -r.AmountCents, r.Date, null)).ToList(),
            [],
            ["Check that each refund matches a real customer return or complaint.", "Make sure only trusted people can issue refunds on your payment app.", "Record a fraud incident if a refund was not authorised."],
            total);
    }
}

public sealed class LargeTransactionRule : IGrowthRule
{
    public const int MinimumHistory = 20;
    public string Code => "LARGE_TRANSACTION";
    public string Name => "Unusually large transaction";
    public string Description => "Flags a transaction in the last 7 days that is much larger than your usual ones (multiplier set in Settings). Needs at least 20 earlier transactions of the same type.";
    public string DefaultSeverity => Severities.Informational;

    public IEnumerable<RecommendationDraft> Evaluate(GrowthContext ctx)
    {
        var s = A.S(ctx);
        var flagged = new List<(LedgerSignal L, long Median)>();
        foreach (var type in new[] { TransactionTypes.Income, TransactionTypes.Expense })
        {
            var history = s.LedgerHistory.Where(l => l.Type == type && ctx.Today.DayNumber - l.Date.DayNumber > 6).Select(l => l.AmountCents).OrderBy(a => a).ToList();
            if (history.Count < MinimumHistory) continue;
            var median = history[history.Count / 2];
            foreach (var l in s.LedgerHistory.Where(l => l.Type == type && ctx.Today.DayNumber - l.Date.DayNumber <= 6))
                if (l.AmountCents >= median * s.LargeTransactionMultiplier && l.AmountCents >= 50_000) flagged.Add((l, median));
        }
        if (flagged.Count == 0) yield break;
        yield return new RecommendationDraft(Code, RuleText.Fingerprint(Code, flagged.Select(f => f.L.Id.ToString())),
            flagged.Count == 1 ? "One unusually large transaction this week" : $"{flagged.Count} unusually large transactions this week",
            Severities.Informational,
            $"These are at least {s.LargeTransactionMultiplier}× your typical transaction of the same type. Large amounts are often legitimate (a big order or equipment), so this is only a prompt to double-check.",
            flagged.Select(f => new EvidenceItem("transaction", f.L.Id, f.L.Description, f.L.Type == TransactionTypes.Income ? f.L.AmountCents : -f.L.AmountCents, f.L.Date,
                $"Typical {f.L.Type}: {FormatZar(f.Median)}")).ToList(),
            [],
            ["Confirm the amount was entered correctly (an extra zero is a common mistake).", "For large payments in, check the money is in your account before releasing goods."],
            null);
    }
}

public sealed class CashUpVarianceRule : IGrowthRule
{
    public string Code => "CASHUP_VARIANCE";
    public string Name => "Cash-up differences to review";
    public string Description => "Lists closed shifts whose counted cash differs from expected by at least the threshold in Settings and that nobody has reviewed yet.";
    public string DefaultSeverity => Severities.Warning;

    public IEnumerable<RecommendationDraft> Evaluate(GrowthContext ctx)
    {
        var s = A.S(ctx);
        var items = s.UnreviewedCashUpVariances.Where(v => Math.Abs(v.VarianceCents) >= s.CashUpThresholdCents).ToList();
        if (items.Count == 0) yield break;
        yield return new RecommendationDraft(Code, RuleText.Fingerprint(Code, items.Select(i => i.ShiftId.ToString())),
            $"{items.Count} cash-up difference{(items.Count == 1 ? "" : "s")} to review",
            Severities.Warning,
            "The cash counted at the end of these shifts differs from what the records say should be in the till. " +
            "This does not mean anyone did something wrong: counting mistakes, giving the wrong change or paid-outs that were not recorded are common causes.",
            items.Select(i => new EvidenceItem("shift", i.ShiftId, $"{i.BranchName} · {i.StaffName}", i.VarianceCents, i.Date,
                i.VarianceCents < 0 ? $"Short by {FormatZar(-i.VarianceCents)}" : $"Over by {FormatZar(i.VarianceCents)}")).ToList(),
            [],
            ["Recount the cash if it is still available.", "Check for paid-outs or refunds that were not recorded.", "Talk to the staff member privately and mark the shift as reviewed with a note."],
            null);
    }
}

public sealed class StockAdjustmentRule : IGrowthRule
{
    public const long ValueThresholdCents = 50_000;
    public string Code => "UNUSUAL_STOCK_ADJUSTMENT";
    public string Name => "Large stock adjustments";
    public string Description => "Flags stock written off or adjusted in the last 14 days worth at least R500 in total, or with a single change of 20+ units.";
    public string DefaultSeverity => Severities.Informational;

    public IEnumerable<RecommendationDraft> Evaluate(GrowthContext ctx)
    {
        var items = A.S(ctx).StockAdjustments.Where(a => ctx.Today.DayNumber - a.Date.DayNumber <= 13).ToList();
        var lossValue = items.Where(a => a.QuantityDelta < 0).Sum(a => a.ValueCents);
        if (lossValue < ValueThresholdCents && !items.Any(a => Math.Abs(a.QuantityDelta) >= 20)) yield break;
        yield return new RecommendationDraft(Code, RuleText.Fingerprint(Code, items.Select(i => i.MovementId.ToString())),
            $"Stock adjustments worth {FormatZar(lossValue)} in 14 days",
            lossValue >= ValueThresholdCents * 4 ? Severities.Warning : Severities.Informational,
            "Stock was written off or adjusted by hand. Breakages and counting corrections are normal; repeated or large adjustments are worth understanding.",
            items.Select(a => new EvidenceItem("stock_movement", a.MovementId, $"{a.ProductName} · {a.BranchName} ({a.Type})", -a.ValueCents, a.Date,
                $"{a.QuantityDelta:+#;-#;0} units · {a.Status.Replace('_', ' ')}")).ToList(),
            [],
            ["Check the reason recorded for each adjustment.", "Do a spot count of the affected products.", "Keep stock-adjustment approval limited to managers."],
            lossValue > 0 ? lossValue : null);
    }
}

public sealed class IntegrationChangeRule : IGrowthRule
{
    public string Code => "INTEGRATION_CHANGES";
    public string Name => "Integration settings changed";
    public string Description => "Lists payment integrations connected, disconnected or changed in the last 7 days, so unexpected changes are noticed.";
    public string DefaultSeverity => Severities.Informational;

    public IEnumerable<RecommendationDraft> Evaluate(GrowthContext ctx)
    {
        var items = A.S(ctx).IntegrationChanges.Where(c => ctx.Today.DayNumber - c.Date.DayNumber <= 6).ToList();
        if (items.Count == 0) yield break;
        yield return new RecommendationDraft(Code, RuleText.Fingerprint(Code, items.Select(i => $"{i.ConnectionId}:{i.Action}:{i.Date}")),
            $"{items.Count} integration change{(items.Count == 1 ? "" : "s")} this week",
            Severities.Informational,
            "Payment integrations were connected, disconnected or changed. If you or an administrator made these changes, no action is needed.",
            items.Select(i => new EvidenceItem("integration", i.ConnectionId, i.Detail, null, i.Date, i.Action)).ToList(),
            [],
            ["If you don't recognise a change, review who has administrator access under Staff.", "Disconnect any integration you did not set up."],
            null);
    }
}
