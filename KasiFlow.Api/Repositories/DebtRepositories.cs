using System.Data;
using Dapper;
using KasiFlow.Api.DTOs;
using KasiFlow.Api.Models;
using KasiFlow.Core.Forecasting;

namespace KasiFlow.Api.Repositories;

/// <summary>Customers and suppliers. Table names come from a fixed whitelist, never from user input.</summary>
public static class PartyRepository
{
    public enum Kind { Customer, Supplier }

    private static (string Table, string ItemTable, string FkColumn, string PaymentTable, string ItemFk, string OpenStatus) Names(Kind k) => k == Kind.Customer
        ? ("customers", "receivables", "customer_id", "receivable_payments", "receivable_id", "open")
        : ("suppliers", "payables", "supplier_id", "payable_payments", "payable_id", "open");

    private static string SelectSql(Kind k)
    {
        var n = Names(k);
        var writtenOff = k == Kind.Customer ? "i.written_off_cents" : "0";
        return $"""
            WITH paid AS (
                SELECT pay.{n.ItemFk} AS item_id, SUM(pay.amount_cents)::bigint AS paid
                FROM {n.PaymentTable} pay JOIN transactions t ON t.id = pay.transaction_id AND t.status <> 'voided'
                WHERE pay.business_id = @BusinessId
                GROUP BY pay.{n.ItemFk}
            ), outstanding AS (
                SELECT i.{n.FkColumn} AS party_id,
                       SUM(GREATEST(i.original_amount_cents - COALESCE(p.paid, 0) - {writtenOff}, 0))::bigint AS outstanding_cents,
                       COUNT(*) AS open_items
                FROM {n.ItemTable} i LEFT JOIN paid p ON p.item_id = i.id
                WHERE i.business_id = @BusinessId AND i.status = '{n.OpenStatus}'
                GROUP BY i.{n.FkColumn}
            )
            SELECT x.id, x.name, x.phone, x.email, x.notes, x.is_archived, x.created_at,
                   COALESCE(o.outstanding_cents, 0) AS outstanding_cents, COALESCE(o.open_items, 0) AS open_items
            FROM {n.Table} x LEFT JOIN outstanding o ON o.party_id = x.id
            WHERE x.business_id = @BusinessId
            """;
    }

    public static async Task<IReadOnlyList<PartyRow>> ListAsync(IDbConnection conn, Kind kind, Guid businessId, string? search, bool includeArchived) =>
        (await conn.QueryAsync<PartyRow>(
            SelectSql(kind) + """
                 AND (@IncludeArchived OR NOT x.is_archived)
                 AND (@Search::text IS NULL OR x.name ILIKE @Search OR x.phone ILIKE @Search)
                ORDER BY COALESCE(o.outstanding_cents, 0) DESC, x.name
                LIMIT 500
                """,
            new
            {
                BusinessId = businessId,
                IncludeArchived = includeArchived,
                Search = string.IsNullOrWhiteSpace(search) ? null : "%" + LedgerRepository.EscapeLike(search.Trim()) + "%"
            })).ToList();

    public static Task<PartyRow?> GetAsync(IDbConnection conn, Kind kind, Guid businessId, Guid id) =>
        conn.QueryFirstOrDefaultAsync<PartyRow>(SelectSql(kind) + " AND x.id = @Id", new { BusinessId = businessId, Id = id });

    public static Task<bool> ExistsAsync(IDbConnection conn, IDbTransaction? tx, Kind kind, Guid businessId, Guid id) =>
        conn.ExecuteScalarAsync<bool>($"SELECT EXISTS (SELECT 1 FROM {Names(kind).Table} WHERE business_id = @BusinessId AND id = @Id)",
            new { BusinessId = businessId, Id = id }, tx);

    public static Task<Guid> InsertAsync(IDbConnection conn, Kind kind, Guid businessId, ContactInput i) =>
        conn.QuerySingleAsync<Guid>(
            $"INSERT INTO {Names(kind).Table} (business_id, name, phone, email, notes) VALUES (@BusinessId, @Name, @Phone, @Email, @Notes) RETURNING id",
            new { BusinessId = businessId, Name = i.Name!.Trim(), Phone = Clean(i.Phone), Email = Clean(i.Email), Notes = Clean(i.Notes) });

