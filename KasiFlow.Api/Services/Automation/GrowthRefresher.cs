using System.Data;
using Dapper;
using KasiFlow.Api.Data;
using KasiFlow.Api.DTOs;
using KasiFlow.Api.Repositories;
using KasiFlow.Core.Access;
using KasiFlow.Core.Common;
using KasiFlow.Core.Domain;
using KasiFlow.Core.Growth;

namespace KasiFlow.Api.Services.Automation;

/// <summary>Re-runs the deterministic Growth Engine for one business. Called by users (refresh button) and by the
/// background worker after every financial event, so forecasts and warnings stay current without manual steps.</summary>
public sealed class GrowthRefresher(IDbConnectionFactory db, FinancialSnapshotService snapshots, GrowthEngine engine, IClock clock)
{
    private static readonly HashSet<string> CashRules = ["CASH_SHORTFALL", "BELOW_BUFFER"];

    public async Task<RefreshResultDto> RefreshAsync(Guid businessId, CancellationToken ct)
    {
        await using var conn = await db.OpenAsync(ct);
        // Overdue-debt charges are evaluated first (applied only when valid, disclosed and authorised; otherwise proposed).
        await Barbershop.DebtChargeEvaluator.RunAsync(conn, businessId, clock.Today);
        var snap = await snapshots.LoadAsync(conn, businessId);
        var forecast = FinancialSnapshotService.Forecast(snap);
        var signals = await LoadSignalsAsync(conn, businessId, snap.Settings.LargeTxMultiplier, snap.Settings.CashupVarianceThresholdCents);
        var all = engine.Evaluate(FinancialSnapshotService.GrowthContext(snap, forecast, signals));
        // Fraud and integrity warnings go to the Alerts Centre; everything else is a growth recommendation.
        var drafts = all.Where(d => !AlertCodes.All.Contains(d.RuleCode)).ToList();
        var alertDrafts = all.Where(d => AlertCodes.All.Contains(d.RuleCode)).ToList();

        using var tx = conn.BeginTransaction();
        // Serialise concurrent refreshes for the same business.
        await conn.ExecuteAsync("SELECT pg_advisory_xact_lock(hashtextextended(@Key, 0))", new { Key = "growth:" + businessId }, tx);
        var existing = await GrowthRepository.ExistingForReconcileAsync(conn, tx, businessId, drafts.Select(d => d.Fingerprint).ToList());
        var plan = GrowthEngine.Reconcile(drafts, existing);

        var created = 0;
        foreach (var d in plan.ToCreate)
        {
            if (!await GrowthRepository.InsertAsync(conn, tx, businessId, d)) continue;
            created++;
            // Only genuinely urgent findings interrupt people; everything else waits for the daily briefing.
            if (d.Severity == Severities.Critical || d.RuleCode is "CASHUP_VARIANCE" or "PAYMENT_FAILURES")
            {
                var kind = CashRules.Contains(d.RuleCode) ? "cash_warning" : d.RuleCode == "CASHUP_VARIANCE" ? "cashup_variance" : "growth";
                await NotificationRepository.NotifyAsync(conn, tx, businessId, Permission.ViewBusinessInsights, kind, d.Severity,
                    d.Title, Shorten(d.Explanation), "/growth", $"rec:{d.Fingerprint}");
            }
        }
        foreach (var (id, d) in plan.ToUpdate)
            await GrowthRepository.UpdateContentAsync(conn, tx, businessId, id, d);
        if (plan.ToAutoResolve.Count > 0)
            await GrowthRepository.AutoResolveAsync(conn, tx, businessId, plan.ToAutoResolve);
        await AlertRepository.SyncAsync(conn, tx, businessId, alertDrafts);
        tx.Commit();
        return new RefreshResultDto(created, plan.ToUpdate.Count, plan.ToAutoResolve.Count);
    }

    /// <summary>Maps rows onto positional signal records by column order (Dapper constructor mapping).</summary>
    private static async Task<IReadOnlyList<T>> LoadExtraAsync<T>(IDbConnection conn, string sql, Guid businessId, Func<IDictionary<string, object?>, T> map) =>
        (await conn.QueryAsync(sql, new { B = businessId })).Select(r => map((IDictionary<string, object?>)r)).ToList();

