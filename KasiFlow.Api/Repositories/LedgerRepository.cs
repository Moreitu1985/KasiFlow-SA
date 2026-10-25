using System.Data;
using Dapper;
using KasiFlow.Api.DTOs;
using KasiFlow.Api.Models;
using KasiFlow.Core.Finance;
using KasiFlow.Core.Forecasting;

namespace KasiFlow.Api.Repositories;

/// <summary>Transactions (the cash ledger). Every statement is scoped by business_id.</summary>
public static class LedgerRepository
{
    private const string SelectWithLinks = """
        SELECT t.id, t.business_id, t.type, t.description, t.amount_cents, t.category, t.transaction_date,
               t.payment_method, t.payment_status, t.status, t.source, t.reference, t.notes, t.void_reason,
               t.voided_at, t.created_at, t.updated_at,
               rp.receivable_id, pp.payable_id, COALESCE(c.name, s.name) AS counterparty_name,
               t.origin, t.branch_id, br.name AS branch_name, t.shift_id, t.provider_payment_id, t.created_by,
               prov.provider_key, prov.status AS provider_status
        FROM transactions t
        LEFT JOIN branches br ON br.id = t.branch_id
        LEFT JOIN provider_payments prov ON prov.id = t.provider_payment_id
        LEFT JOIN receivable_payments rp ON rp.transaction_id = t.id
        LEFT JOIN receivables r ON r.id = rp.receivable_id
        LEFT JOIN customers c ON c.id = r.customer_id
        LEFT JOIN payable_payments pp ON pp.transaction_id = t.id
        LEFT JOIN payables p ON p.id = pp.payable_id
        LEFT JOIN suppliers s ON s.id = p.supplier_id
        """;

    public static async Task<(IReadOnlyList<TransactionRow> Rows, long Total)> ListAsync(IDbConnection conn, Guid businessId, TransactionQuery q)
    {
        var sql = $"""
            {SelectWithLinks.Replace("SELECT t.id,", "SELECT COUNT(*) OVER() AS total_count, t.id,")}
            WHERE t.business_id = @BusinessId
              AND (@Type::text IS NULL OR t.type = @Type)
              AND (@Category::text IS NULL OR t.category = @Category)
              AND (CASE WHEN @Status::text IS NULL THEN t.status <> 'voided'
                        WHEN @Status::text = 'all' THEN TRUE
                        ELSE t.status = @Status END)
              AND (@From::date IS NULL OR t.transaction_date >= @From::date)
              AND (@To::date IS NULL OR t.transaction_date <= @To::date)
              AND (@Search::text IS NULL OR t.description ILIKE @Search OR t.reference ILIKE @Search)
              AND (@BranchId::uuid IS NULL OR t.branch_id = @BranchId::uuid)
              AND (@Origin::text IS NULL OR t.origin = @Origin)
              AND (@AllowedBranches::uuid[] IS NULL OR t.branch_id = ANY(@AllowedBranches::uuid[]))
            ORDER BY t.transaction_date DESC, t.created_at DESC, t.id
            LIMIT @Limit OFFSET @Offset
            """;
        var rows = (await conn.QueryAsync<TransactionRow>(sql, new
        {
            BusinessId = businessId,
            q.Type,
            q.Category,
            q.Status,
            q.From,
            q.To,
            Search = string.IsNullOrWhiteSpace(q.Search) ? null : "%" + EscapeLike(q.Search.Trim()) + "%",
            q.BranchId,
            q.Origin,
            q.AllowedBranches,
            Limit = q.PageSize,
            Offset = (q.Page - 1) * q.PageSize
        })).ToList();
        // COUNT(*) OVER() gives the filtered total; a page beyond the end returns no rows and a total of 0.
        long total = rows.Count > 0 ? rows[0].TotalCount : 0;
        return (rows, total);
    }

    public static Task<TransactionRow?> GetAsync(IDbConnection conn, Guid businessId, Guid id, IDbTransaction? tx = null, bool forUpdate = false) =>
        conn.QueryFirstOrDefaultAsync<TransactionRow>(
            $"{SelectWithLinks} WHERE t.business_id = @BusinessId AND t.id = @Id{(forUpdate ? " FOR UPDATE OF t" : "")}",
            new { BusinessId = businessId, Id = id }, tx);

    public static async Task<IReadOnlyList<TransactionRow>> RecentAsync(IDbConnection conn, Guid businessId, int limit, Guid[]? allowedBranches = null) =>
        (await conn.QueryAsync<TransactionRow>(
            $"{SelectWithLinks} WHERE t.business_id = @BusinessId AND t.status <> 'voided' AND (@AllowedBranches::uuid[] IS NULL OR t.branch_id = ANY(@AllowedBranches::uuid[])) ORDER BY t.transaction_date DESC, t.created_at DESC LIMIT @Limit",
            new { BusinessId = businessId, Limit = limit, AllowedBranches = allowedBranches })).ToList();

    public static Task<Guid?> FindByIdempotencyKeyAsync(IDbConnection conn, Guid businessId, string key) =>
        conn.QueryFirstOrDefaultAsync<Guid?>("SELECT id FROM transactions WHERE business_id = @BusinessId AND idempotency_key = @Key",
            new { BusinessId = businessId, Key = key });