    public static Task<int> UpdateAsync(IDbConnection conn, Kind kind, Guid businessId, Guid id, ContactInput i) =>
        conn.ExecuteAsync(
            $"""
            UPDATE {Names(kind).Table} SET name = @Name, phone = @Phone, email = @Email, notes = @Notes,
                is_archived = COALESCE(@IsArchived, is_archived), updated_at = now()
            WHERE business_id = @BusinessId AND id = @Id
            """,
            new { BusinessId = businessId, Id = id, Name = i.Name!.Trim(), Phone = Clean(i.Phone), Email = Clean(i.Email), Notes = Clean(i.Notes), i.IsArchived });

    private static string? Clean(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();
}

public static class ReceivableRepository
{
    private const string BaseSql = """
        WITH paid AS (
            SELECT rp.receivable_id, SUM(rp.amount_cents)::bigint AS paid
            FROM receivable_payments rp JOIN transactions t ON t.id = rp.transaction_id AND t.status <> 'voided'
            WHERE rp.business_id = @BusinessId
            GROUP BY rp.receivable_id
        )
        SELECT COUNT(*) OVER() AS total_count, r.id, r.customer_id, c.name AS customer_name, r.description,
               r.original_amount_cents, COALESCE(p.paid, 0) AS paid_cents, r.written_off_cents, r.issue_date,
               r.due_date, r.status, r.notes, r.created_at,
               COALESCE((SELECT SUM(ch.amount_cents) FROM receivable_charges ch WHERE ch.receivable_id = r.id AND ch.status = 'applied'), 0)::bigint AS applied_charges_cents,
               COALESCE((SELECT SUM(ch.amount_cents) FROM receivable_charges ch WHERE ch.receivable_id = r.id AND ch.status = 'proposed'), 0)::bigint AS proposed_charges_cents,
               r.disputed, r.dispute_reason, r.reference, r.booking_id, r.charge_terms_disclosed_at, r.charge_terms_snapshot,
               r.charge_amount_cents, r.charge_overdue_days, r.charge_policy_version
        FROM receivables r
        JOIN customers c ON c.id = r.customer_id
        LEFT JOIN paid p ON p.receivable_id = r.id
        WHERE r.business_id = @BusinessId
        """;

    public static async Task<(IReadOnlyList<ReceivableRow>, long)> ListAsync(IDbConnection conn, Guid businessId, DateOnly today,
        string? status, string? filter, Guid? customerId, int page, int pageSize)
    {
        var rows = (await conn.QueryAsync<ReceivableRow>(
            BaseSql + """
                 AND (CASE WHEN @Status::text = 'all' THEN TRUE ELSE r.status = COALESCE(@Status::text, 'open') END)
                 AND (@CustomerId::uuid IS NULL OR r.customer_id = @CustomerId::uuid)
                 AND (CASE @Filter::text
                        WHEN 'overdue' THEN r.status = 'open' AND r.due_date < @Today::date
                        WHEN 'upcoming' THEN r.status = 'open' AND r.due_date BETWEEN @Today::date AND @UpcomingEnd::date
                        ELSE TRUE END)
                ORDER BY r.due_date NULLS LAST, r.issue_date, r.id
                LIMIT @Limit OFFSET @Offset
                """,
            new
            {
                BusinessId = businessId, Status = status, CustomerId = customerId, Filter = filter ?? "all", Today = today,
                UpcomingEnd = today.AddDays(13), Limit = pageSize, Offset = (page - 1) * pageSize
            })).ToList();
        return (rows, rows.Count > 0 ? rows[0].TotalCount : 0);
    }

    public static Task<ReceivableRow?> GetAsync(IDbConnection conn, Guid businessId, Guid id, IDbTransaction? tx = null) =>
        conn.QueryFirstOrDefaultAsync<ReceivableRow>(BaseSql + " AND r.id = @Id", new { BusinessId = businessId, Id = id }, tx);

