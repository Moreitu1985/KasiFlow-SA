using System.Data;
using System.Text.Json;
using Dapper;
using KasiFlow.Core.Access;
using KasiFlow.Core.Inventory;

namespace KasiFlow.Api.Repositories;

public static class JobTypes
{
    public const string ProcessProviderEvent = "process_provider_event";
    public const string GrowthRefresh = "growth_refresh";
    public const string SyncConnection = "sync_connection";
    public const string DailyBriefing = "daily_briefing";
}

public sealed class JobRow
{
    public Guid Id { get; set; }
    public string JobType { get; set; } = "";
    public Guid? BusinessId { get; set; }
    public string? DedupeKey { get; set; }
    public string Payload { get; set; } = "{}";
    public string Status { get; set; } = "";
    public int Attempts { get; set; }
    public int MaxAttempts { get; set; }
    public DateTime RunAfter { get; set; }
    public string? LastError { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
    public DateTime? CompletedAt { get; set; }
}

/// <summary>Durable job queue in PostgreSQL. Work survives restarts; nothing financial lives only in memory.</summary>
public static class JobQueue
{
    private const string Columns = "id, job_type, business_id, dedupe_key, payload::text AS payload, status, attempts, max_attempts, run_after, last_error, created_at, updated_at, completed_at";

    /// <summary>Enqueues a job. With a dedupe key, at most one waiting job exists per (type, key).</summary>
    public static Task EnqueueAsync(IDbConnection conn, IDbTransaction? tx, string jobType, Guid? businessId, string? dedupeKey,
        object? payload = null, TimeSpan? delay = null) =>
        conn.ExecuteAsync(
            """
            INSERT INTO background_jobs (job_type, business_id, dedupe_key, payload, run_after)
            VALUES (@JobType, @BusinessId, @DedupeKey, @Payload::jsonb, now() + make_interval(secs => @DelaySeconds))
            ON CONFLICT (job_type, dedupe_key) WHERE dedupe_key IS NOT NULL AND status IN ('queued','failed') DO NOTHING
            """,
            new
            {
                JobType = jobType, BusinessId = businessId, DedupeKey = dedupeKey,
                Payload = JsonSerializer.Serialize(payload ?? new { }), DelaySeconds = (delay ?? TimeSpan.Zero).TotalSeconds
            }, tx);

    public static Task EnqueueGrowthRefreshAsync(IDbConnection conn, IDbTransaction? tx, Guid businessId) =>
        EnqueueAsync(conn, tx, JobTypes.GrowthRefresh, businessId, $"growth:{businessId}", new { businessId }, TimeSpan.FromSeconds(1));

    /// <summary>Claims one due job atomically (FOR UPDATE SKIP LOCKED) so several workers never run the same job.</summary>
    public static Task<JobRow?> ClaimAsync(IDbConnection conn) =>
        conn.QueryFirstOrDefaultAsync<JobRow>(
            $"""
            UPDATE background_jobs SET status = 'running', attempts = attempts + 1, locked_at = now(), updated_at = now()
            WHERE id = (
                SELECT id FROM background_jobs
                WHERE status IN ('queued','failed') AND run_after <= now()
                ORDER BY run_after
                LIMIT 1
                FOR UPDATE SKIP LOCKED)
            RETURNING {Columns}
            """);

    public static Task CompleteAsync(IDbConnection conn, Guid id) =>
        conn.ExecuteAsync("UPDATE background_jobs SET status = 'succeeded', completed_at = now(), updated_at = now(), locked_at = NULL, last_error = NULL WHERE id = @Id", new { Id = id });

    /// <summary>Records a failure: retried with exponential back-off, or moved to 'dead' after max attempts.</summary>
    public static Task<string?> FailAsync(IDbConnection conn, Guid id, string error) =>
        conn.QueryFirstOrDefaultAsync<string>(
            """
            UPDATE background_jobs j
            SET status = CASE WHEN j.attempts >= j.max_attempts THEN 'dead'
                              -- A newer waiting job with the same key supersedes this one (keeps the dedupe index valid).
                              WHEN j.dedupe_key IS NOT NULL AND EXISTS (SELECT 1 FROM background_jobs o WHERE o.job_type = j.job_type
                                   AND o.dedupe_key = j.dedupe_key AND o.status IN ('queued','failed') AND o.id <> j.id) THEN 'superseded'
                              ELSE 'failed' END,
                run_after = now() + make_interval(secs => LEAST(600, 5 * power(2, j.attempts))),
                last_error = left(@Error, 500), locked_at = NULL, updated_at = now()
            WHERE j.id = @Id
            RETURNING j.status
            """, new { Id = id, Error = error });

