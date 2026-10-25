using System.Data;
using System.Text.Json;
using Dapper;
using KasiFlow.Api.Data;
using KasiFlow.Api.DTOs;
using KasiFlow.Api.Middleware;
using KasiFlow.Api.Repositories;
using KasiFlow.Core.Access;
using KasiFlow.Core.Integrations;
using KasiFlow.Core.Validation;

namespace KasiFlow.Api.Services.Integrations;

/// <summary>Reconciliation Centre: compares provider payments with the ledger. Every manual decision is audited and
/// reversible; amounts are never changed to force a match.</summary>
public sealed class ReconciliationService(IDbConnectionFactory db, IBusinessContext business, PaymentIngestionService ingestion)
{
    private sealed class SummaryRow
    {
        public int NeedsReview { get; set; }
        public int Unmatched { get; set; }
        public int AutoMatched { get; set; }
        public int Matched { get; set; }
        public int CreatedSales { get; set; }
        public int Ignored { get; set; }
        public long PendingCents { get; set; }
        public int PendingCount { get; set; }
        public long UnsettledCents { get; set; }
        public int SettlementsCount { get; set; }
    }

    public async Task<ReconciliationSummaryDto> SummaryAsync(CancellationToken ct)
    {
        var access = await business.RequireAsync(Permission.ManageReconciliation, Permission.ViewIntegrations);
        await using var conn = await db.OpenAsync(ct);
        var s = await conn.QuerySingleAsync<SummaryRow>(
            """
            SELECT
              COUNT(*) FILTER (WHERE reconciliation_status = 'needs_review')::int AS needs_review,
              COUNT(*) FILTER (WHERE reconciliation_status = 'unmatched' AND status = 'completed' AND kind = 'payment')::int AS unmatched,
              COUNT(*) FILTER (WHERE reconciliation_status = 'auto_matched')::int AS auto_matched,
              COUNT(*) FILTER (WHERE reconciliation_status = 'matched')::int AS matched,
              COUNT(*) FILTER (WHERE reconciliation_status = 'created_sale')::int AS created_sales,
              COUNT(*) FILTER (WHERE reconciliation_status = 'ignored')::int AS ignored,
              COALESCE(SUM(gross_cents) FILTER (WHERE status = 'pending' AND kind = 'payment'), 0)::bigint AS pending_cents,
              COUNT(*) FILTER (WHERE status = 'pending' AND kind = 'payment')::int AS pending_count,
              COALESCE(SUM(gross_cents) FILTER (WHERE status = 'completed' AND kind = 'payment' AND settlement_id IS NULL), 0)::bigint AS unsettled_cents,
              (SELECT COUNT(*) FROM settlements WHERE business_id = @B)::int AS settlements_count
            FROM provider_payments WHERE business_id = @B
            """, new { B = access.BusinessId });
        return new ReconciliationSummaryDto(s.NeedsReview, s.Unmatched, s.AutoMatched, s.Matched, s.CreatedSales, s.Ignored,
            s.PendingCents, s.PendingCount, s.UnsettledCents, s.SettlementsCount);
    }

    private sealed class SuggestionRow
    {
        public Guid Id { get; set; }
        public Guid TransactionId { get; set; }
        public string Description { get; set; } = "";
        public long AmountCents { get; set; }
        public DateOnly TransactionDate { get; set; }
        public string? Reference { get; set; }
        public string Method { get; set; } = "";
        public decimal Confidence { get; set; }
        public string Reason { get; set; } = "";
        public string Status { get; set; } = "";
    }

    /// <summary>Payments that need a decision, each with stored suggestions plus any newly recorded candidates.</summary>
    public async Task<IReadOnlyList<ReconciliationItemDto>> QueueAsync(string? status, CancellationToken ct)
    {
        var access = await business.RequireAsync(Permission.ManageReconciliation, Permission.ViewIntegrations);
        var recon = status switch
        {
            null or "" or "needs_review" => "needs_review",
            "matched" or "auto_matched" or "created_sale" or "ignored" or "unmatched" => status,
            _ => throw new RequestValidationException(new ValidationErrors().Add("status", "Unknown status."))
        };
        await using var conn = await db.OpenAsync(ct);
        var (rows, _) = await IntegrationRepository.ListPaymentsAsync(conn, access.BusinessId, recon, null, null, null, null, 1, 100);
        var items = new List<ReconciliationItemDto>();
        foreach (var p in rows) items.Add(new ReconciliationItemDto(IntegrationService.ToDto(p), await SuggestionsAsync(conn, access.BusinessId, p)));
        return items;
    }

