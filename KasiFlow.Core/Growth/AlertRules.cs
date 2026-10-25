using KasiFlow.Core.Domain;
using static KasiFlow.Core.Common.Money;

namespace KasiFlow.Core.Growth;

/// <summary>Rule codes that go to the Fraud &amp; Alerts Centre (warnings needing verification) rather than to
/// growth recommendations. Alerts are never proof of wrongdoing.</summary>
public static class AlertCodes
{
    public static readonly IReadOnlySet<string> All = new HashSet<string>
    {
        "DUPLICATE_PROVIDER_EVENTS", "PAYMENT_FAILURES", "UNUSUAL_REFUNDS", "LARGE_TRANSACTION", "CASHUP_VARIANCE",
        "UNUSUAL_STOCK_ADJUSTMENT", "INTEGRATION_CHANGES", "DUPLICATE_EXPENSE", "BOOKING_PAYMENT_MISMATCH",
        "UNVERIFIED_PAYMENT_PROOF", "SUPPLIER_BANK_CHANGE", "FINANCIAL_RECORD_CHANGES", "FAILED_COLLECTIONS",
    };
}

public sealed class DuplicateExpenseRule : IGrowthRule
{
    public string Code => "DUPLICATE_EXPENSE";
    public string Name => "Possible duplicate expenses";
    public string Description => "Two or more recorded expenses in the last 14 days with the same amount and description within one day of each other.";
    public string DefaultSeverity => Severities.Warning;

    public IEnumerable<RecommendationDraft> Evaluate(GrowthContext ctx)
    {
        var recent = A.S(ctx).LedgerHistory.Where(l => l.Type == TransactionTypes.Expense && ctx.Today.DayNumber - l.Date.DayNumber <= 13).ToList();
        var groups = recent.GroupBy(l => (l.AmountCents, Key: l.Description.Trim().ToLowerInvariant()))
            .Select(g => g.OrderBy(x => x.Date).ToList())
            .Where(g => g.Count > 1 && g.Zip(g.Skip(1)).Any(p => p.Second.Date.DayNumber - p.First.Date.DayNumber <= 1))
            .ToList();
        foreach (var g in groups)
            yield return new RecommendationDraft(Code, RuleText.Fingerprint(Code, g.Select(x => x.Id.ToString())),
                $"Possible duplicate expense: {g[0].Description} ({FormatZar(g[0].AmountCents)})",
                Severities.Warning,
                $"{g.Count} expenses with the same amount and description were recorded within a day of each other. This is often a double capture, but it can also be two genuine purchases.",
                g.Select(x => new EvidenceItem("transaction", x.Id, x.Description, -x.AmountCents, x.Date, x.Origin)).ToList(), [],
                ["Check the receipts or bank statement.", "If it was captured twice, void the duplicate with a reason (the record is kept for the audit trail)."],
                g.Skip(1).Sum(x => x.AmountCents));
    }
}

public sealed class BookingPaymentMismatchRule : IGrowthRule
{
    public string Code => "BOOKING_PAYMENT_MISMATCH";
    public string Name => "Completed visits without matching payment";
    public string Description => "Completed bookings in the last 30 days where recorded payments are less than the booking total and no customer debt was recorded.";
    public string DefaultSeverity => Severities.Warning;

