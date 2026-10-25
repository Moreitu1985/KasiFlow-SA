using Dapper;
using KasiFlow.Api.Data;
using KasiFlow.Api.Middleware;
using KasiFlow.Core.Access;
using KasiFlow.Core.Common;
using KasiFlow.Core.Validation;

namespace KasiFlow.Api.Services;

public sealed record MoneyFigureDto(string Key, string Label, long AmountCents, string Explanation);

public sealed record MethodTotalDto(string PaymentMethod, long AmountCents);

public sealed record MoneySummaryDto(string Period, DateOnly From, DateOnly To, long SalesRevenueCents, long ReceivedCents, long UnpaidFromSalesCents,
    long ExpensesCents, long RefundsCents, long DiscountsCents, long EstimatedContributionCents, long PendingConfirmationCents, long UnsettledProviderCents,
    long OutstandingReceivablesCents, long OverdueReceivablesCents, long BillsDueNext7DaysCents, long OverdueBillsCents, long ExpectedCollectionsNext7DaysCents,
    long? AvailableCashCents, string? AvailableCashNote, long? CashGapNext7DaysCents, int CompletedBookings, int UpcomingBookingsToday,
    IReadOnlyList<MethodTotalDto> ReceivedByMethod, IReadOnlyList<MoneyFigureDto> Figures, IReadOnlyList<string> Notes);

/// <summary>
/// "How much did we sell, receive and spend?" — kept as separate figures: sales revenue is not cash received, and an
/// estimated contribution is not net profit (no tax, depreciation or unrecorded costs).
/// </summary>
public sealed class MoneyService(IDbConnectionFactory db, IBusinessContext business, FinancialSnapshotService snapshots, IClock clock)
{
    private sealed class Row
    {
        public long CashSales { get; set; }
        public long PendingSales { get; set; }
        public long CreditSales { get; set; }
        public long CreditSalesOutstanding { get; set; }
        public long Received { get; set; }
        public long Expenses { get; set; }
        public long Refunds { get; set; }
        public long Discounts { get; set; }
        public long PendingAll { get; set; }
        public long ProviderPending { get; set; }
        public long Unsettled { get; set; }
        public int Completed { get; set; }
        public int TodayUpcoming { get; set; }
    }