    /// <summary>Jobs left 'running' by a crashed process go back to the queue.</summary>
    public static async Task<int> RequeueStaleAsync(IDbConnection conn)
    {
        var stale = (await conn.QueryAsync<Guid>("SELECT id FROM background_jobs WHERE status = 'running' AND locked_at < now() - interval '5 minutes'")).ToList();
        var n = 0;
        foreach (var id in stale)
        {
            // One row at a time: if a newer job with the same key is already waiting, this one is superseded instead.
            n += await conn.ExecuteAsync(
                """
                UPDATE background_jobs j SET
                    status = CASE WHEN j.dedupe_key IS NOT NULL AND EXISTS (SELECT 1 FROM background_jobs o WHERE o.job_type = j.job_type
                                  AND o.dedupe_key = j.dedupe_key AND o.status IN ('queued','failed') AND o.id <> j.id) THEN 'superseded' ELSE 'failed' END,
                    locked_at = NULL, last_error = 'Worker stopped while running; retrying.', updated_at = now()
                WHERE j.id = @Id AND j.status = 'running'
                """, new { Id = id });
        }
        return n;
    }

    public static async Task<IReadOnlyList<JobRow>> ListAsync(IDbConnection conn, Guid businessId, string? status) =>
        (await conn.QueryAsync<JobRow>(
            $"SELECT {Columns} FROM background_jobs WHERE business_id = @BusinessId AND (@Status::text IS NULL OR status = @Status) ORDER BY created_at DESC LIMIT 100",
            new { BusinessId = businessId, Status = status })).ToList();

    /// <summary>Manual retry of a failed or dead job. Safe because every handler is idempotent.</summary>
    public static Task<int> RetryAsync(IDbConnection conn, Guid businessId, Guid id) =>
        conn.ExecuteAsync(
            "UPDATE background_jobs SET status = 'queued', run_after = now(), max_attempts = GREATEST(max_attempts, attempts + 3), updated_at = now() WHERE id = @Id AND business_id = @BusinessId AND status IN ('failed','dead') AND (dedupe_key IS NULL OR NOT EXISTS (SELECT 1 FROM background_jobs o WHERE o.job_type = background_jobs.job_type AND o.dedupe_key = background_jobs.dedupe_key AND o.status IN ('queued','failed') AND o.id <> background_jobs.id))",
            new { Id = id, BusinessId = businessId });
}

/// <summary>In-app notifications. One row per recipient; recipients are active members whose role grants the given permission.</summary>
public static class NotificationRepository
{
    public sealed class Recipient
    {
        public Guid UserId { get; set; }
        public string Role { get; set; } = "";
        public bool InBranch { get; set; }
        public bool InApp { get; set; } = true;
        public bool CriticalCash { get; set; } = true;
        public bool Cashup { get; set; } = true;
        public bool LowStock { get; set; } = true;
        public bool Integrations { get; set; } = true;
    }

    /// <param name="branchId">When set, branch-scoped roles are only notified if they are assigned to that branch;
    /// when not set, branch-scoped roles are not notified (the event is business-wide).</param>
    public static async Task<int> NotifyAsync(IDbConnection conn, IDbTransaction? tx, Guid businessId, Permission audience, string kind,
        string severity, string title, string body, string? link, string? dedupeKey, Guid? branchId = null)
    {
        var recipients = await conn.QueryAsync<Recipient>(
            """
            SELECT m.user_id, m.role,
                   EXISTS (SELECT 1 FROM member_branches mb WHERE mb.business_id = m.business_id AND mb.user_id = m.user_id AND mb.branch_id = @BranchId) AS in_branch,
                   COALESCE(p.in_app, TRUE) AS in_app, COALESCE(p.critical_cash, TRUE) AS critical_cash,
                   COALESCE(p.cashup, TRUE) AS cashup, COALESCE(p.low_stock, TRUE) AS low_stock, COALESCE(p.integrations, TRUE) AS integrations
            FROM business_members m
            LEFT JOIN notification_preferences p ON p.business_id = m.business_id AND p.user_id = m.user_id
            WHERE m.business_id = @BusinessId AND m.is_active
            """, new { BusinessId = businessId, BranchId = branchId }, tx);
        var sent = 0;
        foreach (var r in recipients)
        {
            if (!RolePermissions.Has(r.Role, audience) || !r.InApp) continue;
            if (Roles.IsBranchScoped(r.Role) && (branchId is null || !r.InBranch)) continue;
            var wants = kind switch
            {
                "cash_warning" => r.CriticalCash,
                "cashup_variance" => r.Cashup,
                "low_stock" => r.LowStock,
                "integration" => r.Integrations,
                _ => true
            };
            if (!wants) continue;
            sent += await conn.ExecuteAsync(
                """
                INSERT INTO notifications (business_id, user_id, kind, severity, title, body, link, dedupe_key)
                VALUES (@BusinessId, @UserId, @Kind, @Severity, @Title, @Body, @Link, @DedupeKey)
                ON CONFLICT (business_id, user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
                """,
                new { BusinessId = businessId, r.UserId, Kind = kind, Severity = severity, Title = title, Body = body, Link = link, DedupeKey = dedupeKey }, tx);
        }
        return sent;
    }
}

/// <summary>Applies stock movements. Automated movements carry a source key so a retried event never moves stock twice.</summary>
public static class StockLedger
{
    public sealed record Result(bool Applied, int NewQuantity, int MinStock, string ProductName);

