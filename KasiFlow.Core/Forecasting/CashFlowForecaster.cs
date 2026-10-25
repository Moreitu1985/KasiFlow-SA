using KasiFlow.Core.Domain;

namespace KasiFlow.Core.Forecasting;

public static class EventKinds
{
    public const string ScheduledIncome = "scheduled_income";
    public const string ExpectedCollection = "expected_collection";
    public const string ScheduledExpense = "scheduled_expense";
    public const string SupplierBill = "supplier_bill";
}

public static class SourceTypes
{
    public const string Transaction = "transaction";
    public const string Receivable = "receivable";
    public const string Payable = "payable";
    public const string Business = "business";
}

/// <summary>A scheduled (planned, not yet happened) ledger transaction.</summary>
public sealed record ScheduledItem(Guid Id, string Type, string Description, long AmountCents, DateOnly Date, string PaymentStatus);

/// <summary>An open customer debt with its remaining balance (original − active payments − write-off).</summary>
public sealed record OpenReceivable(Guid Id, Guid CustomerId, string CustomerName, string Description, long RemainingCents, DateOnly IssueDate, DateOnly? DueDate);

/// <summary>An open supplier bill with its remaining balance.</summary>
public sealed record OpenPayable(Guid Id, Guid SupplierId, string SupplierName, string Description, long RemainingCents, DateOnly DueDate);

/// <summary>A posted transaction that is awaiting payment confirmation (not counted in cash).</summary>
public sealed record UnconfirmedItem(Guid Id, string Type, string Description, long AmountCents, DateOnly Date);

/// <summary>A provider payment still pending confirmation. Only the optimistic scenario assumes it completes.</summary>
public sealed record PendingInflow(Guid Id, string Description, long AmountCents, DateOnly Date);

public sealed record ForecastInput(
    DateOnly Today,
    int HorizonDays,
    long CurrentCashBalanceCents,
    bool OpeningBalanceConfigured,
    long CashBufferCents,
    IReadOnlyList<ScheduledItem> Scheduled,
    IReadOnlyList<OpenReceivable> Receivables,
    IReadOnlyList<OpenPayable> Payables,
    IReadOnlyList<UnconfirmedItem> Unconfirmed,
    IReadOnlyList<PendingInflow>? PendingInflows = null,
    int CountedTransactionCount = int.MaxValue,
    int HistoryDays = int.MaxValue);

public sealed record ForecastEvent(
    string Kind,
    string SourceType,
    Guid SourceId,
    string Description,
    string? Counterparty,
    long AmountCents,
    bool IsExpected,
    bool IsOverdueCarryForward)
{
    public bool IsInflow => Kind is EventKinds.ScheduledIncome or EventKinds.ExpectedCollection;
}

public sealed record ForecastDay(
    DateOnly Date,
    long OpeningBalanceCents,
    long ScheduledInflowsCents,
    long ExpectedInflowsCents,
    long OutflowsCents,
    long ExpectedClosingCents,
    long ConservativeClosingCents,
    long OptimisticClosingCents,
    bool BelowBuffer,
    bool BelowZero,
    IReadOnlyList<ForecastEvent> Events);

public sealed record ExcludedItem(string SourceType, Guid SourceId, string Description, long AmountCents, string Reason);

public sealed record BalancePoint(DateOnly Date, long BalanceCents);

public sealed record ScenarioDescription(string Key, string Name, string Assumption);

public sealed record ForecastResult(
    DateOnly AsOf,
    int HorizonDays,
    long OpeningBalanceCents,
    long CashBufferCents,
    bool OpeningBalanceConfigured,
    IReadOnlyList<ForecastDay> Days,
    BalancePoint LowestExpected,
    BalancePoint LowestConservative,
    DateOnly? FirstShortageDate,
    DateOnly? FirstBelowBufferDate,
    DateOnly? FirstConservativeShortageDate,
    long TotalScheduledInflowsCents,
    long TotalExpectedInflowsCents,
    long TotalOutflowsCents,
    IReadOnlyList<ExcludedItem> Excluded,
    IReadOnlyList<string> Assumptions,
    BalancePoint LowestOptimistic,
    long TotalOptimisticExtraCents,
    bool IsPreliminary,
    string? PreliminaryReason,
    IReadOnlyList<ScenarioDescription> Scenarios)
{
    public DateOnly EndDate => Days[^1].Date;
    public long ClosingExpectedCents => Days[^1].ExpectedClosingCents;
}