    /// <summary>Locks the receivable row so concurrent payments cannot overpay it.</summary>
    public static Task<bool> LockAsync(IDbConnection conn, IDbTransaction tx, Guid businessId, Guid id) =>
        LockRowAsync(conn, tx, "receivables", businessId, id);

    /// <summary>Takes a row lock (SELECT ... FOR UPDATE) and reports whether the row exists. Table name is a fixed literal.</summary>
    internal static async Task<bool> LockRowAsync(IDbConnection conn, IDbTransaction tx, string table, Guid businessId, Guid id) =>
        await conn.QueryFirstOrDefaultAsync<Guid?>($"SELECT id FROM {table} WHERE business_id = @BusinessId AND id = @Id FOR UPDATE",
            new { BusinessId = businessId, Id = id }, tx) is not null;

    public static async Task<IReadOnlyList<PaymentRow>> PaymentsAsync(IDbConnection conn, Guid businessId, Guid receivableId, IDbTransaction? tx = null) =>
        (await conn.QueryAsync<PaymentRow>(
            """
            SELECT rp.id, rp.transaction_id, rp.amount_cents, rp.payment_date, t.payment_method, t.reference, (t.status = 'voided') AS is_voided
            FROM receivable_payments rp JOIN transactions t ON t.id = rp.transaction_id
            WHERE rp.business_id = @BusinessId AND rp.receivable_id = @Id
            ORDER BY rp.payment_date, rp.created_at
            """, new { BusinessId = businessId, Id = receivableId }, tx)).ToList();

    /// <summary>Records a debt. When the charge terms were shown to the customer and the policy is active, the terms are
    /// copied onto the debt so later policy changes never alter what was agreed.</summary>
    public static Task<Guid> InsertAsync(IDbConnection conn, Guid businessId, ReceivableInput i, Services.Barbershop.PolicyRow? disclosedPolicy = null) =>
        conn.QuerySingleAsync<Guid>(
            """
            INSERT INTO receivables (business_id, customer_id, description, original_amount_cents, issue_date, due_date, notes, reference,
                charge_terms_disclosed_at, charge_terms_snapshot, charge_policy_version, charge_amount_cents, charge_overdue_days)
            VALUES (@BusinessId, @CustomerId, @Description, @OriginalAmountCents, @IssueDate, @DueDate, @Notes, @Reference,
                @DiscAt, @Terms, @Ver, @Amt, @Days)
            RETURNING id
            """,
            new
            {
                BusinessId = businessId, i.CustomerId, Description = i.Description!.Trim(), i.OriginalAmountCents, i.IssueDate,
                i.DueDate, Notes = string.IsNullOrWhiteSpace(i.Notes) ? null : i.Notes.Trim(),
                Reference = string.IsNullOrWhiteSpace(i.Reference) ? null : i.Reference.Trim(),
                DiscAt = disclosedPolicy is null ? (DateTime?)null : DateTime.UtcNow, Terms = disclosedPolicy?.DebtChargeTerms,
                Ver = disclosedPolicy?.DebtChargePolicyVersion, Amt = disclosedPolicy?.DebtChargeCents, Days = disclosedPolicy?.DebtChargeOverdueDays
            });

    public static Task InsertPaymentAsync(IDbConnection conn, IDbTransaction tx, Guid businessId, Guid receivableId, Guid transactionId, long amountCents, DateOnly date) =>
        conn.ExecuteAsync(
            "INSERT INTO receivable_payments (business_id, receivable_id, transaction_id, amount_cents, payment_date) VALUES (@BusinessId, @ReceivableId, @TransactionId, @AmountCents, @Date)",
            new { BusinessId = businessId, ReceivableId = receivableId, TransactionId = transactionId, AmountCents = amountCents, Date = date }, tx);

    public static Task SetStatusAsync(IDbConnection conn, IDbTransaction tx, Guid businessId, Guid id, string status) =>
        conn.ExecuteAsync("UPDATE receivables SET status = @Status, updated_at = now() WHERE business_id = @BusinessId AND id = @Id",
            new { BusinessId = businessId, Id = id, Status = status }, tx);

