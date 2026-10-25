using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using KasiFlow.Core.Domain;
using KasiFlow.Core.Forecasting;
using static KasiFlow.Core.Common.Money;

namespace KasiFlow.Core.Growth;

internal static class RuleText
{
    public static string Date(DateOnly d) => d.ToString("ddd d MMM yyyy", CultureInfo.InvariantCulture);

    public static string InDays(DateOnly today, DateOnly date)
    {
        var n = date.DayNumber - today.DayNumber;
        return n switch
        {
            <= 0 => "today",
            1 => "tomorrow",
            _ => $"in {n} days"
        };
    }

    public static string Fingerprint(string code, IEnumerable<string> parts)
    {
        var joined = string.Join("|", parts.OrderBy(p => p, StringComparer.Ordinal));
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(joined));
        return $"{code}:{Convert.ToHexString(hash, 0, 8).ToLowerInvariant()}";
    }

    public static EvidenceItem FromEvent(ForecastEvent e, DateOnly date)
    {
        var label = e.Kind switch
        {
            EventKinds.SupplierBill => $"Supplier bill: {e.Counterparty} — {e.Description}",
            EventKinds.ExpectedCollection => $"Expected from {e.Counterparty} — {e.Description}",
            EventKinds.ScheduledIncome => $"Scheduled income — {e.Description}",
            _ => $"Scheduled expense — {e.Description}"
        };
        var detail = e.Kind switch
        {
            EventKinds.SupplierBill when e.IsOverdueCarryForward => "Overdue bill, treated as payable today",
            EventKinds.SupplierBill => "Money out (bill due)",
            EventKinds.ExpectedCollection => "Expected money in — not yet confirmed",
            EventKinds.ScheduledIncome => "Planned money in",
            _ => "Planned money out"
        };
        return new EvidenceItem(e.SourceType, e.SourceId, label, e.IsInflow ? e.AmountCents : -e.AmountCents, date, detail);
    }
}

/// <summary>Projected expected balance drops below zero within the horizon.</summary>
public sealed class CashShortfallRule : IGrowthRule
{
    public string Code => "CASH_SHORTFALL";
    public string Name => "Projected cash shortage";
    public string Description => "Flags the first day your projected cash balance (including expected customer payments) falls below zero.";
    public string DefaultSeverity => Severities.Critical;