    private static object? V(IDictionary<string, object?> r, string k) => r.TryGetValue(k, out var v) && v is not DBNull ? v : null;
    private static Guid G(IDictionary<string, object?> r, string k) => (Guid)V(r, k)!;
    private static string S(IDictionary<string, object?> r, string k) => Convert.ToString(V(r, k), System.Globalization.CultureInfo.InvariantCulture) ?? "";
    private static string? NS(IDictionary<string, object?> r, string k) => V(r, k) is { } v ? Convert.ToString(v, System.Globalization.CultureInfo.InvariantCulture) : null;
    private static long L(IDictionary<string, object?> r, string k) => V(r, k) is { } v ? Convert.ToInt64(v, System.Globalization.CultureInfo.InvariantCulture) : 0;
    private static long? NL(IDictionary<string, object?> r, string k) => V(r, k) is { } v ? Convert.ToInt64(v, System.Globalization.CultureInfo.InvariantCulture) : null;
    private static bool B(IDictionary<string, object?> r, string k) => V(r, k) is { } v && Convert.ToBoolean(v, System.Globalization.CultureInfo.InvariantCulture);
    private static DateOnly D(IDictionary<string, object?> r, string k) => V(r, k) switch
    {
        DateOnly d => d,
        DateTime dt => DateOnly.FromDateTime(dt),
        string str => DateOnly.Parse(str, System.Globalization.CultureInfo.InvariantCulture),
        _ => DateOnly.MinValue
    };

    private static string Shorten(string s) => s.Length <= 280 ? s : s[..277] + "...";

    // ------------------------------------------------------------------ anomaly signals from stored records

    private sealed class EventRow { public Guid Id { get; set; } public string ProviderKey { get; set; } = ""; public DateTime At { get; set; } public int DuplicateCount { get; set; } public string ExternalEventId { get; set; } = ""; }
    private sealed class PayRow { public Guid Id { get; set; } public string ProviderKey { get; set; } = ""; public long GrossCents { get; set; } public DateTime OccurredAt { get; set; } public string Status { get; set; } = ""; public string? MerchantReference { get; set; } public string Kind { get; set; } = ""; public string Environment { get; set; } = ""; }
    private sealed class LedRow { public Guid Id { get; set; } public string Type { get; set; } = ""; public long AmountCents { get; set; } public DateOnly TransactionDate { get; set; } public string Description { get; set; } = ""; public string Origin { get; set; } = ""; }
    private sealed class CashRow { public Guid Id { get; set; } public string? StaffName { get; set; } public string BranchName { get; set; } = ""; public long VarianceCents { get; set; } public DateTime ClosedAt { get; set; } }
    private sealed class StockRow { public Guid Id { get; set; } public string ProductName { get; set; } = ""; public string BranchName { get; set; } = ""; public int QuantityDelta { get; set; } public long UnitCostCents { get; set; } public DateTime CreatedAt { get; set; } public string Status { get; set; } = ""; public string MovementType { get; set; } = ""; }
    private sealed class AuditRow { public Guid? EntityId { get; set; } public string Action { get; set; } = ""; public DateTime CreatedAt { get; set; } public string Details { get; set; } = "{}"; }

    private static DateOnly Sa(DateTime utc) => DateOnly.FromDateTime(DateTime.SpecifyKind(utc, DateTimeKind.Utc).AddHours(2));