    public static Task WriteOffAsync(IDbConnection conn, IDbTransaction tx, Guid businessId, Guid id, long amountCents, string reason) =>
        conn.ExecuteAsync(
            "UPDATE receivables SET status = 'written_off', written_off_cents = @Amount, write_off_reason = @Reason, updated_at = now() WHERE business_id = @BusinessId AND id = @Id AND status = 'open'",
            new { BusinessId = businessId, Id = id, Amount = amountCents, Reason = reason }, tx);

    public static Task<Guid?> ReceivableForTransactionAsync(IDbConnection conn, IDbTransaction tx, Guid businessId, Guid transactionId) =>
        conn.QueryFirstOrDefaultAsync<Guid?>("SELECT receivable_id FROM receivable_payments WHERE business_id = @BusinessId AND transaction_id = @TransactionId",
            new { BusinessId = businessId, TransactionId = transactionId }, tx);

    /// <summary>Open receivables with remaining balances, for forecasting and rules.</summary>
    public static async Task<IReadOnlyList<OpenReceivable>> OpenAsync(IDbConnection conn, Guid businessId)
    {
        var rows = await conn.QueryAsync<ReceivableRow>(BaseSql + " AND r.status = 'open'", new { BusinessId = businessId });
        // Expected collections use the principal only; charges are never assumed to be collected.
        return rows.Select(r => new OpenReceivable(r.Id, r.CustomerId, r.CustomerName, r.Description,
                Math.Max(0, r.OriginalAmountCents - r.PaidCents - r.WrittenOffCents), r.IssueDate, r.DueDate))
            .Where(r => r.RemainingCents > 0)
            .ToList();
    }
}

public static class PayableRepository
{
    private const string BaseSql = """
        WITH paid AS (
            SELECT pp.payable_id, SUM(pp.amount_cents)::bigint AS paid
            FROM payable_payments pp JOIN transactions t ON t.id = pp.transaction_id AND t.status <> 'voided'
            WHERE pp.business_id = @BusinessId
            GROUP BY pp.payable_id
        )
        SELECT COUNT(*) OVER() AS total_count, b.id, b.supplier_id, s.name AS supplier_name, b.description, b.category,
               b.original_amount_cents, COALESCE(p.paid, 0) AS paid_cents, b.bill_date, b.due_date, b.status,
               b.reference, b.notes, b.created_at
        FROM payables b
        JOIN suppliers s ON s.id = b.supplier_id
        LEFT JOIN paid p ON p.payable_id = b.id
        WHERE b.business_id = @BusinessId
        """;

    public static async Task<(IReadOnlyList<PayableRow>, long)> ListAsync(IDbConnection conn, Guid businessId, DateOnly today,
        string? status, string? filter, Guid? supplierId, int page, int pageSize)
    {
        var rows = (await conn.QueryAsync<PayableRow>(
            BaseSql + """
                 AND (CASE WHEN @Status::text = 'all' THEN TRUE ELSE b.status = COALESCE(@Status::text, 'open') END)
                 AND (@SupplierId::uuid IS NULL OR b.supplier_id = @SupplierId::uuid)
                 AND (CASE @Filter::text
                        WHEN 'overdue' THEN b.status = 'open' AND b.due_date < @Today::date
                        WHEN 'due_soon' THEN b.status = 'open' AND b.due_date BETWEEN @Today::date AND @SoonEnd::date
                        ELSE TRUE END)
                ORDER BY b.due_date, b.id
                LIMIT @Limit OFFSET @Offset
                """,
            new
            {
                BusinessId = businessId, Status = status, SupplierId = supplierId, Filter = filter ?? "all", Today = today,
                SoonEnd = today.AddDays(6), Limit = pageSize, Offset = (page - 1) * pageSize
            })).ToList();
        return (rows, rows.Count > 0 ? rows[0].TotalCount : 0);
    }