    public IEnumerable<RecommendationDraft> Evaluate(GrowthContext ctx)
    {
        var f = ctx.Forecast;
        if (f.FirstShortageDate is not { } shortageDate) yield break;

        var shortageDay = f.Days.First(d => d.Date == shortageDate);
        var upToShortage = f.Days.Where(d => d.Date <= shortageDate).ToList();
        var outflowsBefore = upToShortage.SelectMany(d => d.Events.Where(e => !e.IsInflow).Select(e => (d.Date, e))).ToList();
        var inflowsBefore = upToShortage.SelectMany(d => d.Events.Where(e => e.IsInflow).Select(e => (d.Date, e))).ToList();
        var laterInflows = f.Days.Where(d => d.Date > shortageDate)
            .SelectMany(d => d.Events.Where(e => e.IsInflow).Select(e => (d.Date, e))).ToList();

        var evidence = new List<EvidenceItem>
        {
            new(SourceTypes.Business, null, "Current recorded cash balance", ctx.CurrentCashBalanceCents, ctx.Today,
                ctx.OpeningBalanceConfigured ? "Opening balance plus recorded, confirmed transactions" : "Opening balance not set — based on recorded transactions only")
        };
        evidence.AddRange(outflowsBefore.Select(x => RuleText.FromEvent(x.e, x.Date)));
        evidence.AddRange(inflowsBefore.Select(x => RuleText.FromEvent(x.e, x.Date)));
        evidence.AddRange(laterInflows.Take(5).Select(x => RuleText.FromEvent(x.e, x.Date) with { Detail = "Expected AFTER the shortage date — cannot help in time" }));

        var outTotal = outflowsBefore.Sum(x => x.e.AmountCents);
        var inTotal = inflowsBefore.Sum(x => x.e.AmountCents);
        var shortfall = -f.LowestExpected.BalanceCents;

        var why = new StringBuilder();
        why.Append($"Your projected cash balance falls to {FormatZar(shortageDay.ExpectedClosingCents)} on {RuleText.Date(shortageDate)}. ");
        why.Append($"You have {FormatZar(ctx.CurrentCashBalanceCents)} recorded today, and {FormatZar(outTotal)} is due to go out by then");
        why.Append(inTotal > 0 ? $", while only {FormatZar(inTotal)} is expected or scheduled to come in before that date. " : ", with no money expected in before that date. ");
        if (laterInflows.Count > 0)
            why.Append($"{FormatZar(laterInflows.Sum(x => x.e.AmountCents))} is expected after the shortage date, which is too late to cover it. ");
        if (inflowsBefore.Any(x => x.e.IsExpected))
            why.Append("Some of the money in is only expected from customers and is not confirmed, so the real position could be worse.");

        var actions = new List<string>();
        var overdue = ctx.OpenReceivables.Where(r => r.DueDate is { } d && d < ctx.Today).ToList();
        if (overdue.Count > 0)
            actions.Add($"Follow up on overdue customer payments ({FormatZar(overdue.Sum(r => r.RemainingCents))} across {overdue.Count} debt{(overdue.Count == 1 ? "" : "s")}).");
        var expectedBefore = inflowsBefore.Where(x => x.e.IsExpected).ToList();
        if (expectedBefore.Count > 0)
            actions.Add("Confirm with customers who are due to pay before the shortage date that they will pay on time.");
        var bills = outflowsBefore.Where(x => x.e.Kind == EventKinds.SupplierBill).Select(x => x.e.Counterparty).Distinct().ToList();
        if (bills.Count > 0)
            actions.Add($"Contact {string.Join(", ", bills)} early to discuss whether a payment arrangement or a later date is available.");
        actions.Add("Review upcoming discretionary spending and stock purchases you could delay until after the shortage date.");
        actions.Add("Record any cash sales and payments you have not captured yet — the forecast only knows what is recorded.");

        yield return new RecommendationDraft(
            Code,
            $"{Code}:{shortageDate:yyyy-MM-dd}",
            $"Potential cash shortage {RuleText.InDays(ctx.Today, shortageDate)}",
            Severities.Critical,
            why.ToString().Trim(),
            evidence,
            new List<RelevantDate>
            {
                new("First day below zero", shortageDate),
                new("Lowest projected balance", f.LowestExpected.Date)
            },
            actions,
            shortfall > 0 ? shortfall : null);
    }
}

/// <summary>Projected balance stays positive but dips below the user's chosen safety buffer.</summary>
public sealed class BelowBufferRule : IGrowthRule
{
    public string Code => "BELOW_BUFFER";
    public string Name => "Cash below your safety buffer";
    public string Description => "Flags when projected cash stays above zero but drops below the safety buffer you chose in Settings.";
    public string DefaultSeverity => Severities.Warning;

    public IEnumerable<RecommendationDraft> Evaluate(GrowthContext ctx)
    {
        var f = ctx.Forecast;
        if (ctx.CashBufferCents <= 0 || f.FirstShortageDate is not null || f.FirstBelowBufferDate is not { } date) yield break;

        var day = f.Days.First(d => d.Date == date);
        var outflows = f.Days.Where(d => d.Date <= date)
            .SelectMany(d => d.Events.Where(e => !e.IsInflow).Select(e => RuleText.FromEvent(e, d.Date))).ToList();

        var evidence = new List<EvidenceItem>
        {
            new(SourceTypes.Business, null, "Current recorded cash balance", ctx.CurrentCashBalanceCents, ctx.Today, null),
            new(SourceTypes.Business, null, "Your safety buffer", ctx.CashBufferCents, null, "Set in Settings")
        };
        evidence.AddRange(outflows);

        yield return new RecommendationDraft(
            Code,
            $"{Code}:{date:yyyy-MM-dd}",
            $"Cash drops below your safety buffer {RuleText.InDays(ctx.Today, date)}",
            Severities.Warning,
            $"Your projected balance is {FormatZar(day.ExpectedClosingCents)} on {RuleText.Date(date)}, below your buffer of {FormatZar(ctx.CashBufferCents)}. " +
            $"The lowest point is {FormatZar(f.LowestExpected.BalanceCents)} on {RuleText.Date(f.LowestExpected.Date)}. You are not projected to run out, but you would have less room for surprises.",
            evidence,
            new List<RelevantDate> { new("First day below buffer", date), new("Lowest projected balance", f.LowestExpected.Date) },
            new List<string>
            {
                "Check which bills or planned expenses fall before this date and whether any can safely move later.",
                "Follow up on customer payments that are due soon.",
                "Avoid new non-essential spending until the balance recovers."
            },
            ctx.CashBufferCents - f.LowestExpected.BalanceCents);
    }
}

