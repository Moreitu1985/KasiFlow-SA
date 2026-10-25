using System.Data;
using Dapper;
using KasiFlow.Api.Data;
using KasiFlow.Api.DTOs;
using KasiFlow.Api.Repositories;
using KasiFlow.Core.Access;
using KasiFlow.Core.Common;
using KasiFlow.Core.Domain;

namespace KasiFlow.Api.Services.Automation;

/// <summary>Builds the Daily Business Briefing from stored records only. Deterministic: the same records give the same briefing.</summary>
public sealed class BriefingBuilder(IDbConnectionFactory db, FinancialSnapshotService snapshots, IClock clock)
{
    private sealed class Counts
    {
        public string OwnerName { get; set; } = "";
        public long YIncome { get; set; }
        public long YExpenses { get; set; }
        public int YSales { get; set; }
        public int NeedsReview { get; set; }
        public int PendingPayments { get; set; }
        public long PendingCents { get; set; }
        public int LowStock { get; set; }
        public int ShiftsToReview { get; set; }
        public int PendingAdjustments { get; set; }
        public int IntegrationProblems { get; set; }
        public int DeadJobs { get; set; }
        public bool HasSandboxData { get; set; }
    }

    public async Task<BriefingDto> BuildAsync(Guid businessId, AccessContext? viewer, CancellationToken ct)
    {
        await using var conn = await db.OpenAsync(ct);
        return await BuildAsync(conn, businessId, viewer);
    }