    private static async Task<IReadOnlyList<MatchSuggestionDto>> SuggestionsAsync(IDbConnection conn, Guid businessId, ProviderPaymentRow p)
    {
        var stored = (await conn.QueryAsync<SuggestionRow>(
            """
            SELECT m.id, m.transaction_id, t.description, t.amount_cents, t.transaction_date, t.reference, m.method, m.confidence, m.reason, m.status
            FROM reconciliation_matches m JOIN transactions t ON t.id = m.transaction_id
            WHERE m.business_id = @B AND m.provider_payment_id = @P AND m.status IN ('suggested','accepted')
            ORDER BY m.confidence DESC, m.created_at
            """, new { B = businessId, P = p.Id })).ToList();
        var result = stored.Select(s => new MatchSuggestionDto(s.Id, s.TransactionId, s.Description, s.AmountCents, s.TransactionDate, s.Reference,
            s.Method, s.Confidence, s.Reason, s.Status)).ToList();
        if (p.ReconciliationStatus is not ("needs_review" or "unmatched")) return result;

        // Sales recorded after the payment arrived can also be matched.
        using var tx = conn.BeginTransaction();
        var date = DateOnly.FromDateTime(DateTime.SpecifyKind(p.OccurredAt, DateTimeKind.Utc).AddHours(2));
        var candidates = await PaymentIngestionService.CandidatesAsync(conn, tx, businessId, p.GrossCents, date, p.MerchantReference);
        tx.Commit();
        var decision = ReconciliationPolicy.Decide(p.GrossCents, date, p.MerchantReference,
            candidates.Select(c => new LedgerCandidate(c.Id, c.AmountCents, c.TransactionDate, c.Reference, c.PaymentMethod, false)).ToList());
        foreach (var s in decision.Suggestions.Where(s => result.All(r => r.TransactionId != s.TransactionId)))
        {
            var c = candidates.First(x => x.Id == s.TransactionId);
            var desc = await conn.ExecuteScalarAsync<string>("SELECT description FROM transactions WHERE id = @Id AND business_id = @B", new { Id = c.Id, B = businessId }) ?? "";
            result.Add(new MatchSuggestionDto(Guid.Empty, c.Id, desc, c.AmountCents, c.TransactionDate, c.Reference, "amount_date", s.Confidence, s.Reason, "suggested"));
        }
        return result;
    }