    public static Task<PayableRow?> GetAsync(IDbConnection conn, Guid businessId, Guid id, IDbTransaction? tx = null) =>
        conn.QueryFirstOrDefaultAsync<PayableRow>(BaseSql + " AND b.id = @Id", new { BusinessId = businessId, Id = id }, tx);

    public static Task<bool> LockAsync(IDbConnection conn, IDbTransaction tx, Guid businessId, Guid id) =>
        ReceivableRepository.LockRowAsync(conn, tx, "payables", businessId, id);

    public static async Task<IReadOnlyList<PaymentRow>> PaymentsAsync(IDbConnection conn, Guid businessId, Guid payableId, IDbTransaction? tx = null) =>
        (await conn.QueryAsync<PaymentRow>(
            """
            SELECT pp.id, pp.transaction_id, pp.amount_cents, pp.payment_date, t.payment_method, t.reference, (t.status = 'voided') AS is_voided
            FROM payable_payments pp JOIN transactions t ON t.id = pp.transaction_id
            WHERE pp.business_id = @BusinessId AND pp.payable_id = @Id
            ORDER BY pp.payment_date, pp.created_at
            """, new { BusinessId = businessId, Id = payableId }, tx)).ToList();

    public static Task<Guid> InsertAsync(IDbConnection conn, Guid businessId, PayableInput i) =>
        conn.QuerySingleAsync<Guid>(
            """
            INSERT INTO payables (business_id, supplier_id, description, category, original_amount_cents, bill_date, due_date, reference, notes)
            VALUES (@BusinessId, @SupplierId, @Description, @Category, @OriginalAmountCents, @BillDate, @DueDate, @Reference, @Notes)
            RETURNING id
            """,
            new
            {
                BusinessId = businessId, i.SupplierId, Description = i.Description!.Trim(), i.Category, i.OriginalAmountCents,
                i.BillDate, i.DueDate, Reference = string.IsNullOrWhiteSpace(i.Reference) ? null : i.Reference.Trim(),
                Notes = string.IsNullOrWhiteSpace(i.Notes) ? null : i.Notes.Trim()
            });

    public static Task InsertPaymentAsync(IDbConnection conn, IDbTransaction tx, Guid businessId, Guid payableId, Guid transactionId, long amountCents, DateOnly date) =>
        conn.ExecuteAsync(
            "INSERT INTO payable_payments (business_id, payable_id, transaction_id, amount_cents, payment_date) VALUES (@BusinessId, @PayableId, @TransactionId, @AmountCents, @Date)",
            new { BusinessId = businessId, PayableId = payableId, TransactionId = transactionId, AmountCents = amountCents, Date = date }, tx);

    public static Task SetStatusAsync(IDbConnection conn, IDbTransaction tx, Guid businessId, Guid id, string status, string? cancelReason = null) =>
        conn.ExecuteAsync(
            "UPDATE payables SET status = @Status, cancel_reason = COALESCE(@CancelReason, cancel_reason), updated_at = now() WHERE business_id = @BusinessId AND id = @Id",
            new { BusinessId = businessId, Id = id, Status = status, CancelReason = cancelReason }, tx);

    public static Task<Guid?> PayableForTransactionAsync(IDbConnection conn, IDbTransaction tx, Guid businessId, Guid transactionId) =>
        conn.QueryFirstOrDefaultAsync<Guid?>("SELECT payable_id FROM payable_payments WHERE business_id = @BusinessId AND transaction_id = @TransactionId",
            new { BusinessId = businessId, TransactionId = transactionId }, tx);

    public static async Task<IReadOnlyList<OpenPayable>> OpenAsync(IDbConnection conn, Guid businessId)
    {
        var rows = await conn.QueryAsync<PayableRow>(BaseSql + " AND b.status = 'open'", new { BusinessId = businessId });
        return rows.Select(r => new OpenPayable(r.Id, r.SupplierId, r.SupplierName, r.Description,
                Math.Max(0, r.OriginalAmountCents - r.PaidCents), r.DueDate))
            .Where(p => p.RemainingCents > 0)
            .ToList();
    }
}