    public async Task<MoneySummaryDto> SummaryAsync(string? period, DateOnly? date, CancellationToken ct)
    {
        var access = await business.RequireAsync(Permission.ViewBusinessInsights);
        var p = (period ?? "day").ToLowerInvariant();
        if (p is not ("day" or "week" or "month")) throw new RequestValidationException(new ValidationErrors().Add("period", "Choose day, week or month."));
        var today = clock.Today;
        var d = date ?? today;
        var (from, to) = p switch
        {
            "day" => (d, d),
            "week" => (d.AddDays(-(((int)d.DayOfWeek + 6) % 7)), d.AddDays(-(((int)d.DayOfWeek + 6) % 7)).AddDays(6)),
            _ => (new DateOnly(d.Year, d.Month, 1), new DateOnly(d.Year, d.Month, 1).AddMonths(1).AddDays(-1))
        };
        await using var conn = await db.OpenAsync(ct);
        var b = access.BusinessId;
        var r = await conn.QuerySingleAsync<Row>(
            """
            SELECT
              COALESCE(SUM(t.amount_cents) FILTER (WHERE t.type = 'income' AND t.source <> 'receivable_payment' AND t.payment_status IN ('recorded_manually','confirmed_external')), 0)::bigint AS cash_sales,
              COALESCE(SUM(t.amount_cents) FILTER (WHERE t.type = 'income' AND t.source <> 'receivable_payment' AND t.payment_status = 'awaiting_confirmation'), 0)::bigint AS pending_sales,
              (SELECT COALESCE(SUM(original_amount_cents), 0) FROM receivables WHERE business_id = @B AND issue_date BETWEEN @From AND @To)::bigint AS credit_sales,
              (SELECT COALESCE(SUM(GREATEST(0, rv.original_amount_cents - rv.written_off_cents - COALESCE((SELECT SUM(rp.amount_cents) FROM receivable_payments rp JOIN transactions tt ON tt.id = rp.transaction_id AND tt.status <> 'voided' WHERE rp.receivable_id = rv.id), 0))), 0)
                 FROM receivables rv WHERE rv.business_id = @B AND rv.issue_date BETWEEN @From AND @To AND rv.status = 'open')::bigint AS credit_sales_outstanding,
              COALESCE(SUM(t.amount_cents) FILTER (WHERE t.type = 'income' AND t.payment_status IN ('recorded_manually','confirmed_external')), 0)::bigint AS received,
              COALESCE(SUM(t.amount_cents) FILTER (WHERE t.type = 'expense' AND t.payment_status IN ('recorded_manually','confirmed_external')), 0)::bigint AS expenses,
              COALESCE(SUM(t.amount_cents) FILTER (WHERE t.type = 'expense' AND t.category = 'Refunds' AND t.payment_status IN ('recorded_manually','confirmed_external')), 0)::bigint AS refunds,
              (SELECT COALESCE(SUM(discount_cents), 0) FROM bookings WHERE business_id = @B AND status = 'completed' AND (starts_at AT TIME ZONE 'Africa/Johannesburg')::date BETWEEN @From AND @To)::bigint AS discounts,
              (SELECT COALESCE(SUM(amount_cents), 0) FROM transactions WHERE business_id = @B AND type = 'income' AND status = 'posted' AND payment_status = 'awaiting_confirmation')::bigint AS pending_all,
              (SELECT COALESCE(SUM(gross_cents), 0) FROM provider_payments WHERE business_id = @B AND status = 'pending' AND kind = 'payment')::bigint AS provider_pending,
              (SELECT COALESCE(SUM(gross_cents), 0) FROM provider_payments WHERE business_id = @B AND status = 'completed' AND kind = 'payment' AND settlement_id IS NULL)::bigint AS unsettled,
              (SELECT COUNT(*) FROM bookings WHERE business_id = @B AND status = 'completed' AND (starts_at AT TIME ZONE 'Africa/Johannesburg')::date BETWEEN @From AND @To)::int AS completed,
              (SELECT COUNT(*) FROM bookings WHERE business_id = @B AND status IN ('confirmed','requested') AND starts_at > now()
                  AND (starts_at AT TIME ZONE 'Africa/Johannesburg')::date = (now() AT TIME ZONE 'Africa/Johannesburg')::date)::int AS today_upcoming
            FROM transactions t
            WHERE t.business_id = @B AND t.status = 'posted' AND t.transaction_date BETWEEN @From AND @To
            """, new { B = b, From = from, To = to });
        var byMethod = (await conn.QueryAsync<(string M, long A)>(
            """
            SELECT payment_method, SUM(amount_cents)::bigint FROM transactions
            WHERE business_id = @B AND status = 'posted' AND type = 'income' AND payment_status IN ('recorded_manually','confirmed_external') AND transaction_date BETWEEN @From AND @To
            GROUP BY payment_method ORDER BY 2 DESC
            """, new { B = b, From = from, To = to })).Select(x => new MethodTotalDto(x.M, x.A)).ToList();

        var snap = await snapshots.LoadAsync(conn, b);
        var outstanding = snap.OpenReceivables.Sum(x => x.RemainingCents);
        var overdueRec = snap.OpenReceivables.Where(x => x.DueDate is { } dd && dd < today).Sum(x => x.RemainingCents);
        var billsSoon = snap.OpenPayables.Where(x => x.DueDate >= today && x.DueDate <= today.AddDays(7)).Sum(x => x.RemainingCents);
        var billsOverdue = snap.OpenPayables.Where(x => x.DueDate < today).Sum(x => x.RemainingCents);
        var expected7 = snap.OpenReceivables.Where(x => x.DueDate is { } dd && dd >= today && dd <= today.AddDays(7)).Sum(x => x.RemainingCents);
        long? available = snap.OpeningBalanceConfigured ? snap.CashBalanceCents : null;
        var availableNote = snap.OpeningBalanceConfigured
            ? "Recorded cash: opening balance plus recorded money in and out. It is only as complete as your records."
            : "Not shown: set your opening cash balance in Settings so KasiFlow can work out available cash.";
        long? gap = available is { } a ? a + expected7 - billsSoon - billsOverdue : null;

        var revenue = r.CashSales + r.PendingSales + r.CreditSales;
        var unpaid = r.PendingSales + r.CreditSalesOutstanding;
        var contribution = revenue - r.Expenses;
        var notes = new List<string>
        {
            "Sales revenue is the value of what you sold. Money received is what actually came in (including old debts paid). They are different numbers.",
            "Estimated contribution = sales revenue − recorded expenses. It is not net profit: tax, depreciation and costs you have not recorded are not included.",
        };
        if (r.PendingSales > 0) notes.Add($"{Money.FormatZar(r.PendingSales)} of sales are waiting for payment confirmation (proof of payment is not proof that money cleared).");
        if (gap is < 0) notes.Add($"Bills due in the next 7 days are more than recorded cash plus expected collections by {Money.FormatZar(-gap.Value)} — if those collections arrive as expected and nothing else changes.");

        var figures = new List<MoneyFigureDto>
        {
            new("sales", "Sales revenue", revenue, "Cash and card sales, sales awaiting confirmation, and sales on credit (customer debts) in this period."),
            new("received", "Money received", r.Received, "Confirmed money in during this period, including debt repayments."),
            new("unpaid", "Unpaid from these sales", unpaid, "Sales not yet paid: on credit, or awaiting payment confirmation."),
            new("expenses", "Expenses", r.Expenses, "Recorded money out in this period (includes refunds)."),
            new("contribution", "Estimated contribution", contribution, "Sales revenue minus recorded expenses. Not net profit."),
            new("pending", "Pending / unsettled", r.PendingAll + r.ProviderPending + r.Unsettled, "Awaiting confirmation, provider payments still pending, and provider payments not yet paid out to the bank."),
            new("receivables", "Owed to you", outstanding, "All customer debts still outstanding (principal)."),
            new("bills", "Bills due in 7 days", billsSoon + billsOverdue, "Supplier bills due in the next 7 days, plus any overdue bills."),
        };
        return new MoneySummaryDto(p, from, to, revenue, r.Received, unpaid, r.Expenses, r.Refunds, r.Discounts, contribution, r.PendingAll + r.ProviderPending,
            r.Unsettled, outstanding, overdueRec, billsSoon, billsOverdue, expected7, available, availableNote, gap, r.Completed, r.TodayUpcoming, byMethod,
            figures, notes);
    }
}
