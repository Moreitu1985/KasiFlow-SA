using System.Data;
using KasiFlow.Api.Data;
using KasiFlow.Api.Models;
using KasiFlow.Api.Repositories;
using KasiFlow.Core.Common;
using KasiFlow.Core.Finance;
using KasiFlow.Core.Forecasting;
using KasiFlow.Core.Growth;

namespace KasiFlow.Api.Services;

/// <summary>A consistent, read-only view of a business's financial records at one point in time.</summary>
public sealed record FinancialSnapshot(
    DateOnly Today,
    SettingsRow Settings,
    IReadOnlyList<LedgerEntry> Ledger,
    long CashBalanceCents,
    long AwaitingConfirmationCents,
    IReadOnlyList<OpenReceivable> OpenReceivables,
    IReadOnlyList<OpenPayable> OpenPayables,
    IReadOnlyList<ScheduledItem> Scheduled,
    IReadOnlyList<UnconfirmedItem> Unconfirmed,
    IReadOnlyList<PendingInflow>? PendingInflows = null)
{
    /// <summary>Counted transactions so far; fewer than the forecaster's threshold makes the forecast preliminary.</summary>
    public int CountedTransactionCount => Ledger.Count(e => e.IsCountedCash && e.Date <= Today);

    /// <summary>Days of history covered by counted transactions.</summary>
    public int HistoryDays
    {
        get
        {
            var counted = Ledger.Where(e => e.IsCountedCash && e.Date <= Today).ToList();
            return counted.Count == 0 ? 0 : Today.DayNumber - counted.Min(e => e.Date).DayNumber + 1;
        }
    }

    public bool OpeningBalanceConfigured => Settings.OpeningBalanceDate is not null;
}

/// <summary>Loads the records needed by the dashboard, Growth Engine and reports, and runs the
/// deterministic calculations from KasiFlow.Core on them.</summary>
public sealed class FinancialSnapshotService(IClock clock)
{
    public async Task<FinancialSnapshot> LoadAsync(IDbConnection conn, Guid businessId)
    {
        var today = clock.Today;
        var settings = await BusinessRepository.GetSettingsAsync(conn, null, businessId);
        var ledger = await LedgerRepository.LedgerEntriesAsync(conn, businessId);
        var receivables = await ReceivableRepository.OpenAsync(conn, businessId);
        var payables = await PayableRepository.OpenAsync(conn, businessId);
        var scheduled = await LedgerRepository.ScheduledAsync(conn, businessId);
        var unconfirmed = await LedgerRepository.UnconfirmedAsync(conn, businessId);
        // Provider payments that are still pending: shown only in the optimistic scenario, never as income.
        var pending = (await Dapper.SqlMapper.QueryAsync<PendingRow>(conn,
            "SELECT id, provider_key, gross_cents, occurred_at FROM provider_payments WHERE business_id = @BusinessId AND status = 'pending' AND kind = 'payment' AND occurred_at > now() - interval '7 days'",
            new { BusinessId = businessId }))
            .Select(p => new PendingInflow(p.Id, $"Pending {p.ProviderKey} payment", p.GrossCents, DateOnly.FromDateTime(p.OccurredAt.AddHours(2))))
            .ToList();

        var cash = FinancialCalculator.CashBalance(settings.OpeningCashBalanceCents, settings.OpeningBalanceDate, ledger, today);
        var awaiting = FinancialCalculator.AwaitingConfirmation(ledger, today);
        return new FinancialSnapshot(today, settings, ledger, cash, awaiting, receivables, payables, scheduled, unconfirmed, pending);
    }

    public static ForecastResult Forecast(FinancialSnapshot s, int? horizonDays = null) =>
        CashFlowForecaster.Build(new ForecastInput(
            s.Today,
            horizonDays ?? s.Settings.ForecastDays,
            s.CashBalanceCents,
            s.OpeningBalanceConfigured,
            s.Settings.CashBufferCents,
            s.Scheduled,
            s.OpenReceivables,
            s.OpenPayables,
            s.Unconfirmed.Where(u => u.Date <= s.Today).ToList(),
            s.PendingInflows,
            s.CountedTransactionCount,
            s.HistoryDays));

    private sealed class PendingRow
    {
        public Guid Id { get; set; }
        public string ProviderKey { get; set; } = "";
        public long GrossCents { get; set; }
        public DateTime OccurredAt { get; set; }
    }

    public static GrowthContext GrowthContext(FinancialSnapshot s, ForecastResult forecast, AnomalySignals? signals = null)
    {
        var historyStart = s.Today.AddDays(-(ExpenseSpikeRule.WindowDays * (ExpenseSpikeRule.BaselineWindows + 1) - 1));
        var counted = s.Ledger.Where(e => e.IsCountedCash && e.Date <= s.Today).ToList();
        var expenses = counted
            .Where(e => e.Type == Core.Domain.TransactionTypes.Expense && e.Date >= historyStart)
            .Select(e => new DailyExpense(e.Date, e.Category, e.AmountCents))
            .ToList();
        DateOnly? last = counted.Count > 0 ? counted.Max(e => e.Date) : null;
        return new GrowthContext(s.Today, forecast, s.CashBalanceCents, s.Settings.CashBufferCents, s.OpeningBalanceConfigured,
            s.OpenReceivables, s.OpenPayables, expenses, last, counted.Count, s.Unconfirmed, signals);
    }
}