/// <summary>Cash only stays positive if expected customer payments arrive.</summary>
public sealed class RelianceOnCollectionsRule : IGrowthRule
{
    public string Code => "RELIES_ON_COLLECTIONS";
    public string Name => "Depends on customers paying on time";
    public string Description => "Flags when the forecast stays positive only because of expected (unconfirmed) customer payments.";
    public string DefaultSeverity => Severities.Warning;

    public IEnumerable<RecommendationDraft> Evaluate(GrowthContext ctx)
    {
        var f = ctx.Forecast;
        if (f.FirstShortageDate is not null || f.FirstConservativeShortageDate is not { } date) yield break;

        var expected = f.Days.Where(d => d.Date <= date)
            .SelectMany(d => d.Events.Where(e => e.Kind == EventKinds.ExpectedCollection).Select(e => RuleText.FromEvent(e, d.Date))).ToList();
        var consDay = f.Days.First(d => d.Date == date);

        yield return new RecommendationDraft(
            Code,
            $"{Code}:{date:yyyy-MM-dd}",
            "Your cash depends on customers paying on time",
            Severities.Warning,
            $"If the expected customer payments below do not arrive, your cash would fall to {FormatZar(consDay.ConservativeClosingCents)} on {RuleText.Date(date)}. " +
            "The main forecast stays positive only because it includes these expected payments.",
            expected,
            new List<RelevantDate> { new("Shortage date if customers do not pay", date) },
            new List<string>
            {
                "Send a friendly reminder to these customers a few days before their due dates.",
                "Ask whether partial payments are possible if a customer cannot pay in full.",
                "Hold back on optional spending until the payments are confirmed."
            },
            null);
    }
}

public sealed class OverdueReceivablesRule : IGrowthRule
{
    public string Code => "OVERDUE_RECEIVABLES";
    public string Name => "Overdue customer debts";
    public string Description => "Lists customer debts that are past their due date and still unpaid.";
    public string DefaultSeverity => Severities.Warning;

    public IEnumerable<RecommendationDraft> Evaluate(GrowthContext ctx)
    {
        var overdue = ctx.OpenReceivables
            .Where(r => r.RemainingCents > 0 && r.DueDate is { } d && d < ctx.Today)
            .OrderBy(r => r.DueDate).ThenByDescending(r => r.RemainingCents).ToList();
        if (overdue.Count == 0) yield break;

        var total = overdue.Sum(r => r.RemainingCents);
        var oldest = overdue[0].DueDate!.Value;
        var daysOldest = ctx.Today.DayNumber - oldest.DayNumber;

        yield return new RecommendationDraft(
            Code,
            RuleText.Fingerprint(Code, overdue.Select(r => r.Id.ToString())),
            $"{FormatZar(total)} in customer debts is overdue",
            Severities.Warning,
            $"{overdue.Count} customer debt{(overdue.Count == 1 ? " is" : "s are")} past due, totalling {FormatZar(total)}. The oldest has been overdue for {daysOldest} day{(daysOldest == 1 ? "" : "s")}. " +
            "Overdue debts are left out of your cash forecast because their payment date is uncertain.",
            overdue.Select(r => new EvidenceItem(SourceTypes.Receivable, r.Id, $"{r.CustomerName} — {r.Description}", r.RemainingCents, r.DueDate,
                $"{ctx.Today.DayNumber - r.DueDate!.Value.DayNumber} days overdue")).ToList(),
            new List<RelevantDate> { new("Oldest due date", oldest) },
            new List<string>
            {
                "Send each customer a polite, personal reminder (use the reminder template on the debt).",
                "Offer a simple payment plan or partial payments if the full amount is difficult.",
                "Record payments as soon as they arrive so your forecast stays accurate.",
                "Consider limiting new credit to customers with long-overdue balances."
            },
            total);
    }
}

public sealed class OverdueBillsRule : IGrowthRule
{
    public string Code => "OVERDUE_BILLS";
    public string Name => "Overdue supplier bills";
    public string Description => "Lists supplier bills that are past their due date and unpaid.";
    public string DefaultSeverity => Severities.Warning;

