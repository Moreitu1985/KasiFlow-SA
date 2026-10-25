using System.Data;
using System.Text.Json;
using Dapper;
using KasiFlow.Api.Data;
using KasiFlow.Api.DTOs;
using KasiFlow.Api.Middleware;
using KasiFlow.Api.Repositories;
using KasiFlow.Core.Access;
using KasiFlow.Core.Common;
using KasiFlow.Core.Integrations;
using KasiFlow.Core.Validation;

namespace KasiFlow.Api.Services.Automation;

/// <summary>Shifts and cash-up. Expected cash is calculated from recorded cash sales, refunds, paid-outs, drops and
/// float top-ups; card and QR payments never count as till cash. Variances are flagged for review, never as accusations.</summary>
public sealed class ShiftService(IDbConnectionFactory db, IBusinessContext business)
{
    private sealed class ShiftRow
    {
        public Guid Id { get; set; }
        public Guid BranchId { get; set; }
        public string BranchName { get; set; } = "";
        public Guid StaffUserId { get; set; }
        public string? StaffName { get; set; }
        public DateTime OpenedAt { get; set; }
        public long OpeningFloatCents { get; set; }
        public DateTime? ClosedAt { get; set; }
        public long? CountedCashCents { get; set; }
        public long? ExpectedCashCents { get; set; }
        public long? VarianceCents { get; set; }
        public bool NeedsReview { get; set; }
        public string Status { get; set; } = "";
        public string? CloseNote { get; set; }
        public string? ReviewNote { get; set; }
        public DateTime? ReviewedAt { get; set; }
    }

    private const string Select = """
        SELECT s.id, s.branch_id, b.name AS branch_name, s.staff_user_id, COALESCE(m.display_name, m.email, 'Team member') AS staff_name,
               s.opened_at, s.opening_float_cents, s.closed_at, s.counted_cash_cents, s.expected_cash_cents, s.variance_cents,
               s.needs_review, s.status, s.close_note, s.review_note, s.reviewed_at
        FROM shifts s JOIN branches b ON b.id = s.branch_id
        LEFT JOIN business_members m ON m.business_id = s.business_id AND m.user_id = s.staff_user_id
        """;

    private sealed class Totals
    {
        public long CashSales { get; set; }
        public int CashSalesCount { get; set; }
        public long CashRefunds { get; set; }
        public long PaidOuts { get; set; }
        public long Drops { get; set; }
        public long TopUps { get; set; }
        public long NonCash { get; set; }
    }

    private static async Task<ShiftBreakdownDto> BreakdownAsync(IDbConnection conn, IDbTransaction? tx, Guid businessId, ShiftRow s)
    {
        var t = await conn.QuerySingleAsync<Totals>(
            """
            SELECT
              COALESCE(SUM(amount_cents) FILTER (WHERE type = 'income'), 0)::bigint AS cash_sales,
              COUNT(*) FILTER (WHERE type = 'income')::int AS cash_sales_count,
              COALESCE(SUM(amount_cents) FILTER (WHERE type = 'expense' AND category = 'Refunds'), 0)::bigint AS cash_refunds,
              COALESCE(SUM(amount_cents) FILTER (WHERE type = 'expense' AND category <> 'Refunds'), 0)::bigint AS paid_outs,
              (SELECT COALESCE(SUM(amount_cents), 0) FROM shift_cash_movements WHERE shift_id = @S AND kind = 'cash_drop')::bigint AS drops,
              (SELECT COALESCE(SUM(amount_cents), 0) FROM shift_cash_movements WHERE shift_id = @S AND kind = 'float_top_up')::bigint AS top_ups,
              (SELECT COALESCE(SUM(n.amount_cents), 0) FROM transactions n JOIN shifts sh ON sh.id = @S
                  WHERE n.business_id = @B AND n.branch_id = sh.branch_id AND n.created_by = sh.staff_user_id
                  AND n.type = 'income' AND n.status = 'posted' AND n.payment_method <> 'cash'
                  AND n.created_at >= sh.opened_at AND n.created_at <= COALESCE(sh.closed_at, now()))::bigint AS non_cash
            FROM transactions WHERE business_id = @B AND shift_id = @S AND status = 'posted' AND payment_method = 'cash'
            """, new { B = businessId, S = s.Id }, tx);
        var expected = CashUp.Expected(s.OpeningFloatCents,
        [
            new(CashUp.Kinds.CashSale, t.CashSales), new(CashUp.Kinds.CashRefund, t.CashRefunds), new(CashUp.Kinds.PaidOut, t.PaidOuts),
            new(CashUp.Kinds.CashDrop, t.Drops), new(CashUp.Kinds.FloatTopUp, t.TopUps)
        ]);
        return new ShiftBreakdownDto(t.CashSales, t.CashSalesCount, t.CashRefunds, t.PaidOuts, t.Drops, t.TopUps, t.NonCash, expected);
    }