    public async Task<ReconciliationItemDto> MatchAsync(Guid paymentId, MatchInput input, CancellationToken ct)
    {
        var access = await business.RequireAsync(Permission.ManageReconciliation);
        if (input.TransactionId is not { } transactionId) throw new RequestValidationException(new ValidationErrors().Add("transactionId", "Choose the recorded sale."));
        await using var conn = await db.OpenAsync(ct);
        using var tx = conn.BeginTransaction();
        var (p, c) = await LoadForDecisionAsync(conn, tx, access.BusinessId, paymentId);
        if (p.ReconciliationStatus is not ("needs_review" or "unmatched")) throw new ConflictException("This payment is already reconciled. Unmatch it first.");
        var t = await conn.QueryFirstOrDefaultAsync<(long Amount, string Type, string Status, string Origin, Guid? Linked)>(
            "SELECT amount_cents, type, status, origin, provider_payment_id FROM transactions WHERE id = @T AND business_id = @B FOR UPDATE",
            new { T = transactionId, B = access.BusinessId }, tx);
        if (t == default) throw new NotFoundException("Recorded sale not found.");
        if (t.Type != "income" || t.Status != "posted" || t.Origin != RecordOrigins.StaffRecorded)
            throw new ConflictException("Only a posted, staff-recorded sale can be matched to a provider payment.");
        if (t.Linked is not null) throw new ConflictException("That sale is already matched to another payment.");
        if (t.Amount != p.GrossCents)
            throw new ConflictException("The amounts differ. The provider's confirmed amount is never changed; correct the recorded sale first if it was captured wrongly, or create a new sale from the payment.");

        await PaymentIngestionService.LinkTransactionAsync(conn, tx, access.BusinessId, p.Id, transactionId);
        await conn.ExecuteAsync("UPDATE reconciliation_matches SET status = 'rejected', decided_by = @U, decided_at = now() WHERE provider_payment_id = @P AND status = 'suggested' AND transaction_id <> @T",
            new { P = p.Id, T = transactionId, U = access.UserId }, tx);
        await conn.ExecuteAsync("DELETE FROM reconciliation_matches WHERE provider_payment_id = @P AND status = 'suggested' AND transaction_id = @T", new { P = p.Id, T = transactionId }, tx);
        await PaymentIngestionService.InsertMatchAsync(conn, tx, access.BusinessId, p.Id, transactionId, "manual", 1.0m,
            string.IsNullOrWhiteSpace(input.Note) ? "Confirmed by a person." : input.Note.Trim()[..Math.Min(300, input.Note.Trim().Length)], "accepted", access.UserId);
        await IntegrationRepository.SetReconciliationAsync(conn, tx, p.Id, "matched", transactionId);
        await PaymentIngestionService.ApplyLineItemsAsync(conn, tx, c, p, transactionId);
        await AuditRepository.WriteAsync(conn, tx, access.BusinessId, access.UserId, "reconciliation_matched", "provider_payment", p.Id,
            JsonSerializer.Serialize(new { transactionId }));
        await JobQueue.EnqueueGrowthRefreshAsync(conn, tx, access.BusinessId);
        tx.Commit();
        return await ItemAsync(conn, access.BusinessId, p.Id);
    }

    public async Task<ReconciliationItemDto> CreateSaleAsync(Guid paymentId, ReconcileActionInput input, CancellationToken ct)
    {
        var access = await business.RequireAsync(Permission.ManageReconciliation);
        await using var conn = await db.OpenAsync(ct);
        using var tx = conn.BeginTransaction();
        var (p, c) = await LoadForDecisionAsync(conn, tx, access.BusinessId, paymentId);
        if (p.ReconciliationStatus is not ("needs_review" or "unmatched")) throw new ConflictException("This payment is already reconciled.");
        var txId = await ingestion.CreateSaleAsync(conn, tx, c, p, null, access.UserId);
        await conn.ExecuteAsync("UPDATE reconciliation_matches SET status = 'rejected', decided_by = @U, decided_at = now() WHERE provider_payment_id = @P AND status = 'suggested'",
            new { P = p.Id, U = access.UserId }, tx);
        await PaymentIngestionService.InsertMatchAsync(conn, tx, access.BusinessId, p.Id, txId, "created_from_payment", 1.0m,
            "A person confirmed this payment is a separate sale.", "accepted", access.UserId);
        await IntegrationRepository.SetReconciliationAsync(conn, tx, p.Id, "created_sale", txId);
        await AuditRepository.WriteAsync(conn, tx, access.BusinessId, access.UserId, "reconciliation_created_sale", "provider_payment", p.Id);
        await JobQueue.EnqueueGrowthRefreshAsync(conn, tx, access.BusinessId);
        tx.Commit();
        return await ItemAsync(conn, access.BusinessId, p.Id);
    }

    public async Task<ReconciliationItemDto> IgnoreAsync(Guid paymentId, ReconcileActionInput input, CancellationToken ct)
    {
        var access = await business.RequireAsync(Permission.ManageReconciliation);
        var note = input.Note?.Trim();
        if (string.IsNullOrEmpty(note) || note.Length > 300)
            throw new RequestValidationException(new ValidationErrors().Add("note", "Say why this payment is not a sale (300 characters or fewer)."));
        await using var conn = await db.OpenAsync(ct);
        using var tx = conn.BeginTransaction();
        var (p, _) = await LoadForDecisionAsync(conn, tx, access.BusinessId, paymentId);
        if (p.ReconciliationStatus is not ("needs_review" or "unmatched")) throw new ConflictException("This payment is already reconciled.");
        await conn.ExecuteAsync("UPDATE reconciliation_matches SET status = 'rejected', decided_by = @U, decided_at = now(), note = @N WHERE provider_payment_id = @P AND status = 'suggested'",
            new { P = p.Id, U = access.UserId, N = note }, tx);
        await IntegrationRepository.SetReconciliationAsync(conn, tx, p.Id, "ignored", null, setTransaction: false);
        await AuditRepository.WriteAsync(conn, tx, access.BusinessId, access.UserId, "reconciliation_ignored", "provider_payment", p.Id);
        tx.Commit();
        return await ItemAsync(conn, access.BusinessId, p.Id);
    }