    public static Task<Guid> InsertAsync(IDbConnection conn, IDbTransaction? tx, Guid businessId, Guid userId, string type, string description,
        long amountCents, string category, DateOnly date, string paymentMethod, string paymentStatus, string status, string source,
        string? reference, string? notes, string origin = "staff_recorded", Guid? branchId = null, Guid? shiftId = null,
        Guid? providerPaymentId = null, string? idempotencyKey = null) =>
        conn.QuerySingleAsync<Guid>(
            """
            INSERT INTO transactions (business_id, type, description, amount_cents, category, transaction_date, payment_method,
                                      payment_status, status, source, reference, notes, created_by, origin, branch_id, shift_id,
                                      provider_payment_id, idempotency_key)
            VALUES (@BusinessId, @Type, @Description, @AmountCents, @Category, @Date, @PaymentMethod,
                    @PaymentStatus, @Status, @Source, @Reference, @Notes, @UserId, @Origin, @BranchId, @ShiftId,
                    @ProviderPaymentId, @IdempotencyKey)
            RETURNING id
            """,
            new
            {
                BusinessId = businessId, Type = type, Description = description, AmountCents = amountCents, Category = category,
                Date = date, PaymentMethod = paymentMethod, PaymentStatus = paymentStatus, Status = status, Source = source,
                Reference = reference, Notes = notes, UserId = userId, Origin = origin, BranchId = branchId, ShiftId = shiftId,
                ProviderPaymentId = providerPaymentId, IdempotencyKey = idempotencyKey
            }, tx);

    public static Task<int> UpdateManualAsync(IDbConnection conn, IDbTransaction? tx, Guid businessId, Guid id, TransactionInput i) =>
        conn.ExecuteAsync(
            """
            UPDATE transactions SET type = @Type, description = @Description, amount_cents = @AmountCents, category = @Category,
                transaction_date = @TransactionDate, payment_method = @PaymentMethod, payment_status = @PaymentStatus,
                status = @Status, reference = @Reference, notes = @Notes, branch_id = COALESCE(@BranchId, branch_id), updated_at = now()
            WHERE business_id = @BusinessId AND id = @Id AND source = 'manual' AND status <> 'voided'
            """,
            new
            {
                BusinessId = businessId, Id = id, i.Type, Description = i.Description!.Trim(), i.AmountCents, i.Category,
                i.TransactionDate, i.PaymentMethod, i.PaymentStatus, i.Status, Reference = Clean(i.Reference), Notes = Clean(i.Notes),
                i.BranchId
            }, tx);

    public static Task<int> VoidAsync(IDbConnection conn, IDbTransaction tx, Guid businessId, Guid id, string reason) =>
        conn.ExecuteAsync(
            "UPDATE transactions SET status = 'voided', void_reason = @Reason, voided_at = now(), updated_at = now() WHERE business_id = @BusinessId AND id = @Id AND status <> 'voided'",
            new { BusinessId = businessId, Id = id, Reason = reason }, tx);

    /// <summary>All non-voided ledger rows used by calculations (cash balance, summaries).</summary>
    public static async Task<IReadOnlyList<LedgerEntry>> LedgerEntriesAsync(IDbConnection conn, Guid businessId, DateOnly? from = null, DateOnly? to = null) =>
        (await conn.QueryAsync<LedgerEntryRow>(
            """
            SELECT id, type, amount_cents, transaction_date, category, status, payment_status
            FROM transactions
            WHERE business_id = @BusinessId AND status <> 'voided'
              AND (@From::date IS NULL OR transaction_date >= @From::date)
              AND (@To::date IS NULL OR transaction_date <= @To::date)
            """,
            new { BusinessId = businessId, From = from, To = to }))
        .Select(r => new LedgerEntry(r.Id, r.Type, r.AmountCents, r.TransactionDate, r.Category, r.Status, r.PaymentStatus))
        .ToList();

    public static async Task<IReadOnlyList<ScheduledItem>> ScheduledAsync(IDbConnection conn, Guid businessId) =>
        (await conn.QueryAsync<TransactionRow>(
            "SELECT id, type, description, amount_cents, transaction_date, payment_status FROM transactions WHERE business_id = @BusinessId AND status = 'scheduled'",
            new { BusinessId = businessId }))
        .Select(r => new ScheduledItem(r.Id, r.Type, r.Description, r.AmountCents, r.TransactionDate, r.PaymentStatus))
        .ToList();

    public static async Task<IReadOnlyList<UnconfirmedItem>> UnconfirmedAsync(IDbConnection conn, Guid businessId) =>
        (await conn.QueryAsync<TransactionRow>(
            "SELECT id, type, description, amount_cents, transaction_date FROM transactions WHERE business_id = @BusinessId AND status = 'posted' AND payment_status = 'awaiting_confirmation'",
            new { BusinessId = businessId }))
        .Select(r => new UnconfirmedItem(r.Id, r.Type, r.Description, r.AmountCents, r.TransactionDate))
        .ToList();

    public static string EscapeLike(string s) => s.Replace("\\", "\\\\").Replace("%", "\\%").Replace("_", "\\_");

    private static string? Clean(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();

    private sealed class LedgerEntryRow
    {
        public Guid Id { get; set; }
        public string Type { get; set; } = "";
        public long AmountCents { get; set; }
        public DateOnly TransactionDate { get; set; }
        public string Category { get; set; } = "";
        public string Status { get; set; } = "";
        public string PaymentStatus { get; set; } = "";
    }
}