    public IEnumerable<RecommendationDraft> Evaluate(GrowthContext ctx)
    {
        var overdue = ctx.OpenPayables.Where(p => p.RemainingCents > 0 && p.DueDate < ctx.Today)
            .OrderBy(p => p.DueDate).ToList();
        if (overdue.Count == 0) yield break;
        var total = overdue.Sum(p => p.RemainingCents);

        yield return new RecommendationDraft(
            Code,
            RuleText.Fingerprint(Code, overdue.Select(p => p.Id.ToString())),
            $"{overdue.Count} supplier bill{(overdue.Count == 1 ? " is" : "s are")} overdue",
            Severities.Warning,
            $"You have {FormatZar(total)} in supplier bills past their due date. The forecast treats these as payable today. Late payments can affect supplier relationships and credit terms.",
            overdue.Select(p => new EvidenceItem(SourceTypes.Payable, p.Id, $"{p.SupplierName} — {p.Description}", -p.RemainingCents, p.DueDate,
                $"{ctx.Today.DayNumber - p.DueDate.DayNumber} days overdue")).ToList(),
            new List<RelevantDate> { new("Oldest due date", overdue[0].DueDate) },
            new List<string>
            {
                "Contact the supplier to explain and agree on a payment date.",
                "If you have already paid, record the payment so the bill is closed.",
                "Before paying, confirm the supplier's banking details through a contact number you already trust."
            },
            null);
    }
}

public sealed class BillsDueSoonRule : IGrowthRule
{
    public const int WindowDays = 7;
    public string Code => "BILLS_DUE_SOON";
    public string Name => "Supplier bills due soon";
    public string Description => $"Summarises supplier bills due in the next {WindowDays} days and whether current cash covers them.";
    public string DefaultSeverity => Severities.Informational;

    public IEnumerable<RecommendationDraft> Evaluate(GrowthContext ctx)
    {
        var end = ctx.Today.AddDays(WindowDays - 1);
        var due = ctx.OpenPayables.Where(p => p.RemainingCents > 0 && p.DueDate >= ctx.Today && p.DueDate <= end)
            .OrderBy(p => p.DueDate).ToList();
        if (due.Count == 0) yield break;
        var total = due.Sum(p => p.RemainingCents);
        var covered = ctx.CurrentCashBalanceCents >= total;

        yield return new RecommendationDraft(
            Code,
            RuleText.Fingerprint(Code, due.Select(p => p.Id.ToString())),
            $"{FormatZar(total)} in supplier bills due in the next {WindowDays} days",
            covered ? Severities.Informational : Severities.Warning,
            covered
                ? $"{due.Count} bill{(due.Count == 1 ? " is" : "s are")} due soon. Your current recorded cash ({FormatZar(ctx.CurrentCashBalanceCents)}) covers them."
                : $"{due.Count} bill{(due.Count == 1 ? " is" : "s are")} due soon, but your current recorded cash ({FormatZar(ctx.CurrentCashBalanceCents)}) is less than the {FormatZar(total)} due.",
            due.Select(p => new EvidenceItem(SourceTypes.Payable, p.Id, $"{p.SupplierName} — {p.Description}", -p.RemainingCents, p.DueDate, "Due")).ToList(),
            due.Select(p => new RelevantDate($"{p.SupplierName} due", p.DueDate)).ToList(),
            covered
                ? new List<string> { "Plan when you will make each payment and record it once paid.", "Verify banking details independently before paying a new or changed account." }
                : new List<string> { "Prioritise which bills must be paid first.", "Contact suppliers early if you need more time.", "Follow up on customer payments that are due." },
            null);
    }
}

/// <summary>Recent spending is unusually high compared with a historical baseline. Requires enough history.</summary>
public sealed class ExpenseSpikeRule : IGrowthRule
{
    public const int WindowDays = 30;
    public const int BaselineWindows = 3;
    public const decimal Threshold = 1.5m;
    public const long MinimumIncreaseCents = 50_000; // R500 — ignore tiny absolute changes

    public string Code => "EXPENSE_SPIKE";
    public string Name => "Unusually high spending";
    public string Description => "Compares expenses in the last 30 days with your average over the previous 90 days. Only runs when every one of those earlier 30-day periods has recorded expenses.";
    public string DefaultSeverity => Severities.Warning;