/// <summary>
/// Deterministic daily cash-flow forecast.
/// <para>Day 0 is today. Its opening balance is the current cash balance (which already includes every
/// counted transaction dated today). Each later day opens with the previous day's closing balance.</para>
/// <para>Two balances are projected:
/// <b>expected</b> = opening + scheduled income + expected customer collections − outflows;
/// <b>conservative</b> = the same but WITHOUT expected customer collections (they may not arrive).</para>
/// <para>Double counting is impossible by construction: posted cash is only in the opening balance;
/// receivables/payables contribute only their remaining (unpaid) balance; scheduled transactions are
/// separate planned movements that have not yet been posted.</para>
/// </summary>
public static class CashFlowForecaster
{
    public const int MinHorizon = 7;
    public const int MaxHorizon = 90;
    public const int PreliminaryMinTransactions = 10;
    public const int PreliminaryMinHistoryDays = 14;

    public static ForecastResult Build(ForecastInput input)
    {
        if (input.HorizonDays is < MinHorizon or > MaxHorizon)
            throw new ArgumentOutOfRangeException(nameof(input), $"Horizon must be between {MinHorizon} and {MaxHorizon} days.");
        if (input.CashBufferCents < 0)
            throw new ArgumentOutOfRangeException(nameof(input), "Cash buffer cannot be negative.");

        var today = input.Today;
        var end = today.AddDays(input.HorizonDays - 1);
        var eventsByDay = new Dictionary<DateOnly, List<ForecastEvent>>();
        var excluded = new List<ExcludedItem>();

        void Add(DateOnly date, ForecastEvent e)
        {
            if (!eventsByDay.TryGetValue(date, out var list)) eventsByDay[date] = list = new List<ForecastEvent>();
            list.Add(e);
        }

        // 1. Scheduled (planned) ledger transactions.
        foreach (var s in input.Scheduled)
        {
            if (s.AmountCents <= 0) continue;
            if (s.Date < today)
            {
                excluded.Add(new ExcludedItem(SourceTypes.Transaction, s.Id, s.Description,
                    s.Type == TransactionTypes.Income ? s.AmountCents : -s.AmountCents,
                    "Scheduled date has passed. Post it if it happened, or move it to a new date."));
                continue;
            }
            if (s.Date > end) continue;
            if (s.PaymentStatus is PaymentStatuses.Failed or PaymentStatuses.Cancelled)
            {
                excluded.Add(new ExcludedItem(SourceTypes.Transaction, s.Id, s.Description,
                    s.Type == TransactionTypes.Income ? s.AmountCents : -s.AmountCents,
                    "Marked as failed or cancelled."));
                continue;
            }
            Add(s.Date, new ForecastEvent(
                s.Type == TransactionTypes.Income ? EventKinds.ScheduledIncome : EventKinds.ScheduledExpense,
                SourceTypes.Transaction, s.Id, s.Description, null, s.AmountCents, IsExpected: false, IsOverdueCarryForward: false));
        }

        // 2. Expected customer collections (receivables) — only those due within the horizon.
        foreach (var r in input.Receivables)
        {
            if (r.RemainingCents <= 0) continue;
            if (r.DueDate is null)
            {
                excluded.Add(new ExcludedItem(SourceTypes.Receivable, r.Id, $"{r.CustomerName}: {r.Description}", r.RemainingCents,
                    "No due date, so the collection date cannot be forecast. Add a due date to include it."));
                continue;
            }
            if (r.DueDate < today)
            {
                excluded.Add(new ExcludedItem(SourceTypes.Receivable, r.Id, $"{r.CustomerName}: {r.Description}", r.RemainingCents,
                    $"Overdue since {r.DueDate:yyyy-MM-dd}. Overdue debts are not assumed to be paid; follow up and record the payment when it arrives."));
                continue;
            }
            if (r.DueDate > end) continue;
            Add(r.DueDate.Value, new ForecastEvent(EventKinds.ExpectedCollection, SourceTypes.Receivable, r.Id, r.Description,
                r.CustomerName, r.RemainingCents, IsExpected: true, IsOverdueCarryForward: false));
        }

        // 3. Supplier bills — overdue bills are treated as payable today (conservative).
        foreach (var p in input.Payables)
        {
            if (p.RemainingCents <= 0) continue;
            if (p.DueDate > end) continue;
            var overdue = p.DueDate < today;
            Add(overdue ? today : p.DueDate, new ForecastEvent(EventKinds.SupplierBill, SourceTypes.Payable, p.Id, p.Description,
                p.SupplierName, p.RemainingCents, IsExpected: false, IsOverdueCarryForward: overdue));
        }

        // 3b. Optimistic-only extras: overdue debts collected tomorrow, pending provider payments completing tomorrow.
        var optimisticExtra = new Dictionary<DateOnly, long>();
        var tomorrow = today.AddDays(1);
        foreach (var r in input.Receivables.Where(r => r.RemainingCents > 0 && r.DueDate is { } dd && dd < today))
            optimisticExtra[tomorrow] = optimisticExtra.GetValueOrDefault(tomorrow) + r.RemainingCents;
        foreach (var pnd in input.PendingInflows ?? Array.Empty<PendingInflow>())
        {
            if (pnd.AmountCents <= 0) continue;
            optimisticExtra[tomorrow] = optimisticExtra.GetValueOrDefault(tomorrow) + pnd.AmountCents;
            excluded.Add(new ExcludedItem(SourceTypes.Transaction, pnd.Id, pnd.Description, pnd.AmountCents,
                "Provider payment still pending. Only the optimistic scenario assumes it completes."));
        }

        // 4. Unconfirmed payments are reported, never counted.
        foreach (var u in input.Unconfirmed)
        {
            excluded.Add(new ExcludedItem(SourceTypes.Transaction, u.Id, u.Description,
                u.Type == TransactionTypes.Income ? u.AmountCents : -u.AmountCents,
                "Awaiting payment confirmation, so it is not counted in cash. Confirm it once the money is verified in your account."));
        }

        // 5. Walk the days.
        var days = new List<ForecastDay>(input.HorizonDays);
        long expected = input.CurrentCashBalanceCents;
        long conservative = input.CurrentCashBalanceCents;
        long optimistic = input.CurrentCashBalanceCents;
        long totalOptimisticExtra = 0;
        var lowestOpt = new BalancePoint(today, long.MaxValue);
        long totalScheduledIn = 0, totalExpectedIn = 0, totalOut = 0;
        DateOnly? firstShortage = null, firstBelowBuffer = null, firstConsShortage = null;
        var lowestExp = new BalancePoint(today, long.MaxValue);
        var lowestCons = new BalancePoint(today, long.MaxValue);

        for (var i = 0; i < input.HorizonDays; i++)
        {
            var date = today.AddDays(i);
            var events = eventsByDay.TryGetValue(date, out var l)
                ? l.OrderBy(e => e.IsInflow ? 0 : 1).ThenByDescending(e => e.AmountCents).ThenBy(e => e.SourceId).ToList()
                : new List<ForecastEvent>();

            long scheduledIn = 0, expectedIn = 0, outflows = 0;
            foreach (var e in events)
            {
                switch (e.Kind)
                {
                    case EventKinds.ScheduledIncome: scheduledIn = checked(scheduledIn + e.AmountCents); break;
                    case EventKinds.ExpectedCollection: expectedIn = checked(expectedIn + e.AmountCents); break;
                    default: outflows = checked(outflows + e.AmountCents); break;
                }
            }

            var opening = expected;
            expected = checked(expected + scheduledIn + expectedIn - outflows);
            conservative = checked(conservative + scheduledIn - outflows);
            var extra = optimisticExtra.GetValueOrDefault(date);
            totalOptimisticExtra += extra;
            optimistic = checked(optimistic + scheduledIn + expectedIn + extra - outflows);
            if (optimistic < lowestOpt.BalanceCents) lowestOpt = new BalancePoint(date, optimistic);
            totalScheduledIn += scheduledIn;
            totalExpectedIn += expectedIn;
            totalOut += outflows;

            var belowZero = expected < 0;
            var belowBuffer = input.CashBufferCents > 0 && expected < input.CashBufferCents;
            if (belowZero && firstShortage is null) firstShortage = date;
            if (belowBuffer && firstBelowBuffer is null) firstBelowBuffer = date;
            if (conservative < 0 && firstConsShortage is null) firstConsShortage = date;
            if (expected < lowestExp.BalanceCents) lowestExp = new BalancePoint(date, expected);
            if (conservative < lowestCons.BalanceCents) lowestCons = new BalancePoint(date, conservative);

            days.Add(new ForecastDay(date, opening, scheduledIn, expectedIn, outflows, expected, conservative, optimistic, belowBuffer, belowZero, events));
        }

        var assumptions = BuildAssumptions(input);

        string? prelim = null;
        if (input.CountedTransactionCount < PreliminaryMinTransactions)
            prelim = $"Only {input.CountedTransactionCount} confirmed transaction{(input.CountedTransactionCount == 1 ? "" : "s")} recorded so far. Treat this forecast as preliminary until at least {PreliminaryMinTransactions} are recorded.";
        else if (input.HistoryDays < PreliminaryMinHistoryDays)
            prelim = $"Records cover only {input.HistoryDays} day{(input.HistoryDays == 1 ? "" : "s")}. Treat this forecast as preliminary until you have at least {PreliminaryMinHistoryDays} days of records.";

        var scenarios = new List<ScenarioDescription>
        {
            new("expected", "Expected", "Recorded cash, scheduled items, supplier bills on their due dates, and customer debts collected on their due dates."),
            new("conservative", "Conservative", "Same as expected, but no customer debts are collected."),
            new("optimistic", "Optimistic", "Same as expected, plus overdue customer debts and pending provider payments arriving tomorrow."),
        };

        return new ForecastResult(today, input.HorizonDays, input.CurrentCashBalanceCents, input.CashBufferCents,
            input.OpeningBalanceConfigured, days, lowestExp, lowestCons, firstShortage, firstBelowBuffer, firstConsShortage,
            totalScheduledIn, totalExpectedIn, totalOut,
            excluded.OrderBy(e => e.SourceType, StringComparer.Ordinal).ThenBy(e => e.Description, StringComparer.Ordinal).ToList(),
            assumptions, lowestOpt, totalOptimisticExtra, prelim is not null, prelim, scenarios);
    }