    private static async Task<ShiftDto> ToDtoAsync(IDbConnection conn, IDbTransaction? tx, Guid businessId, ShiftRow s) =>
        new(s.Id, s.BranchId, s.BranchName, s.StaffUserId, s.StaffName ?? "Team member", s.OpenedAt, s.OpeningFloatCents, s.ClosedAt,
            s.CountedCashCents, s.ExpectedCashCents, s.VarianceCents, s.NeedsReview, s.Status, s.CloseNote, s.ReviewNote, s.ReviewedAt,
            await BreakdownAsync(conn, tx, businessId, s));

    private static Task<ShiftRow?> GetRowAsync(IDbConnection conn, IDbTransaction? tx, Guid businessId, Guid id, bool forUpdate = false) =>
        conn.QueryFirstOrDefaultAsync<ShiftRow>($"{Select} WHERE s.business_id = @B AND s.id = @Id{(forUpdate ? " FOR UPDATE OF s" : "")}", new { B = businessId, Id = id }, tx);

    /// <summary>Own shift, or a reviewer of that branch.</summary>
    private static void EnsureCanSee(AccessContext a, ShiftRow s)
    {
        if (s.StaffUserId == a.UserId && a.Can(Permission.OperateShift)) return;
        if (a.Can(Permission.ReviewShifts) && a.CanSeeBranch(s.BranchId)) return;
        throw new NotFoundException();
    }

    public async Task<IReadOnlyList<ShiftDto>> ListAsync(string? status, CancellationToken ct)
    {
        var access = await business.RequireAsync(Permission.OperateShift, Permission.ReviewShifts, Permission.ViewPerformance);
        if (status is not (null or "" or "open" or "closed" or "reviewed" or "needs_review"))
            throw new RequestValidationException(new ValidationErrors().Add("status", "Unknown status."));
        var onlyOwn = !access.Can(Permission.ReviewShifts) && !access.Can(Permission.ViewPerformance);
        await using var conn = await db.OpenAsync(ct);
        var rows = await conn.QueryAsync<ShiftRow>(
            $"""
            {Select}
            WHERE s.business_id = @B
              AND (@Status::text IS NULL OR (@Status = 'needs_review' AND s.status = 'closed' AND s.needs_review) OR s.status = @Status)
              AND (NOT @OnlyOwn OR s.staff_user_id = @U)
              AND (@Branches::uuid[] IS NULL OR s.branch_id = ANY(@Branches::uuid[]) OR s.staff_user_id = @U)
            ORDER BY s.opened_at DESC LIMIT 100
            """, new { B = access.BusinessId, Status = string.IsNullOrEmpty(status) ? null : status, OnlyOwn = onlyOwn, U = access.UserId, Branches = access.BranchFilter });
        var list = new List<ShiftDto>();
        foreach (var r in rows) list.Add(await ToDtoAsync(conn, null, access.BusinessId, r));
        return list;
    }

    public async Task<ShiftDto?> CurrentAsync(CancellationToken ct)
    {
        var access = await business.RequireAsync(Permission.OperateShift, Permission.RecordSales);
        await using var conn = await db.OpenAsync(ct);
        var row = await conn.QueryFirstOrDefaultAsync<ShiftRow>($"{Select} WHERE s.business_id = @B AND s.staff_user_id = @U AND s.status = 'open' ORDER BY s.opened_at DESC LIMIT 1",
            new { B = access.BusinessId, U = access.UserId });
        return row is null ? null : await ToDtoAsync(conn, null, access.BusinessId, row);
    }