    public static bool HasEnoughHistory(GrowthContext ctx, out long recentTotal, out long baselineAverage)
    {
        var recentStart = ctx.Today.AddDays(-(WindowDays - 1));
        recentTotal = ctx.ExpenseHistory.Where(e => e.Date >= recentStart && e.Date <= ctx.Today).Sum(e => e.AmountCents);
        long baseline = 0;
        baselineAverage = 0;
        for (var w = 1; w <= BaselineWindows; w++)
        {
            var end = recentStart.AddDays(-1 - (w - 1) * WindowDays);
            var start = end.AddDays(-(WindowDays - 1));
            var windowTotal = ctx.ExpenseHistory.Where(e => e.Date >= start && e.Date <= end).Sum(e => e.AmountCents);
            if (windowTotal <= 0) return false;
            baseline += windowTotal;
        }
        baselineAverage = baseline / BaselineWindows;
        return true;
    }

    public IEnumerable<RecommendationDraft> Evaluate(GrowthContext ctx)
    {
        if (!HasEnoughHistory(ctx, out var recent, out var avg)) yield break;
        if (avg <= 0 || recent < avg * Threshold || recent - avg < MinimumIncreaseCents) yield break;

        var recentStart = ctx.Today.AddDays(-(WindowDays - 1));
        var baselineStart = recentStart.AddDays(-WindowDays * BaselineWindows);
        var byCategory = ctx.ExpenseHistory
            .GroupBy(e => e.Category)
            .Select(g => new
            {
                Category = g.Key,
                Recent = g.Where(e => e.Date >= recentStart).Sum(e => e.AmountCents),
                Avg = g.Where(e => e.Date >= baselineStart && e.Date < recentStart).Sum(e => e.AmountCents) / BaselineWindows
            })
            .Where(c => c.Recent > c.Avg)
            .OrderByDescending(c => c.Recent - c.Avg)
            .Take(5)
            .ToList();

        var pct = (int)Math.Round((recent - avg) * 100m / avg, MidpointRounding.AwayFromZero);
        yield return new RecommendationDraft(
            Code,
            $"{Code}:{ctx.Today:yyyy-MM}",
            $"Spending is {pct}% higher than usual",
            Severities.Warning,
            $"You recorded {FormatZar(recent)} in expenses in the last {WindowDays} days, compared with an average of {FormatZar(avg)} per {WindowDays} days over the previous {WindowDays * BaselineWindows} days. " +
            "This may be expected (for example a stock-up or equipment purchase), but it is worth checking.",
            byCategory.Select(c => new EvidenceItem(SourceTypes.Business, null, $"Category: {c.Category}", c.Recent, null,
                $"Last {WindowDays} days vs average {FormatZar(c.Avg)}")).ToList(),
            new List<RelevantDate> { new("Comparison period starts", recentStart) },
            new List<string>
            {
                "Review the categories that increased the most and confirm each expense was planned.",
                "Check for duplicate or incorrect entries.",
                "Compare supplier prices if stock costs have gone up."
            },
            recent - avg);
    }
}

public sealed class DebtConcentrationRule : IGrowthRule
{
    public const long MinimumOutstandingCents = 100_000; // R1,000
    public const decimal ShareThreshold = 0.5m;
    public string Code => "DEBT_CONCENTRATION";
    public string Name => "Debt concentrated in one customer";
    public string Description => "Flags when one customer owes at least half of all outstanding customer debt (and total debt is at least R1,000).";
    public string DefaultSeverity => Severities.Informational;

    public IEnumerable<RecommendationDraft> Evaluate(GrowthContext ctx)
    {
        var byCustomer = ctx.OpenReceivables.Where(r => r.RemainingCents > 0)
            .GroupBy(r => (r.CustomerId, r.CustomerName))
            .Select(g => (g.Key.CustomerId, g.Key.CustomerName, Total: g.Sum(r => r.RemainingCents), Items: g.ToList()))
            .OrderByDescending(x => x.Total).ThenBy(x => x.CustomerId).ToList();
        var total = byCustomer.Sum(x => x.Total);
        if (total < MinimumOutstandingCents || byCustomer.Count == 0) yield break;
        var top = byCustomer[0];
        var share = (decimal)top.Total / total;
        if (share < ShareThreshold) yield break;
        var pct = (int)Math.Round(share * 100m, MidpointRounding.AwayFromZero);

        yield return new RecommendationDraft(
            Code,
            $"{Code}:{top.CustomerId}",
            $"{top.CustomerName} owes {pct}% of your outstanding customer debt",
            Severities.Informational,
            $"{top.CustomerName} owes {FormatZar(top.Total)} of the {FormatZar(total)} customers owe you. If this customer pays late, a large part of your expected income is affected.",
            top.Items.Select(r => new EvidenceItem(SourceTypes.Receivable, r.Id, r.Description, r.RemainingCents, r.DueDate,
                r.DueDate is null ? "No due date" : null)).ToList(),
            top.Items.Where(r => r.DueDate is not null).Select(r => new RelevantDate($"Due: {r.Description}", r.DueDate!.Value)).ToList(),
            new List<string>
            {
                "Agree clear due dates and a payment plan with this customer.",
                "Consider a credit limit before extending more credit to the same customer.",
                "Encourage cash or upfront payment for new orders where possible."
            },
            null);
    }
}