    public async Task<BriefingDto> BuildAsync(IDbConnection conn, Guid businessId, AccessContext? viewer)
    {
        var today = clock.Today;
        var yesterday = today.AddDays(-1);
        var snap = await snapshots.LoadAsync(conn, businessId);
        var forecast = FinancialSnapshotService.Forecast(snap);
        var c = await conn.QuerySingleAsync<Counts>(
            """
            SELECT
              (SELECT owner_name FROM businesses WHERE id = @B) AS owner_name,
              (SELECT COALESCE(SUM(amount_cents) FILTER (WHERE type = 'income'), 0) FROM transactions WHERE business_id = @B AND transaction_date = @Y AND status = 'posted' AND payment_status IN ('recorded_manually','confirmed_external'))::bigint AS y_income,
              (SELECT COALESCE(SUM(amount_cents) FILTER (WHERE type = 'expense'), 0) FROM transactions WHERE business_id = @B AND transaction_date = @Y AND status = 'posted' AND payment_status IN ('recorded_manually','confirmed_external'))::bigint AS y_expenses,
              (SELECT COUNT(*) FROM transactions WHERE business_id = @B AND transaction_date = @Y AND status = 'posted' AND type = 'income' AND payment_status IN ('recorded_manually','confirmed_external'))::int AS y_sales,
              (SELECT COUNT(*) FROM provider_payments WHERE business_id = @B AND reconciliation_status = 'needs_review')::int AS needs_review,
              (SELECT COUNT(*) FROM provider_payments WHERE business_id = @B AND status = 'pending' AND kind = 'payment')::int AS pending_payments,
              (SELECT COALESCE(SUM(gross_cents), 0) FROM provider_payments WHERE business_id = @B AND status = 'pending' AND kind = 'payment')::bigint AS pending_cents,
              (SELECT COUNT(*) FROM inventory_levels l JOIN products p ON p.id = l.product_id WHERE l.business_id = @B AND p.is_active AND p.kind = 'product' AND p.min_stock_qty > 0 AND l.quantity <= p.min_stock_qty)::int AS low_stock,
              (SELECT COUNT(*) FROM shifts WHERE business_id = @B AND status = 'closed' AND needs_review)::int AS shifts_to_review,
              (SELECT COUNT(*) FROM stock_movements WHERE business_id = @B AND status = 'pending_approval')::int AS pending_adjustments,
              (SELECT COUNT(*) FROM integration_connections WHERE business_id = @B AND status IN ('error','awaiting_credentials'))::int AS integration_problems,
              (SELECT COUNT(*) FROM background_jobs WHERE business_id = @B AND status = 'dead' AND job_type IN ('process_provider_event','sync_connection'))::int AS dead_jobs,
              EXISTS (SELECT 1 FROM transactions WHERE business_id = @B AND origin = 'demo_simulation' AND status <> 'voided') AS has_sandbox_data
            """, new { B = businessId, Y = yesterday });

        var items = new List<BriefingItemDto>();
        bool Sees(Permission p) => viewer is null || viewer.Can(p);

        if (Sees(Permission.ViewBusinessInsights))
        {
            var recs = (await GrowthRepository.ListAsync(conn, businessId, "open", null))
                .Where(r => r.Severity is Severities.Critical or Severities.Warning)
                .OrderBy(r => r.Severity == Severities.Critical ? 0 : 1).Take(3);
            items.AddRange(recs.Select(r => new BriefingItemDto("recommendation", r.Severity, r.Title, Shorten(r.Explanation), "/growth")));
            foreach (var b in snap.OpenPayables.Where(p => p.DueDate <= today.AddDays(3)).OrderBy(p => p.DueDate).Take(3))
                items.Add(new BriefingItemDto("bill", b.DueDate < today ? Severities.Warning : Severities.Informational,
                    $"{(b.DueDate < today ? "Overdue" : b.DueDate == today ? "Due today" : "Due " + b.DueDate.ToString("ddd d MMM"))}: {b.SupplierName}",
                    $"{Money.FormatZar(b.RemainingCents)} for {b.Description}.", "/suppliers"));
            var overdue = snap.OpenReceivables.Where(r => r.DueDate is { } d && d < today).ToList();
            if (overdue.Count > 0)
                items.Add(new BriefingItemDto("debts", Severities.Informational, $"{overdue.Count} customer debt(s) overdue",
                    $"{Money.FormatZar(overdue.Sum(r => r.RemainingCents))} is owed to you and past due.", "/customers"));
        }
        if (c.NeedsReview > 0 && Sees(Permission.ManageReconciliation))
            items.Add(new BriefingItemDto("reconciliation", Severities.Warning, $"{c.NeedsReview} payment(s) need your review",
                "They may match sales you recorded. Confirm them so nothing is counted twice.", "/reconciliation"));
        if (c.PendingPayments > 0 && Sees(Permission.ViewIntegrations))
            items.Add(new BriefingItemDto("pending", Severities.Informational, $"{c.PendingPayments} payment(s) still pending",
                $"{Money.FormatZar(c.PendingCents)} is not counted as income until the provider confirms it.", "/reconciliation"));
        if (c.ShiftsToReview > 0 && Sees(Permission.ReviewShifts))
            items.Add(new BriefingItemDto("cashup", Severities.Warning, $"{c.ShiftsToReview} cash-up(s) to review",
                "Counted cash differed from expected cash by more than your threshold. A difference is not proof of wrongdoing; check counting and recording first.", "/shifts"));
        if (c.LowStock > 0 && Sees(Permission.ViewInventory))
            items.Add(new BriefingItemDto("stock", Severities.Warning, $"{c.LowStock} product(s) at or below minimum stock",
                "See reorder suggestions in Inventory.", "/inventory"));
        if (c.PendingAdjustments > 0 && Sees(Permission.ApproveStockAdjustment))
            items.Add(new BriefingItemDto("stock_approval", Severities.Informational, $"{c.PendingAdjustments} stock adjustment(s) await approval", "Approve or reject them in Inventory.", "/inventory"));
        if ((c.IntegrationProblems > 0 || c.DeadJobs > 0) && Sees(Permission.ManageIntegrations))
            items.Add(new BriefingItemDto("integration", Severities.Warning, "An integration needs attention",
                c.DeadJobs > 0 ? $"{c.DeadJobs} event(s) could not be processed after several attempts. Retry them in the Integrations Centre." : "A connection is not working. Open the Integrations Centre for the fix.",
                "/integrations"));

        var showMoney = Sees(Permission.ViewBusinessInsights);
        var notes = new List<string>();
        if (showMoney && forecast.IsPreliminary && forecast.PreliminaryReason is not null) notes.Add(forecast.PreliminaryReason);
        if (showMoney && !snap.OpeningBalanceConfigured) notes.Add("Your opening cash balance is not set, so the cash balance may be incomplete.");
        if (c.HasSandboxData) notes.Add("This business contains SANDBOX demo transactions. They are simulated and not real money.");

        var hour = clock.UtcNow.ToOffset(TimeSpan.FromHours(2)).Hour;
        var first = c.OwnerName.Split(' ', StringSplitOptions.RemoveEmptyEntries).FirstOrDefault() ?? "";
        var greeting = (hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening") + (first.Length > 0 ? ", " + first : "");
        // People without financial access get no balances, forecast or business-wide figures.
        DashboardForecastDto? dash = !showMoney ? null : new DashboardForecastDto(forecast.HorizonDays, forecast.LowestExpected.BalanceCents, forecast.LowestExpected.Date,
            forecast.ClosingExpectedCents, forecast.FirstShortageDate, forecast.FirstBelowBufferDate, forecast.IsPreliminary,
            forecast.PreliminaryReason, forecast.LowestConservative.BalanceCents, forecast.LowestOptimistic.BalanceCents);
        return new BriefingDto(today, greeting, showMoney ? snap.CashBalanceCents : 0, showMoney ? c.YIncome : 0, showMoney ? c.YExpenses : 0,
            showMoney ? c.YSales : 0, dash, items, notes);
    }

    private static string Shorten(string s) => s.Length <= 220 ? s : s[..217] + "...";

    /// <summary>Daily in-app briefing notification. Idempotent per business per day.</summary>
    public async Task NotifyAsync(Guid businessId, CancellationToken ct)
    {
        await using var conn = await db.OpenAsync(ct);
        var b = await BuildAsync(conn, businessId, null);
        var urgent = b.Items.Count(i => i.Severity is Severities.Critical or Severities.Warning);
        var body = $"Cash on hand {Money.FormatZar(b.CashBalanceCents)}. Yesterday: {b.YesterdaySalesCount} sale(s), {Money.FormatZar(b.YesterdayIncomeCents)} in, {Money.FormatZar(b.YesterdayExpensesCents)} out. " +
                   (urgent > 0 ? $"{urgent} item(s) need attention." : "Nothing urgent.");
        await NotificationRepository.NotifyAsync(conn, null, businessId, Permission.ViewBusinessInsights, "briefing", urgent > 0 ? Severities.Warning : Severities.Informational,
            "Your daily briefing", body, "/briefing", $"briefing:{b.Date:yyyy-MM-dd}");
    }
}