    public static async Task<Result?> ApplyAsync(IDbConnection conn, IDbTransaction tx, Guid businessId, Guid productId, Guid branchId,
        string movementType, int quantityDelta, string? reason, string? sourceKey, Guid? userId, Guid? providerPaymentId = null,
        Guid? transactionId = null, long? unitCostCents = null, Guid? transferGroup = null, string status = "applied", Guid? approvedBy = null)
    {
        if (!MovementTypes.All.Contains(movementType)) throw new ArgumentException("Unknown movement type.");
        var inserted = await conn.QueryFirstOrDefaultAsync<Guid?>(
            """
            INSERT INTO stock_movements (business_id, product_id, branch_id, movement_type, quantity_delta, unit_cost_cents, status, reason,
                                         source_key, provider_payment_id, transaction_id, transfer_group, created_by, approved_by, approved_at)
            VALUES (@BusinessId, @ProductId, @BranchId, @Type, @Delta, @UnitCost, @Status, @Reason, @SourceKey, @ProviderPaymentId,
                    @TransactionId, @TransferGroup, @UserId, @ApprovedBy, CASE WHEN @ApprovedBy::uuid IS NULL THEN NULL ELSE now() END)
            ON CONFLICT (source_key) DO NOTHING
            RETURNING id
            """,
            new
            {
                BusinessId = businessId, ProductId = productId, BranchId = branchId, Type = movementType, Delta = quantityDelta,
                UnitCost = unitCostCents, Status = status, Reason = reason, SourceKey = sourceKey, ProviderPaymentId = providerPaymentId,
                TransactionId = transactionId, TransferGroup = transferGroup, UserId = userId, ApprovedBy = approvedBy
            }, tx);
        if (inserted is null) return null; // already applied earlier (idempotent replay)
        if (status != "applied") return new Result(false, 0, 0, "");
        return await ApplyLevelAsync(conn, tx, businessId, productId, branchId, quantityDelta);
    }

    public static async Task<Result> ApplyLevelAsync(IDbConnection conn, IDbTransaction tx, Guid businessId, Guid productId, Guid branchId, int delta)
    {
        var qty = await conn.QuerySingleAsync<int>(
            """
            INSERT INTO inventory_levels (business_id, product_id, branch_id, quantity, updated_at)
            VALUES (@BusinessId, @ProductId, @BranchId, @Delta, now())
            ON CONFLICT (product_id, branch_id) DO UPDATE SET quantity = inventory_levels.quantity + EXCLUDED.quantity, updated_at = now()
            RETURNING quantity
            """, new { BusinessId = businessId, ProductId = productId, BranchId = branchId, Delta = delta }, tx);
        var p = await conn.QuerySingleAsync<(int MinStock, string Name)>(
            "SELECT min_stock_qty, name FROM products WHERE id = @ProductId AND business_id = @BusinessId", new { ProductId = productId, BusinessId = businessId }, tx);
        return new Result(true, qty, p.MinStock, p.Name);
    }

    /// <summary>Raises a low-stock notification the first time stock crosses at or below the minimum.</summary>
    public static async Task NotifyIfLowAsync(IDbConnection conn, IDbTransaction tx, Guid businessId, Guid productId, Guid branchId, Result? r, int delta)
    {
        if (r is null || !r.Applied || r.MinStock <= 0 || delta >= 0) return;
        if (r.NewQuantity <= r.MinStock && r.NewQuantity - delta > r.MinStock)
            await NotificationRepository.NotifyAsync(conn, tx, businessId, Permission.ManageInventory, "low_stock", "warning",
                $"Low stock: {r.ProductName}", $"Only {r.NewQuantity} left (minimum {r.MinStock}). See Inventory → Reorder suggestions.",
                "/inventory", $"low:{productId}:{branchId}:{DateTime.UtcNow:yyyyMMddHH}", branchId);
    }
}