/// <summary>Missing information that reduces forecast reliability.</summary>
public sealed class DataQualityRule : IGrowthRule
{
    public const int StaleDays = 14;
    public string Code => "DATA_QUALITY";
    public string Name => "Missing information";
    public string Description => "Points out missing or out-of-date records that make the forecast and insights less reliable.";
    public string DefaultSeverity => Severities.Informational;

    public IEnumerable<RecommendationDraft> Evaluate(GrowthContext ctx)
    {
        var gaps = new List<(string Key, EvidenceItem Evidence, string Action)>();

        if (!ctx.OpeningBalanceConfigured)
            gaps.Add(("opening", new EvidenceItem(SourceTypes.Business, null, "Opening cash balance not set", null, null,
                "The forecast starts only from recorded transactions."),
                "Set your opening cash balance and its date in Settings."));

        if (ctx.PostedTransactionCount == 0)
            gaps.Add(("no_tx", new EvidenceItem(SourceTypes.Business, null, "No transactions recorded yet", null, null, null),
                "Record your sales and expenses — even a few days of records make the insights useful."));
        else if (ctx.LastPostedTransactionDate is { } last && ctx.Today.DayNumber - last.DayNumber > StaleDays)
            gaps.Add(("stale", new EvidenceItem(SourceTypes.Business, null, $"No transactions recorded in the last {StaleDays} days", null, last, "Last recorded transaction"),
                "Catch up on recent sales and expenses."));

        foreach (var r in ctx.OpenReceivables.Where(r => r.DueDate is null && r.RemainingCents > 0))
            gaps.Add(($"nodue:{r.Id}", new EvidenceItem(SourceTypes.Receivable, r.Id, $"{r.CustomerName} — {r.Description}: no due date", r.RemainingCents, null,
                "Not included in the forecast"), "Add due dates to customer debts so they can be forecast."));

        foreach (var x in ctx.Forecast.Excluded.Where(e => e.SourceType == SourceTypes.Transaction && e.Reason.StartsWith("Scheduled date has passed", StringComparison.Ordinal)))
            gaps.Add(($"stale_sched:{x.SourceId}", new EvidenceItem(SourceTypes.Transaction, x.SourceId, $"{x.Description}: scheduled date has passed", x.AmountCents, null, null),
                "Post or reschedule planned transactions whose dates have passed."));

        foreach (var u in ctx.Unconfirmed.Where(u => ctx.Today.DayNumber - u.Date.DayNumber > 7))
            gaps.Add(($"unconfirmed:{u.Id}", new EvidenceItem(SourceTypes.Transaction, u.Id, $"{u.Description}: awaiting confirmation for more than 7 days",
                u.Type == TransactionTypes.Income ? u.AmountCents : -u.AmountCents, u.Date, "Not counted in cash"),
                "Check your bank or payment app and update payments still marked as awaiting confirmation. Do not rely on screenshots or SMS messages as proof."));

        if (ctx.PostedTransactionCount > 0 && !ExpenseSpikeRule.HasEnoughHistory(ctx, out _, out _))
            gaps.Add(("history", new EvidenceItem(SourceTypes.Business, null, "Less than 120 days of expense history", null, null,
                "The unusual-spending check stays off until there is enough history to compare against."),
                "Keep recording expenses consistently; spending comparisons switch on automatically."));

        if (gaps.Count == 0) yield break;

        var actions = gaps.Select(g => g.Action).Distinct().ToList();
        yield return new RecommendationDraft(
            Code,
            RuleText.Fingerprint(Code, gaps.Select(g => g.Key)),
            gaps.Count == 1 ? "One gap is limiting your insights" : $"{gaps.Count} gaps are limiting your insights",
            Severities.Informational,
            "KasiFlow only works with what you record. The items below reduce how reliable your forecast and recommendations are.",
            gaps.Select(g => g.Evidence).ToList(),
            new List<RelevantDate>(),
            actions,
            null);
    }
}