    public IEnumerable<RecommendationDraft> Evaluate(GrowthContext ctx)
    {
        var items = (A.S(ctx).BookingPayments ?? []).Where(b => !b.HasDebt && b.PaidCents + b.PendingCents < b.TotalCents).ToList();
        if (items.Count == 0) yield break;
        var gap = items.Sum(b => b.TotalCents - b.PaidCents - b.PendingCents);
        yield return new RecommendationDraft(Code, RuleText.Fingerprint(Code, items.Select(i => i.BookingId.ToString())),
            $"{items.Count} completed visit{(items.Count == 1 ? "" : "s")} without a matching payment ({FormatZar(gap)})",
            Severities.Warning,
            "These visits were marked complete, but the payments recorded against them are less than the booking total and no customer debt was recorded. Often a payment was recorded without linking it to the booking, or the customer will pay later.",
            items.Select(i => new EvidenceItem("booking", i.BookingId, $"Booking {i.Reference}", i.TotalCents - i.PaidCents - i.PendingCents, i.Date,
                $"Total {FormatZar(i.TotalCents)}, paid {FormatZar(i.PaidCents)}{(i.PendingCents > 0 ? $", awaiting confirmation {FormatZar(i.PendingCents)}" : "")}")).ToList(), [],
            ["Check whether the payment was recorded separately.", "If the customer still owes, record a customer debt.", "Ask the barber who did the visit — without assuming anything went wrong."],
            gap);
    }
}

public sealed class UnverifiedProofRule : IGrowthRule
{
    public string Code => "UNVERIFIED_PAYMENT_PROOF";
    public string Name => "Proofs of payment not yet verified";
    public string Description => "Payment proofs that are still unverified after one day, or the same proof file submitted more than once.";
    public string DefaultSeverity => Severities.Warning;

    public IEnumerable<RecommendationDraft> Evaluate(GrowthContext ctx)
    {
        var items = (A.S(ctx).Proofs ?? []).Where(p => p.Status == "unverified" && (p.AgeDays >= 1 || p.DuplicateFile)).ToList();
        if (items.Count == 0) yield break;
        var dup = items.Any(i => i.DuplicateFile);
        yield return new RecommendationDraft(Code, RuleText.Fingerprint(Code, items.Select(i => i.Id.ToString())),
            dup ? "A proof of payment was submitted more than once" : $"{items.Count} proof{(items.Count == 1 ? "" : "s")} of payment still unverified",
            dup ? Severities.Critical : Severities.Warning,
            "A screenshot or PDF of a payment is not proof that money arrived — fake and reused proofs are common. These amounts are not counted as received until the money is seen in your account or confirmed by your payment provider." +
            (dup ? " The exact same file was submitted more than once, which needs checking." : ""),
            items.Select(i => new EvidenceItem("payment_proof", i.Id, $"Proof {i.Reference ?? ""}".Trim(), i.ClaimedCents, i.Date,
                i.DuplicateFile ? "Same file submitted before" : $"Unverified for {i.AgeDays} day(s)")).ToList(), [],
            ["Open your banking app and look for the payment (not just the SMS or screenshot).", "Mark the proof as confirmed only once you see the money, or reject it.", "Do not release goods or extra services on the strength of a proof alone."],
            items.Sum(i => i.ClaimedCents ?? 0));
    }
}

public sealed class SupplierBankChangeRule : IGrowthRule
{
    public string Code => "SUPPLIER_BANK_CHANGE";
    public string Name => "Supplier bank details changed";
    public string Description => "New supplier bank details that have not been independently verified.";
    public string DefaultSeverity => Severities.Critical;

    public IEnumerable<RecommendationDraft> Evaluate(GrowthContext ctx)
    {
        foreach (var c in A.S(ctx).BankChanges ?? [])
            yield return new RecommendationDraft(Code, RuleText.Fingerprint(Code, [c.Id.ToString()]),
                $"{c.SupplierName}: new bank details not verified",
                c.VerifiedLast4 is null ? Severities.Warning : Severities.Critical,
                $"Bank details ending {c.NewLast4} were recorded{(c.VerifiedLast4 is not null ? $", replacing verified details ending {c.VerifiedLast4}" : "")} (source: {c.Source.Replace('_', ' ')}). " +
                "Changed bank details are the most common way businesses are tricked into paying a fraudster.",
                [new EvidenceItem("supplier_bank_details", c.Id, $"{c.SupplierName} — account ending {c.NewLast4}", null, c.Date, "Unverified")], [],
                ["Phone the supplier on a number you already had (not one in the message) and confirm the change.", "Only then mark the details as verified, with the method you used.", "Do not pay to the new account until it is verified."],
                null);
    }
}