    public async Task<ShiftDto> GetAsync(Guid id, CancellationToken ct)
    {
        var access = await business.RequireAsync(Permission.OperateShift, Permission.ReviewShifts, Permission.ViewPerformance);
        await using var conn = await db.OpenAsync(ct);
        var row = await GetRowAsync(conn, null, access.BusinessId, id) ?? throw new NotFoundException();
        if (!(access.Can(Permission.ViewPerformance) && access.CanSeeBranch(row.BranchId))) EnsureCanSee(access, row);
        return await ToDtoAsync(conn, null, access.BusinessId, row);
    }

    public async Task<ShiftDto> OpenAsync(OpenShiftInput input, CancellationToken ct)
    {
        var access = await business.RequireAsync(Permission.OperateShift);
        var e = new ValidationErrors();
        if (input.OpeningFloatCents is not (>= 0 and <= 10_000_000)) e.Add("openingFloatCents", "Enter the cash in the till at the start (R0 to R100 000).");
        RequestValidationException.ThrowIfInvalid(e);
        await using var conn = await db.OpenAsync(ct);
        using var tx = conn.BeginTransaction();
        var branchId = await TransactionService.ResolveBranchAsync(conn, tx, access, input.BranchId)
                       ?? throw new RequestValidationException(new ValidationErrors().Add("branchId", "Create a branch first."));
        if (await conn.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM shifts WHERE business_id = @B AND branch_id = @Br AND staff_user_id = @U AND status = 'open'",
                new { B = access.BusinessId, Br = branchId, U = access.UserId }, tx) > 0)
            throw new ConflictException("You already have an open shift at this branch.");
        var id = await conn.QuerySingleAsync<Guid>(
            "INSERT INTO shifts (business_id, branch_id, staff_user_id, opened_by, opening_float_cents) VALUES (@B, @Br, @U, @U, @Float) RETURNING id",
            new { B = access.BusinessId, Br = branchId, U = access.UserId, Float = input.OpeningFloatCents }, tx);
        await AuditRepository.WriteAsync(conn, tx, access.BusinessId, access.UserId, "shift_opened", "shift", id);
        tx.Commit();
        return await ToDtoAsync(conn, null, access.BusinessId, (await GetRowAsync(conn, null, access.BusinessId, id))!);
    }

    public async Task<ShiftDto> AddCashMovementAsync(Guid id, CashMovementInput input, CancellationToken ct)
    {
        var access = await business.RequireAsync(Permission.OperateShift, Permission.ReviewShifts);
        var e = new ValidationErrors();
        if (input.Kind is not ("cash_drop" or "float_top_up")) e.Add("kind", "Choose cash_drop (cash taken out to the safe or bank) or float_top_up.");
        if (input.AmountCents is not (> 0 and <= 10_000_000)) e.Add("amountCents", "Enter an amount between R0.01 and R100 000.");
        if (input.Note is { Length: > 300 }) e.Add("note", "Use 300 characters or fewer.");
        RequestValidationException.ThrowIfInvalid(e);
        await using var conn = await db.OpenAsync(ct);
        using var tx = conn.BeginTransaction();
        var s = await GetRowAsync(conn, tx, access.BusinessId, id, forUpdate: true) ?? throw new NotFoundException();
        EnsureCanSee(access, s);
        if (s.Status != "open") throw new ConflictException("This shift is closed.");
        await conn.ExecuteAsync("INSERT INTO shift_cash_movements (business_id, shift_id, kind, amount_cents, note, recorded_by) VALUES (@B, @S, @K, @A, @N, @U)",
            new { B = access.BusinessId, S = id, K = input.Kind, A = input.AmountCents, N = string.IsNullOrWhiteSpace(input.Note) ? null : input.Note.Trim(), U = access.UserId }, tx);
        await AuditRepository.WriteAsync(conn, tx, access.BusinessId, access.UserId, "shift_cash_movement", "shift", id, JsonSerializer.Serialize(new { kind = input.Kind }));
        tx.Commit();
        return await ToDtoAsync(conn, null, access.BusinessId, s);
    }

    public async Task<ShiftDto> CloseAsync(Guid id, CloseShiftInput input, CancellationToken ct)
    {
        var access = await business.RequireAsync(Permission.OperateShift, Permission.ReviewShifts);
        var e = new ValidationErrors();
        if (input.CountedCashCents is not (>= 0 and <= 100_000_000)) e.Add("countedCashCents", "Enter the cash you counted in the till.");
        if (input.Note is { Length: > 1000 }) e.Add("note", "Use 1000 characters or fewer.");
        RequestValidationException.ThrowIfInvalid(e);
        await using var conn = await db.OpenAsync(ct);
        using var tx = conn.BeginTransaction();
        var s = await GetRowAsync(conn, tx, access.BusinessId, id, forUpdate: true) ?? throw new NotFoundException();
        EnsureCanSee(access, s);
        if (s.Status != "open") throw new ConflictException("This shift is already closed.");
        var threshold = await conn.ExecuteScalarAsync<long?>("SELECT cashup_variance_threshold_cents FROM business_settings WHERE business_id = @B", new { B = access.BusinessId }, tx) ?? 5000;
        var breakdown = await BreakdownAsync(conn, tx, access.BusinessId, s);
        var counted = input.CountedCashCents!.Value;
        var variance = CashUp.Variance(counted, breakdown.ExpectedNowCents);
        var review = CashUp.NeedsReview(variance, threshold);
        await conn.ExecuteAsync(
            """
            UPDATE shifts SET status = 'closed', closed_at = now(), counted_cash_cents = @Counted, expected_cash_cents = @Expected,
                variance_cents = @Variance, needs_review = @Review, close_note = @Note
            WHERE id = @Id AND business_id = @B
            """, new { Id = id, B = access.BusinessId, Counted = counted, Expected = breakdown.ExpectedNowCents, Variance = variance, Review = review,
                Note = string.IsNullOrWhiteSpace(input.Note) ? null : input.Note.Trim() }, tx);
        await AuditRepository.WriteAsync(conn, tx, access.BusinessId, access.UserId, "shift_closed", "shift", id, JsonSerializer.Serialize(new { needsReview = review }));
        if (review)
            await NotificationRepository.NotifyAsync(conn, tx, access.BusinessId, Permission.ReviewShifts, "cashup_variance", "warning",
                $"Cash-up at {s.BranchName} needs a review",
                $"Counted cash was {Money.FormatZar(Math.Abs(variance))} {(variance < 0 ? "less" : "more")} than expected. This is not proof of wrongdoing; check counting, change and unrecorded paid-outs first.",
                "/shifts", $"cashup:{id}", s.BranchId);
        await JobQueue.EnqueueGrowthRefreshAsync(conn, tx, access.BusinessId);
        tx.Commit();
        return await ToDtoAsync(conn, null, access.BusinessId, (await GetRowAsync(conn, null, access.BusinessId, id))!);
    }

    public async Task<ShiftDto> ReviewAsync(Guid id, ReviewShiftInput input, CancellationToken ct)
    {
        var access = await business.RequireAsync(Permission.ReviewShifts);
        await using var conn = await db.OpenAsync(ct);
        using var tx = conn.BeginTransaction();
        var s = await GetRowAsync(conn, tx, access.BusinessId, id, forUpdate: true) ?? throw new NotFoundException();
        if (!access.CanSeeBranch(s.BranchId)) throw new NotFoundException();
        if (s.Status != "closed") throw new ConflictException("Only a closed shift can be reviewed.");
        if (s.StaffUserId == access.UserId && s.NeedsReview && access.Role != Roles.Owner)
            throw new ForbiddenException("Someone else must review your own cash-up difference.");
        var note = input.Note?.Trim();
        if (s.NeedsReview && string.IsNullOrEmpty(note)) throw new RequestValidationException(new ValidationErrors().Add("note", "Write what you found (for example 'counting error, recounted')."));
        if (note is { Length: > 1000 }) throw new RequestValidationException(new ValidationErrors().Add("note", "Use 1000 characters or fewer."));
        await conn.ExecuteAsync("UPDATE shifts SET status = 'reviewed', review_note = @N, reviewed_by = @U, reviewed_at = now() WHERE id = @Id AND business_id = @B",
            new { N = note, U = access.UserId, Id = id, B = access.BusinessId }, tx);
        await AuditRepository.WriteAsync(conn, tx, access.BusinessId, access.UserId, "shift_reviewed", "shift", id);
        await JobQueue.EnqueueGrowthRefreshAsync(conn, tx, access.BusinessId);
        tx.Commit();
        return await ToDtoAsync(conn, null, access.BusinessId, (await GetRowAsync(conn, null, access.BusinessId, id))!);
    }
}