    /// <summary>Reverses a match decision. A matched staff sale goes back to "recorded manually"; a sale created from
    /// the payment is voided (kept for the audit trail). The payment returns to the review queue.</summary>
    public async Task<ReconciliationItemDto> UnmatchAsync(Guid paymentId, ReconcileActionInput input, CancellationToken ct)
    {
        var access = await business.RequireAsync(Permission.ManageReconciliation);
        var note = string.IsNullOrWhiteSpace(input.Note) ? "Unmatched by a person." : input.Note.Trim()[..Math.Min(300, input.Note.Trim().Length)];
        await using var conn = await db.OpenAsync(ct);
        using var tx = conn.BeginTransaction();
        var (p, _) = await LoadForDecisionAsync(conn, tx, access.BusinessId, paymentId);
        if (p.ReconciliationStatus is not ("matched" or "auto_matched" or "created_sale" or "ignored"))
            throw new ConflictException("Only a reconciled payment can be unmatched.");
        if (p.TransactionId is { } txId)
        {
            if (p.ReconciliationStatus == "created_sale")
                await conn.ExecuteAsync("UPDATE transactions SET status = 'voided', void_reason = @R, voided_at = now(), updated_at = now() WHERE id = @T AND business_id = @B AND status <> 'voided'",
                    new { T = txId, B = access.BusinessId, R = "Unmatched in reconciliation: " + note }, tx);
            else
                await conn.ExecuteAsync("UPDATE transactions SET provider_payment_id = NULL, payment_status = 'recorded_manually', updated_at = now() WHERE id = @T AND business_id = @B",
                    new { T = txId, B = access.BusinessId }, tx);
        }
        // Product lines taken by this payment go back to stock; matching again takes them again (new generation of keys).
        await PaymentIngestionService.RestockLineItemsAsync(conn, tx, access.BusinessId, p, "Unmatched in reconciliation");
        await conn.ExecuteAsync("UPDATE reconciliation_matches SET status = 'unmatched', note = @N, decided_by = @U, decided_at = now() WHERE provider_payment_id = @P AND status = 'accepted'",
            new { P = p.Id, N = note, U = access.UserId }, tx);
        await IntegrationRepository.SetReconciliationAsync(conn, tx, p.Id, "needs_review", null);
        await AuditRepository.WriteAsync(conn, tx, access.BusinessId, access.UserId, "reconciliation_unmatched", "provider_payment", p.Id,
            JsonSerializer.Serialize(new { previous = p.ReconciliationStatus }));
        await JobQueue.EnqueueGrowthRefreshAsync(conn, tx, access.BusinessId);
        tx.Commit();
        return await ItemAsync(conn, access.BusinessId, p.Id);
    }

    private static async Task<(ProviderPaymentRow Payment, ConnectionRow Connection)> LoadForDecisionAsync(IDbConnection conn, IDbTransaction tx, Guid businessId, Guid paymentId)
    {
        var p = await IntegrationRepository.GetPaymentAsync(conn, businessId, paymentId, tx, forUpdate: true) ?? throw new NotFoundException();
        if (p.Kind != PaymentKinds.Payment || p.Status != ProviderPaymentStatuses.Completed)
            throw new ConflictException("Only completed payments can be reconciled. Pending payments are not income yet.");
        var c = await IntegrationRepository.GetAsync(conn, businessId, p.ConnectionId, tx) ?? throw new NotFoundException();
        return (p, c);
    }

    private static async Task<ReconciliationItemDto> ItemAsync(IDbConnection conn, Guid businessId, Guid paymentId)
    {
        var p = await IntegrationRepository.GetPaymentAsync(conn, businessId, paymentId) ?? throw new NotFoundException();
        return new ReconciliationItemDto(IntegrationService.ToDto(p), await SuggestionsAsync(conn, businessId, p));
    }
}
