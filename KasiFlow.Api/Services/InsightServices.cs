using System.Globalization;
using KasiFlow.Api.Data;
using KasiFlow.Core.Access;
using KasiFlow.Api.DTOs;
using KasiFlow.Api.Middleware;
using KasiFlow.Api.Repositories;
using KasiFlow.Core.Common;
using KasiFlow.Core.Finance;
using KasiFlow.Core.Readiness;
using KasiFlow.Core.Validation;

namespace KasiFlow.Api.Services;

public static class PeriodParser
{
    public static DateRange Parse(string? period, DateOnly? from, DateOnly? to, DateOnly today)
    {
        // A bare from/to without a period means a custom range.
        if (period is null && (from is not null || to is not null)) period = Periods.Custom;
        if (period is not null && !Periods.All.Contains(period))
            throw new RequestValidationException(new ValidationErrors().Add("period", "Unknown period."));
        try
        {
            return Periods.Resolve(period, today, from, to);
        }
        catch (ArgumentException ex)
        {
            throw new RequestValidationException(new ValidationErrors().Add("period", ex.Message));
        }
    }
}

public sealed class DashboardService(IDbConnectionFactory db, IBusinessContext business, FinancialSnapshotService snapshots,
    GrowthService growth, ReadinessService readiness, IClock clock)
{
    public async Task<DashboardSummaryDto> SummaryAsync(string? period, DateOnly? from, DateOnly? to, CancellationToken ct)
    {
        var range = PeriodParser.Parse(period, from, to, clock.Today);
        var access = await business.RequireAsync(Permission.ViewBusinessInsights);
        var businessId = access.BusinessId;

        // Keep recommendations current before counting them.
        await growth.RefreshAsync(ct);

        await using var conn = await db.OpenAsync(ct);
        var snap = await snapshots.LoadAsync(conn, businessId);
        var forecast = FinancialSnapshotService.Forecast(snap);
        var summary = FinancialCalculator.Summarise(snap.Ledger, range);
        var monthly = FinancialCalculator.Monthly(snap.Ledger, snap.Today, 6);
        var receivables = ReceivableService.Summarise(snap.OpenReceivables, snap.Today);
        var today = snap.Today;
        var (critical, warning, info) = await GrowthRepository.OpenCountsAsync(conn, businessId);
        var priority = (await GrowthRepository.ListAsync(conn, businessId, "open", null)).Take(3).Select(r => r.ToDto()).ToList();

        var obligations = snap.OpenPayables
            .Where(p => p.DueDate <= today.AddDays(29))
            .OrderBy(p => p.DueDate).Take(5)
            .Select(p => new ObligationDto(p.Id, p.SupplierName, p.Description, p.DueDate, p.RemainingCents, p.DueDate < today))
            .ToList();

        await conn.CloseAsync();
        var funding = await readiness.GetFundingAsync(ct);
        var registration = await readiness.GetRegistrationAsync(ct);

        return new DashboardSummaryDto(
            new PeriodDto(range.From, range.To, range.Label),
            snap.Ledger.Count > 0,
            snap.OpeningBalanceConfigured,
            snap.CashBalanceCents,
            snap.AwaitingConfirmationCents,
            summary.IncomeCents,
            summary.ExpensesCents,
            summary.NetResultCents,
            receivables.TotalOutstandingCents,
            receivables.OverdueCents,
            snap.OpenPayables.Where(p => p.DueDate <= today.AddDays(29)).Sum(p => p.RemainingCents),
            snap.OpenPayables.Where(p => p.DueDate < today).Sum(p => p.RemainingCents),
            new DashboardForecastDto(forecast.HorizonDays, forecast.LowestExpected.BalanceCents, forecast.LowestExpected.Date,
                forecast.ClosingExpectedCents, forecast.FirstShortageDate, forecast.FirstBelowBufferDate,
                forecast.IsPreliminary, forecast.PreliminaryReason, forecast.LowestConservative.BalanceCents, forecast.LowestOptimistic.BalanceCents),
            forecast.Days.Select(d => new ForecastPointDto(d.Date, d.ExpectedClosingCents, d.ConservativeClosingCents, d.OptimisticClosingCents)).ToList(),
            new RecommendationCountsDto(critical + warning + info, critical, warning, info),
            funding.Percent,
            registration.ProgressPercent,
            monthly.Select(m => new MonthlyIncomeExpenseDto(m.Month, m.Label, m.IncomeCents, m.ExpensesCents)).ToList(),
            obligations,
            priority);
    }
}