public sealed class FinancialRecordChangesRule : IGrowthRule
{
    public string Code => "FINANCIAL_RECORD_CHANGES";
    public string Name => "Older financial records changed";
    public string Description => "Transactions older than 7 days that were edited or voided in the last 14 days.";
    public string DefaultSeverity => Severities.Informational;

    public IEnumerable<RecommendationDraft> Evaluate(GrowthContext ctx)
    {
        var items = A.S(ctx).RecordChanges ?? [];
        if (items.Count == 0) yield break;
        yield return new RecommendationDraft(Code, RuleText.Fingerprint(Code, items.Select(i => $"{i.TransactionId}:{i.Action}:{i.ChangedOn}")),
            $"{items.Count} older record{(items.Count == 1 ? " was" : "s were")} changed",
            items.Count >= 5 ? Severities.Warning : Severities.Informational,
            "Records more than a week old were edited or voided. Corrections are normal; unexpected changes to old records are worth a look. The audit trail shows who made each change.",
            items.Select(i => new EvidenceItem("transaction", i.TransactionId, i.Description, i.AmountCents, i.ChangedOn, $"{i.Action} (record dated {i.RecordDate:yyyy-MM-dd})")).ToList(), [],
            ["Check the audit trail for who changed each record and why.", "Confirm the change with the person who made it."],
            null);
    }
}

public sealed class FailedCollectionsRule : IGrowthRule
{
    public string Code => "FAILED_COLLECTIONS";
    public string Name => "Overdue debts with repeated failed collection attempts";
    public string Description => "Overdue customer debts where at least two collection attempts got no answer or were refused.";
    public string DefaultSeverity => Severities.Warning;

    public IEnumerable<RecommendationDraft> Evaluate(GrowthContext ctx)
    {
        var items = (A.S(ctx).Collections ?? []).Where(c => c.FailedAttempts >= 2 && c.DaysOverdue > 0 && !c.Disputed).ToList();
        if (items.Count == 0) yield break;
        yield return new RecommendationDraft(Code, RuleText.Fingerprint(Code, items.Select(i => i.DebtId.ToString())),
            $"{items.Count} overdue debt{(items.Count == 1 ? "" : "s")} need a different approach",
            Severities.Warning,
            "Several attempts to collect these debts got no answer or were refused. Repeating the same reminder is unlikely to work.",
            items.Select(i => new EvidenceItem("receivable", i.DebtId, i.CustomerName, i.OutstandingCents, null, $"{i.DaysOverdue} days overdue, {i.FailedAttempts} failed attempts")).ToList(), [],
            ["Try a different channel or a visit, and agree a small payment plan.", "Stop giving new credit to this customer until the debt is settled.", "Decide whether to write the debt off — keep a record of why."],
            items.Sum(i => i.OutstandingCents));
    }
}

// ---------------------------------------------------------------- growth insights (recommendations)

public sealed class HouseCallFeeRule : IGrowthRule
{
    public string Code => "HOUSE_CALL_FEE_REVIEW";
    public string Name => "House-call travel fee vs recorded costs";
    public string Description => "Compares travel fees charged with direct costs recorded for completed house calls in the last 60 days (needs 2+ visits with costs).";
    public string DefaultSeverity => Severities.Informational;

