using KasiFlow.Core.Common;
using KasiFlow.Core.Domain;

namespace KasiFlow.Core.Finance;

/// <summary>A cash-ledger row as needed by the calculations.</summary>
public sealed record LedgerEntry(
    Guid Id,
    string Type,
    long AmountCents,
    DateOnly Date,
    string Category,
    string Status,
    string PaymentStatus)
{
    /// <summary>True when this row represents real cash that has moved: posted (not scheduled/voided)
    /// and with a payment status that counts (recorded manually or confirmed externally).</summary>
    public bool IsCountedCash => Status == TransactionStatuses.Posted && PaymentStatuses.Counted.Contains(PaymentStatus);

    public long SignedCents => Type == TransactionTypes.Income ? AmountCents : -AmountCents;
}

public sealed record CategoryTotal(string Type, string Category, long TotalCents, int Count, decimal SharePercent);

public sealed record MonthlyTotal(string Month, string Label, long IncomeCents, long ExpensesCents)
{
    public long NetCents => IncomeCents - ExpensesCents;
}

public sealed record PeriodSummary(
    DateRange Period,
    long IncomeCents,
    long ExpensesCents,
    int TransactionCount,
    IReadOnlyList<CategoryTotal> CategoryBreakdown)
{
    /// <summary>Net recorded operating result (cash basis). Not audited profit and not a tax figure.</summary>
    public long NetResultCents => IncomeCents - ExpensesCents;
}

/// <summary>
/// Deterministic bookkeeping calculations on a cash basis.
/// <para>Accounting policy (documented in docs/PROJECT_SPECIFICATION.md):</para>
/// <list type="bullet">
/// <item>Only posted transactions with a counted payment status affect cash and results.</item>
/// <item>Credit sales (receivables) and supplier bills (payables) are not income/expenses until cash moves;
/// their payments are recorded as ledger transactions exactly once.</item>
/// <item>Scheduled and voided transactions never affect cash or results.</item>
/// </list>
/// </summary>
public static class FinancialCalculator
{
    /// <summary>
    /// Cash balance at the end of <paramref name="asOf"/>:
    /// opening balance + counted income − counted expenses dated from the opening-balance date (inclusive)
    /// up to and including <paramref name="asOf"/>. When no opening date is configured, all counted
    /// transactions up to <paramref name="asOf"/> are included and the opening balance is treated as at the start.
    /// </summary>
    public static long CashBalance(long openingBalanceCents, DateOnly? openingBalanceDate, IEnumerable<LedgerEntry> entries, DateOnly asOf)
    {
        var total = openingBalanceCents;
        foreach (var e in entries)
        {
            if (!e.IsCountedCash) continue;
            if (e.Date > asOf) continue;
            if (openingBalanceDate is { } od && e.Date < od) continue;
            total = checked(total + e.SignedCents);
        }
        return total;
    }

    /// <summary>Total of posted transactions that are still awaiting confirmation (not counted in cash).</summary>
    public static long AwaitingConfirmation(IEnumerable<LedgerEntry> entries, DateOnly asOf) =>
        entries.Where(e => e.Status == TransactionStatuses.Posted
                           && e.PaymentStatus == PaymentStatuses.AwaitingConfirmation
                           && e.Date <= asOf)
               .Sum(e => e.SignedCents);

    public static PeriodSummary Summarise(IEnumerable<LedgerEntry> entries, DateRange period)
    {
        long income = 0, expenses = 0;
        var count = 0;
        var byCategory = new Dictionary<(string Type, string Category), (long Total, int Count)>();

        foreach (var e in entries)
        {
            if (!e.IsCountedCash || !period.Contains(e.Date)) continue;
            count++;
            if (e.Type == TransactionTypes.Income) income = checked(income + e.AmountCents);
            else expenses = checked(expenses + e.AmountCents);

            var key = (e.Type, e.Category);
            byCategory.TryGetValue(key, out var agg);
            byCategory[key] = (checked(agg.Total + e.AmountCents), agg.Count + 1);
        }

        var breakdown = byCategory
            .Select(kv =>
            {
                var typeTotal = kv.Key.Type == TransactionTypes.Income ? income : expenses;
                var share = typeTotal == 0 ? 0m : Math.Round(kv.Value.Total * 100m / typeTotal, 1, MidpointRounding.AwayFromZero);
                return new CategoryTotal(kv.Key.Type, kv.Key.Category, kv.Value.Total, kv.Value.Count, share);
            })
            .OrderBy(c => c.Type == TransactionTypes.Income ? 0 : 1)
            .ThenByDescending(c => c.TotalCents)
            .ThenBy(c => c.Category, StringComparer.Ordinal)
            .ToList();

        return new PeriodSummary(period, income, expenses, count, breakdown);
    }