public sealed class ReportService(IDbConnectionFactory db, IBusinessContext business, IBusinessRepository businesses, ICurrentUser user,
    FinancialSnapshotService snapshots, ReadinessService readiness, IClock clock)
{
    public const string SummaryDisclaimer =
        "Prepared from records entered by the business owner in KasiFlow SA. Figures are cash-basis records (money actually received or paid) " +
        "and are NOT audited financial statements, a tax return, a credit score or a credit assessment. Forecast figures are estimates based " +
        "on recorded due dates and may not happen.";

    private DateRange DefaultRange(DateOnly? from, DateOnly? to) =>
        from is null && to is null
            ? new DateRange(new DateOnly(clock.Today.Year, clock.Today.Month, 1).AddMonths(-5), clock.Today, "Last 6 months")
            : PeriodParser.Parse(Periods.Custom, from, to, clock.Today);

    public async Task<FinancialSummaryDto> FinancialSummaryAsync(DateOnly? from, DateOnly? to, CancellationToken ct)
    {
        var range = DefaultRange(from, to);
        var access = await business.RequireAsync(Permission.ViewBusinessInsights);
        var businessId = access.BusinessId;
        await using var conn = await db.OpenAsync(ct);
        var ledger = await LedgerRepository.LedgerEntriesAsync(conn, businessId, range.From, range.To);
        return BuildFinancialSummary(ledger, range);
    }

    public static FinancialSummaryDto BuildFinancialSummary(IReadOnlyList<LedgerEntry> ledger, DateRange range)
    {
        var s = FinancialCalculator.Summarise(ledger, range);
        var monthly = FinancialCalculator.MonthlyBetween(ledger, range.From, range.To);
        return new FinancialSummaryDto(new PeriodDto(range.From, range.To, range.Label), s.IncomeCents, s.ExpensesCents, s.NetResultCents,
            s.TransactionCount, s.CategoryBreakdown.Select(c => c.ToDto()).ToList(), monthly.Select(m => m.ToDto()).ToList());
    }

    public async Task<BusinessSummaryDto> BusinessSummaryAsync(DateOnly? from, DateOnly? to, CancellationToken ct)
    {
        var range = DefaultRange(from, to);
        var access = await business.RequireAsync(Permission.ViewBusinessInsights);
        var businessId = access.BusinessId;
        var b = await businesses.GetForUserAsync(businessId, user.UserId, ct) ?? throw new NotFoundException("Business not found.");
        FinancialSnapshot snap;
        await using (var conn = await db.OpenAsync(ct))
            snap = await snapshots.LoadAsync(conn, businessId);
        var fin = BuildFinancialSummary(snap.Ledger, range);
        var forecast = FinancialSnapshotService.Forecast(snap);
        var funding = await readiness.GetFundingAsync(ct);

        return new BusinessSummaryDto(DateTime.UtcNow,
            new SummaryBusinessDto(b.Name, b.BusinessType, b.Province, b.Town, b.RegistrationStatus),
            fin.Period, fin.IncomeCents, fin.ExpensesCents, fin.NetResultCents, fin.CategoryBreakdown, fin.Monthly,
            snap.CashBalanceCents,
            snap.OpenReceivables.Sum(r => r.RemainingCents),
            snap.OpenPayables.Sum(p => p.RemainingCents),
            new SummaryForecastDto(forecast.HorizonDays, forecast.LowestExpected.BalanceCents, forecast.LowestExpected.Date, forecast.ClosingExpectedCents),
            funding.Percent, funding.Profile.FundingPurpose, funding.Profile.AmountRequestedCents, SummaryDisclaimer);
    }

    public static readonly IReadOnlySet<string> ExportKinds = new HashSet<string>
        { "transactions", "category-breakdown", "monthly", "receivables", "payables", "cash-flow", "readiness", "business-summary" };

    /// <summary>Builds a CSV export for the caller's active business only.</summary>
    public async Task<(string FileName, string Content)> ExportAsync(string kind, DateOnly? from, DateOnly? to, CancellationToken ct)
    {
        if (!ExportKinds.Contains(kind)) throw new NotFoundException("Unknown export.");
        var range = DefaultRange(from, to);
        var access = await business.RequireAsync(Permission.ExportData);
        var businessId = access.BusinessId;
        var csv = new CsvBuilder();
        var stamp = clock.Today.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        string R(long cents) => Money.ToRandString(cents);
        string D(DateOnly? d) => d?.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) ?? "";

        switch (kind)
        {
            case "transactions":
            {
                await using var conn = await db.OpenAsync(ct);
                csv.Row("KasiFlow SA — Posted transactions (Actual; scheduled and voided excluded)", $"{D(range.From)} to {D(range.To)}");
                csv.Row("Date", "Type", "Description", "Category", "Amount (ZAR)", "Payment method", "Payment status", "Status", "Reference");
                var page = 1;
                while (true)
                {
                    var (rows, _) = await LedgerRepository.ListAsync(conn, businessId,
                        new TransactionQuery(null, null, "posted", range.From, range.To, null, page, 100));
                    foreach (var t in rows)
                        csv.Row(D(t.TransactionDate), t.Type, t.Description, t.Category,
                            R(t.Type == "income" ? t.AmountCents : -t.AmountCents), t.PaymentMethod, t.PaymentStatus, t.Status, t.Reference);
                    if (rows.Count < 100) break;
                    if (page >= 200) { csv.Row("Export truncated at 20,000 rows — narrow the date range."); break; }
                    page++;
                }
                break;
            }
            case "category-breakdown":
            case "monthly":
            {
                var s = await FinancialSummaryAsync(range.From, range.To, ct);
                csv.Row($"KasiFlow SA — {(kind == "monthly" ? "Monthly performance" : "Category breakdown")} (Actual, cash basis)", $"{D(range.From)} to {D(range.To)}");
                if (kind == "monthly")
                {
                    csv.Row("Month", "Income (ZAR)", "Expenses (ZAR)", "Net recorded result (ZAR)");
                    foreach (var m in s.Monthly) csv.Row(m.Label, R(m.IncomeCents), R(m.ExpensesCents), R(m.NetCents));
                }
                else
                {
                    csv.Row("Type", "Category", "Total (ZAR)", "Transactions", "Share of type (%)");
                    foreach (var c in s.CategoryBreakdown)
                        csv.Row(c.Type, c.Category, R(c.TotalCents), c.Count.ToString(CultureInfo.InvariantCulture), c.SharePercent.ToString("0.0", CultureInfo.InvariantCulture));
                }
                csv.Blank().Row("Total income", R(s.IncomeCents)).Row("Total expenses", R(s.ExpensesCents)).Row("Net recorded result", R(s.NetResultCents));
                break;
            }
            case "receivables":
            {
                await using var conn = await db.OpenAsync(ct);
                var (rows, _) = await ReceivableRepository.ListAsync(conn, businessId, clock.Today, "all", "all", null, 1, 5000);
                csv.Row("KasiFlow SA — Customer debts", $"As at {stamp}");
                csv.Row("Customer", "Description", "Issued", "Due", "Original (ZAR)", "Paid (ZAR)", "Written off (ZAR)", "Remaining (ZAR)", "Status", "Overdue");
                foreach (var r in rows.Select(x => x.ToDto(clock.Today)))
                    csv.Row(r.CustomerName, r.Description, D(r.IssueDate), D(r.DueDate), R(r.OriginalAmountCents), R(r.PaidCents),
                        R(r.WrittenOffCents), R(r.RemainingCents), r.Status, r.IsOverdue ? "Yes" : "No");
                break;
            }
            case "payables":
            {
                await using var conn = await db.OpenAsync(ct);
                var (rows, _) = await PayableRepository.ListAsync(conn, businessId, clock.Today, "all", "all", null, 1, 5000);
                csv.Row("KasiFlow SA — Supplier bills", $"As at {stamp}");
                csv.Row("Supplier", "Description", "Category", "Bill date", "Due", "Original (ZAR)", "Paid (ZAR)", "Remaining (ZAR)", "Status", "Overdue");
                foreach (var p in rows.Select(x => x.ToDto(clock.Today)))
                    csv.Row(p.SupplierName, p.Description, p.Category, D(p.BillDate), D(p.DueDate), R(p.OriginalAmountCents), R(p.PaidCents),
                        R(p.RemainingCents), p.Status, p.IsOverdue ? "Yes" : "No");
                break;
            }
            case "cash-flow":
            {
                FinancialSnapshot snap;
                await using (var conn = await db.OpenAsync(ct)) snap = await snapshots.LoadAsync(conn, businessId);
                var f = FinancialSnapshotService.Forecast(snap);
                csv.Row("KasiFlow SA — Cash-flow FORECAST (estimate, not actual)", $"Generated {stamp}");
                csv.Row("Date", "Opening (ZAR)", "Scheduled in (ZAR)", "Expected from customers — not confirmed (ZAR)", "Out (ZAR)", "Expected closing (ZAR)", "Conservative closing (ZAR)", "Below buffer", "Below zero");
                foreach (var d in f.Days)
                    csv.Row(D(d.Date), R(d.OpeningBalanceCents), R(d.ScheduledInflowsCents), R(d.ExpectedInflowsCents), R(d.OutflowsCents),
                        R(d.ExpectedClosingCents), R(d.ConservativeClosingCents), d.BelowBuffer ? "Yes" : "No", d.BelowZero ? "Yes" : "No");
                csv.Blank().Row("Assumptions");
                foreach (var a in f.Assumptions) csv.Row(a);
                break;
            }
            case "readiness":
            {
                var funding = await readiness.GetFundingAsync(ct);
                var reg = await readiness.GetRegistrationAsync(ct);
                csv.Row("KasiFlow SA — Business readiness", $"As at {stamp}");
                csv.Row("Funding readiness checklist", $"{funding.Percent}% ({funding.CompletedCount}/{funding.TotalCount})");
                csv.Row("Item", "Mode", "Completed", "Notes");
                foreach (var i in funding.Items) csv.Row(i.Title, i.Mode, i.Completed ? "Yes" : "No", i.Notes);
                csv.Blank().Row("Registration guidance", $"{reg.ProgressPercent}% ({reg.CompletedCount}/{reg.TotalCount})");
                csv.Row("Step", "Completed", "Notes");
                foreach (var s in reg.Steps) csv.Row(s.Title, s.Completed ? "Yes" : "No", s.Notes);
                csv.Blank().Row(funding.Disclaimer);
                break;
            }
            case "business-summary":
            {
                var s = await BusinessSummaryAsync(range.From, range.To, ct);
                csv.Row("KasiFlow SA — Business summary", $"Generated {stamp}");
                csv.Row("Business", s.Business.Name).Row("Type", s.Business.BusinessType).Row("Province", s.Business.Province)
                   .Row("Registration status", s.Business.RegistrationStatus);
                csv.Blank().Row("ACTUAL (cash basis)", $"{D(s.Period.From)} to {D(s.Period.To)}");
                csv.Row("Income (ZAR)", R(s.IncomeCents)).Row("Expenses (ZAR)", R(s.ExpensesCents)).Row("Net recorded result (ZAR)", R(s.NetResultCents));
                csv.Row("Current recorded cash balance (ZAR)", R(s.CashBalanceCents));
                csv.Row("Outstanding customer debts (ZAR)", R(s.OutstandingReceivablesCents)).Row("Outstanding supplier bills (ZAR)", R(s.OutstandingPayablesCents));
                csv.Blank().Row("FORECAST (estimate)", $"Next {s.Forecast.HorizonDays} days");
                csv.Row("Lowest projected balance (ZAR)", R(s.Forecast.LowestExpectedBalanceCents)).Row("Lowest balance date", D(s.Forecast.LowestExpectedBalanceDate));
                csv.Row("Projected closing balance (ZAR)", R(s.Forecast.ClosingExpectedBalanceCents));
                csv.Blank().Row("Funding readiness (%)", s.ReadinessPercent.ToString(CultureInfo.InvariantCulture));
                csv.Row("Funding purpose", s.FundingPurpose).Row("Amount requested (ZAR)", s.AmountRequestedCents is { } a ? R(a) : "");
                csv.Blank().Row(s.Disclaimer);
                break;
            }
        }
        return ($"kasiflow-{kind}-{stamp}.csv", csv.ToString());
    }
}