    public IEnumerable<RecommendationDraft> Evaluate(GrowthContext ctx)
    {
        var visits = (A.S(ctx).HouseCallCosts ?? []).Where(v => v.ActualCostsCents > 0).ToList();
        if (visits.Count < 2) yield break;
        var fees = visits.Sum(v => v.TravelFeeCents);
        var costs = visits.Sum(v => v.ActualCostsCents);
        if (costs <= fees) yield break;
        yield return new RecommendationDraft(Code, RuleText.Fingerprint(Code, visits.Select(v => v.BookingId.ToString())),
            "House-call travel fees do not cover recorded trip costs",
            Severities.Informational,
            $"Over {visits.Count} house calls you charged {FormatZar(fees)} in travel fees and recorded {FormatZar(costs)} in direct trip costs. " +
            "This only uses costs you recorded against each visit, not the barber's time.",
            visits.Select(v => new EvidenceItem("booking", v.BookingId, "House call", v.TravelFeeCents - v.ActualCostsCents, v.Date,
                $"Fee {FormatZar(v.TravelFeeCents)}, costs {FormatZar(v.ActualCostsCents)}")).ToList(), [],
            ["Review the travel fee or set a minimum fee in Settings → Bookings.", "Group house calls in the same area on the same day."],
            costs - fees);
    }
}

public sealed class StrongestServicesRule : IGrowthRule
{
    public string Code => "STRONGEST_SERVICES";
    public string Name => "Strongest services and trading days";
    public string Description => "From completed bookings in the last 60 days (needs at least 10): which services bring in the most and which weekday is busiest.";
    public string DefaultSeverity => Severities.Informational;

    public IEnumerable<RecommendationDraft> Evaluate(GrowthContext ctx)
    {
        var sales = A.S(ctx).ServiceSales ?? [];
        if (sales.Count < 10) yield break;
        var top = sales.GroupBy(s => s.ServiceName).Select(g => (Name: g.Key, Total: g.Sum(x => x.AmountCents), Count: g.Count()))
            .OrderByDescending(x => x.Total).Take(3).ToList();
        var day = sales.GroupBy(s => s.Date.DayOfWeek).Select(g => (Day: g.Key, Total: g.Sum(x => x.AmountCents))).OrderByDescending(x => x.Total).First();
        yield return new RecommendationDraft(Code, RuleText.Fingerprint(Code, [top[0].Name, day.Day.ToString(), (sales.Count / 10).ToString()]),
            $"Your strongest service is {top[0].Name}; {day.Day} is your busiest day",
            Severities.Informational,
            $"From {sales.Count} completed services recorded in the last 60 days: " + string.Join("; ", top.Select(t => $"{t.Name} {FormatZar(t.Total)} ({t.Count}×)")) +
            $". {day.Day}s brought in the most ({FormatZar(day.Total)}). Based on recorded bookings only.",
            top.Select(t => new EvidenceItem("service", null, t.Name, t.Total, null, $"{t.Count} times")).ToList(), [],
            ["Make sure enough barbers are working on your busiest day.", "Feature your strongest services on your public profile."],
            null);
    }
}

public sealed class LowStockReorderRule : IGrowthRule
{
    public string Code => "LOW_STOCK_REORDER";
    public string Name => "Items at or below their reorder level";
    public string Description => "Retail and consumable items whose stock is at or below the minimum you set.";
    public string DefaultSeverity => Severities.Informational;

    public IEnumerable<RecommendationDraft> Evaluate(GrowthContext ctx)
    {
        var low = (A.S(ctx).LowStock ?? []).Where(l => l.StockClass != "equipment").ToList();
        if (low.Count == 0) yield break;
        yield return new RecommendationDraft(Code, RuleText.Fingerprint(Code, low.Select(l => $"{l.ProductId}:{l.Quantity}")),
            $"{low.Count} item{(low.Count == 1 ? " is" : "s are")} at or below the reorder level",
            low.Any(l => l.Quantity <= 0) ? Severities.Warning : Severities.Informational,
            string.Join("; ", low.Select(l => $"{l.ProductName} at {l.BranchName}: {l.Quantity} left (reorder at {l.MinStock})")) + ".",
            low.Select(l => new EvidenceItem("product", l.ProductId, l.ProductName, null, null, $"{l.Quantity} left, minimum {l.MinStock}")).ToList(), [],
            ["Check Inventory → Reorder suggestions for how many to order (with the assumptions used).", "Record the order as a supplier bill so it appears in your cash forecast."],
            null);
    }
}