    public async Task<AnomalySignals> LoadSignalsAsync(IDbConnection conn, Guid businessId, decimal multiplier, long cashupThreshold)
    {
        var p = new { B = businessId };
        var dups = await conn.QueryAsync<EventRow>(
            "SELECT id, provider_key, COALESCE(last_duplicate_at, received_at) AS at, duplicate_count, external_event_id FROM provider_events WHERE business_id = @B AND duplicate_count > 0 AND COALESCE(last_duplicate_at, received_at) > now() - interval '8 days'", p);
        var pays = (await conn.QueryAsync<PayRow>(
            "SELECT id, provider_key, gross_cents, occurred_at, status, merchant_reference, kind, environment FROM provider_payments WHERE business_id = @B AND occurred_at > now() - interval '36 days'", p)).ToList();
        var ledger = await conn.QueryAsync<LedRow>(
            """
            SELECT id, type, amount_cents, transaction_date, description, origin FROM transactions
            WHERE business_id = @B AND status = 'posted' AND payment_status IN ('recorded_manually','confirmed_external')
              AND transaction_date > (now() AT TIME ZONE 'Africa/Johannesburg')::date - 120
            """, p);
        var cash = await conn.QueryAsync<CashRow>(
            """
            SELECT s.id, COALESCE(m.display_name, m.email, 'A staff member') AS staff_name, b.name AS branch_name, s.variance_cents, s.closed_at
            FROM shifts s JOIN branches b ON b.id = s.branch_id
            LEFT JOIN business_members m ON m.business_id = s.business_id AND m.user_id = s.staff_user_id
            WHERE s.business_id = @B AND s.status = 'closed' AND s.needs_review
            """, p);
        var stock = await conn.QueryAsync<StockRow>(
            """
            SELECT sm.id, pr.name AS product_name, b.name AS branch_name, sm.quantity_delta, COALESCE(sm.unit_cost_cents, pr.unit_cost_cents) AS unit_cost_cents,
                   sm.created_at, sm.status, sm.movement_type
            FROM stock_movements sm JOIN products pr ON pr.id = sm.product_id JOIN branches b ON b.id = sm.branch_id
            WHERE sm.business_id = @B AND sm.movement_type IN ('adjustment','damaged') AND sm.created_at > now() - interval '15 days'
            """, p);
        var audit = await conn.QueryAsync<AuditRow>(
            "SELECT entity_id, action, created_at, details::text AS details FROM audit_events WHERE business_id = @B AND entity_type = 'integration_connection' AND created_at > now() - interval '8 days'", p);

        PaymentSignal Ps(PayRow r) => new(r.Id, r.Environment == "sandbox" ? "Sandbox" : r.ProviderKey, r.GrossCents, Sa(r.OccurredAt), r.Status, r.MerchantReference);
        return new AnomalySignals(
            dups.Select(d => new EventSignal(d.Id, d.ProviderKey, Sa(d.At), $"event {d.ExternalEventId} repeated {d.DuplicateCount} time(s)")).ToList(),
            pays.Where(x => x.Kind == "payment").Select(Ps).ToList(),
            pays.Where(x => x.Kind == "refund" && x.Status == "completed").Select(Ps).ToList(),
            ledger.Select(l => new LedgerSignal(l.Id, l.Type, l.AmountCents, l.TransactionDate, l.Description, l.Origin)).ToList(),
            cash.Select(c => new CashUpSignal(c.Id, c.StaffName ?? "A staff member", c.BranchName, c.VarianceCents, Sa(c.ClosedAt))).ToList(),
            stock.Select(s => new StockAdjustmentSignal(s.Id, s.ProductName, s.BranchName, s.QuantityDelta, Math.Abs((long)s.QuantityDelta) * s.UnitCostCents, Sa(s.CreatedAt), s.Status, s.MovementType)).ToList(),
            audit.Select(a => new ConfigChangeSignal(a.EntityId, a.Action, Sa(a.CreatedAt), a.Action.Replace('_', ' '))).ToList(),
            multiplier, cashupThreshold,
            await LoadExtraAsync<BookingPaymentSignal>(conn, """
                SELECT b.id AS booking_id, b.reference, b.total_cents,
                    COALESCE((SELECT SUM(t.amount_cents) FROM transactions t WHERE t.booking_id = b.id AND t.type = 'income' AND t.status = 'posted' AND t.payment_status IN ('recorded_manually','confirmed_external')), 0)::bigint AS paid_cents,
                    COALESCE((SELECT SUM(t.amount_cents) FROM transactions t WHERE t.booking_id = b.id AND t.type = 'income' AND t.status = 'posted' AND t.payment_status = 'awaiting_confirmation'), 0)::bigint AS pending_cents,
                    EXISTS (SELECT 1 FROM receivables r WHERE r.booking_id = b.id) AS has_debt, (b.starts_at AT TIME ZONE 'Africa/Johannesburg')::date AS date
                FROM bookings b WHERE b.business_id = @B AND b.status = 'completed' AND b.source <> 'history' AND b.starts_at > now() - interval '30 days'
                """, businessId, r => new BookingPaymentSignal(G(r, "booking_id"), S(r, "reference"), L(r, "total_cents"), L(r, "paid_cents"), L(r, "pending_cents"), B(r, "has_debt"), D(r, "date"))),
            await LoadExtraAsync<ProofSignal>(conn, """
                SELECT p.id, p.claimed_amount_cents AS claimed_cents, (p.created_at AT TIME ZONE 'Africa/Johannesburg')::date AS date, p.status,
                    EXISTS (SELECT 1 FROM payment_proofs o WHERE o.business_id = p.business_id AND o.sha256 = p.sha256 AND o.id <> p.id) AS duplicate_file,
                    (EXTRACT(EPOCH FROM now() - p.created_at) / 86400)::int AS age_days, p.claimed_reference AS reference
                FROM payment_proofs p WHERE p.business_id = @B AND p.created_at > now() - interval '30 days'
                """, businessId, r => new ProofSignal(G(r, "id"), NL(r, "claimed_cents"), D(r, "date"), S(r, "status"), B(r, "duplicate_file"), (int)L(r, "age_days"), NS(r, "reference"))),
            await LoadExtraAsync<BankChangeSignal>(conn, """
                SELECT d.id, d.supplier_id, s.name AS supplier_name, d.account_last4 AS new_last4,
                    (SELECT v.account_last4 FROM supplier_bank_details v WHERE v.supplier_id = d.supplier_id AND v.status = 'verified' ORDER BY v.verified_at DESC LIMIT 1) AS verified_last4,
                    d.change_source AS source, (d.created_at AT TIME ZONE 'Africa/Johannesburg')::date AS date
                FROM supplier_bank_details d JOIN suppliers s ON s.id = d.supplier_id WHERE d.business_id = @B AND d.status = 'unverified'
                """, businessId, r => new BankChangeSignal(G(r, "id"), G(r, "supplier_id"), S(r, "supplier_name"), S(r, "new_last4"), NS(r, "verified_last4"), S(r, "source"), D(r, "date"))),
            await LoadExtraAsync<RecordChangeSignal>(conn, """
                SELECT a.entity_id AS transaction_id, a.action, t.description, t.amount_cents, t.transaction_date AS record_date,
                    (a.created_at AT TIME ZONE 'Africa/Johannesburg')::date AS changed_on
                FROM audit_events a JOIN transactions t ON t.id = a.entity_id AND t.business_id = a.business_id
                WHERE a.business_id = @B AND a.action IN ('transaction.updated','transaction.voided') AND a.created_at > now() - interval '14 days'
                  AND t.transaction_date < (a.created_at AT TIME ZONE 'Africa/Johannesburg')::date - 7
                """, businessId, r => new RecordChangeSignal(G(r, "transaction_id"), S(r, "action"), S(r, "description"), L(r, "amount_cents"), D(r, "record_date"), D(r, "changed_on"))),
            await LoadExtraAsync<CollectionSignal>(conn, """
                SELECT r.id AS debt_id, c.name AS customer_name,
                    GREATEST(0, r.original_amount_cents - r.written_off_cents - COALESCE((SELECT SUM(rp.amount_cents) FROM receivable_payments rp JOIN transactions t ON t.id = rp.transaction_id AND t.status <> 'voided' WHERE rp.receivable_id = r.id), 0))::bigint AS outstanding_cents,
                    ((now() AT TIME ZONE 'Africa/Johannesburg')::date - r.due_date)::int AS days_overdue,
                    (SELECT COUNT(*) FROM receivable_reminders m WHERE m.receivable_id = r.id AND m.outcome IN ('no_answer','refused'))::int AS failed_attempts, r.disputed
                FROM receivables r JOIN customers c ON c.id = r.customer_id
                WHERE r.business_id = @B AND r.status = 'open' AND r.due_date < (now() AT TIME ZONE 'Africa/Johannesburg')::date
                """, businessId, r => new CollectionSignal(G(r, "debt_id"), S(r, "customer_name"), L(r, "outstanding_cents"), (int)L(r, "days_overdue"), (int)L(r, "failed_attempts"), B(r, "disputed"))),
            await LoadExtraAsync<HouseCallCostSignal>(conn, """
                SELECT b.id AS booking_id, b.travel_fee_cents,
                    COALESCE((SELECT SUM(t.amount_cents) FROM transactions t WHERE t.booking_id = b.id AND t.type = 'expense' AND t.status = 'posted'), 0)::bigint AS actual_costs_cents,
                    (b.starts_at AT TIME ZONE 'Africa/Johannesburg')::date AS date
                FROM bookings b WHERE b.business_id = @B AND b.location_type = 'house_call' AND b.status = 'completed' AND b.starts_at > now() - interval '60 days'
                """, businessId, r => new HouseCallCostSignal(G(r, "booking_id"), L(r, "travel_fee_cents"), L(r, "actual_costs_cents"), D(r, "date"))),
            await LoadExtraAsync<ServiceSaleSignal>(conn, """
                SELECT i.service_name, i.unit_price_cents AS amount_cents, (b.starts_at AT TIME ZONE 'Africa/Johannesburg')::date AS date
                FROM booking_items i JOIN bookings b ON b.id = i.booking_id
                WHERE b.business_id = @B AND b.status = 'completed' AND b.starts_at > now() - interval '60 days'
                """, businessId, r => new ServiceSaleSignal(S(r, "service_name"), L(r, "amount_cents"), D(r, "date"))),
            await LoadExtraAsync<LowStockSignal>(conn, """
                SELECT p.id AS product_id, p.name AS product_name, br.name AS branch_name, l.quantity, p.min_stock_qty AS min_stock, p.stock_class
                FROM inventory_levels l JOIN products p ON p.id = l.product_id JOIN branches br ON br.id = l.branch_id
                WHERE l.business_id = @B AND p.is_active AND p.kind = 'product' AND p.min_stock_qty > 0 AND l.quantity <= p.min_stock_qty
                """, businessId, r => new LowStockSignal(G(r, "product_id"), S(r, "product_name"), S(r, "branch_name"), (int)L(r, "quantity"), (int)L(r, "min_stock"), S(r, "stock_class"))));
    }
}