    private static List<string> BuildAssumptions(ForecastInput input)
    {
        var list = new List<string>
        {
            "Day 0 is today (South African time). The starting balance is your current recorded cash balance: opening balance plus posted, confirmed income minus posted, confirmed expenses.",
            "Expected customer collections are placed on each debt's due date for the unpaid amount only. They are NOT guaranteed — the conservative line shows your cash if none of them arrive.",
            "Overdue customer debts and debts without a due date are not assumed to be paid.",
            "Supplier bills are placed on their due date for the unpaid amount. Overdue bills are treated as payable today.",
            "Scheduled transactions you entered are included on their dates. Payments awaiting confirmation are not counted.",
            "Nothing is double counted: payments you have already recorded reduce the debt or bill balance and appear only once, in your cash balance.",
            "Regular income or costs that you have not recorded or scheduled (for example daily walk-in sales) are not projected. Record or schedule them to improve the forecast.",
            "Scenarios are estimates, not guarantees: conservative assumes no customer debts are paid; optimistic assumes overdue debts and pending provider payments arrive tomorrow."
        };
        if (!input.OpeningBalanceConfigured)
            list.Insert(1, "No opening cash balance has been set, so the starting balance only reflects recorded transactions. Set it under Settings for a reliable forecast.");
        if (input.CashBufferCents > 0)
            list.Add($"Your selected safety buffer is {Common.Money.FormatZar(input.CashBufferCents)}. Days below it are flagged.");
        return list;
    }
}