    /// <summary>Monthly income/expense totals for <paramref name="months"/> calendar months ending with the month of <paramref name="endDate"/>.</summary>
    public static IReadOnlyList<MonthlyTotal> Monthly(IEnumerable<LedgerEntry> entries, DateOnly endDate, int months)
    {
        if (months < 1) throw new ArgumentOutOfRangeException(nameof(months));
        var firstMonth = new DateOnly(endDate.Year, endDate.Month, 1).AddMonths(-(months - 1));
        var buckets = new SortedDictionary<string, (DateOnly Start, long Income, long Expenses)>(StringComparer.Ordinal);
        for (var m = firstMonth; m <= endDate; m = m.AddMonths(1))
            buckets[Periods.MonthKey(m)] = (m, 0, 0);

        foreach (var e in entries)
        {
            if (!e.IsCountedCash || e.Date < firstMonth || e.Date > endDate) continue;
            var key = Periods.MonthKey(e.Date);
            var b = buckets[key];
            buckets[key] = e.Type == TransactionTypes.Income
                ? (b.Start, checked(b.Income + e.AmountCents), b.Expenses)
                : (b.Start, b.Income, checked(b.Expenses + e.AmountCents));
        }

        return buckets.Select(kv => new MonthlyTotal(kv.Key, Periods.MonthLabel(kv.Value.Start), kv.Value.Income, kv.Value.Expenses)).ToList();
    }

    /// <summary>Monthly totals between two dates (inclusive), for custom report ranges.</summary>
    public static IReadOnlyList<MonthlyTotal> MonthlyBetween(IEnumerable<LedgerEntry> entries, DateOnly from, DateOnly to)
    {
        var months = (to.Year - from.Year) * 12 + to.Month - from.Month + 1;
        var list = Monthly(entries.Where(e => e.Date >= from), to, Math.Max(1, months));
        return list;
    }
}

/// <summary>Balance arithmetic for receivables (customer debts) and payables (supplier bills).</summary>
public static class BalanceMath
{
    /// <summary>Remaining = original − active payments − written off. Never negative.</summary>
    public static long Remaining(long originalCents, long paidCents, long writtenOffCents = 0)
    {
        if (originalCents <= 0) throw new ArgumentOutOfRangeException(nameof(originalCents));
        if (paidCents < 0 || writtenOffCents < 0) throw new ArgumentOutOfRangeException(nameof(paidCents));
        var remaining = originalCents - paidCents - writtenOffCents;
        return remaining < 0 ? 0 : remaining;
    }

    /// <summary>Validates a new payment against the remaining balance.</summary>
    public static PaymentCheck CheckPayment(long remainingCents, long paymentCents)
    {
        if (paymentCents <= 0) return PaymentCheck.NotPositive;
        if (remainingCents <= 0) return PaymentCheck.AlreadySettled;
        if (paymentCents > remainingCents) return PaymentCheck.ExceedsRemaining;
        return PaymentCheck.Ok;
    }

    public static string ReceivableStatusAfter(long remainingCents, string currentStatus)
    {
        if (currentStatus == ReceivableStatuses.WrittenOff) return currentStatus;
        return remainingCents == 0 ? ReceivableStatuses.Settled : ReceivableStatuses.Open;
    }

    public static string PayableStatusAfter(long remainingCents, string currentStatus)
    {
        if (currentStatus == PayableStatuses.Cancelled) return currentStatus;
        return remainingCents == 0 ? PayableStatuses.Paid : PayableStatuses.Open;
    }
}

public enum PaymentCheck
{
    Ok,
    NotPositive,
    AlreadySettled,
    ExceedsRemaining
}
