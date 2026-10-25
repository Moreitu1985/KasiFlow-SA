using System.Data;
using System.Security.Cryptography;
using System.Text.Json;
using Dapper;
using KasiFlow.Api.Data;
using KasiFlow.Api.Repositories;
using KasiFlow.Core.Access;
using KasiFlow.Core.Common;
using KasiFlow.Core.Domain;
using KasiFlow.Core.Integrations;

namespace KasiFlow.Api.Services.Integrations;

public sealed record WebhookOutcome(int StatusCode, string Outcome, string Message, IReadOnlyList<Guid> EventIds);

/// <summary>
/// Ingestion pipeline shared by webhooks, scheduled sync and the sandbox simulator:
/// verify → normalise → persist event idempotently (unique per connection + external event id) → enqueue processing.
/// Processing (a durable background job) maps the event into payments, the ledger, reconciliation, stock and settlements.
/// </summary>
public sealed class PaymentIngestionService(IDbConnectionFactory db, PaymentProviderRegistry registry, IClock clock,
    ILogger<PaymentIngestionService> logger)
{
    internal static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    public const int MaxWebhookBytes = 64 * 1024;

    // ------------------------------------------------------------------ ingestion

    public async Task<WebhookOutcome> IngestWebhookAsync(string providerKey, Guid connectionId, byte[] body, IHeaderDictionary headers, CancellationToken ct)
    {
        var sha = Convert.ToHexString(SHA256.HashData(body)).ToLowerInvariant();
        await using var conn = await db.OpenAsync(ct);
        var c = await IntegrationRepository.GetForWebhookAsync(conn, connectionId);
        var adapter = registry.Get(providerKey);
        if (c is null || adapter is null || c.ProviderKey != providerKey || c.Status == "disconnected")
        {
            // Not stored: anyone can call this URL, so unknown targets are only logged (keeps the table from being flooded).
            logger.LogInformation("Webhook for unknown or disconnected {Provider} connection {ConnectionId} ignored.", providerKey, connectionId);
            return new WebhookOutcome(404, "rejected", "Unknown connection.", []);
        }
        if (body.Length > MaxWebhookBytes)
        {
            await IntegrationRepository.RecordDeliveryAsync(conn, null, providerKey, c.Id, c.BusinessId, false, "rejected", 413, sha, "Payload too large.", null);
            return new WebhookOutcome(413, "rejected", "Payload too large.", []);
        }

        var parsed = adapter.ParseWebhook(c, body, headers);
        if (!parsed.SignatureValid)
        {
            await IntegrationRepository.RecordDeliveryAsync(conn, null, providerKey, c.Id, c.BusinessId, false, "rejected", 401, sha, parsed.Error, null);
            logger.LogWarning("Rejected {Provider} webhook for connection {ConnectionId}: {Reason}", providerKey, c.Id, parsed.Error);
            return new WebhookOutcome(401, "rejected", "Signature verification failed.", []);
        }
        if (parsed.Events.Count == 0)
        {
            await IntegrationRepository.RecordDeliveryAsync(conn, null, providerKey, c.Id, c.BusinessId, true, "rejected", 400, sha, parsed.Error, null);
            return new WebhookOutcome(400, "rejected", parsed.Error ?? "No events in payload.", []);
        }

        var (ids, duplicates) = await PersistEventsAsync(conn, c, parsed.Events, parsed.Verification, "webhook");
        var outcome = duplicates == parsed.Events.Count ? "duplicate" : "accepted";
        await IntegrationRepository.RecordDeliveryAsync(conn, null, providerKey, c.Id, c.BusinessId, true, outcome, 200, sha,
            duplicates > 0 ? $"{duplicates} duplicate event(s) ignored." : null, ids.FirstOrDefault());
        // Providers retry until they receive 200, so duplicates are acknowledged too (and ignored).
        return new WebhookOutcome(200, outcome, outcome == "duplicate" ? "Already received; ignored." : "Accepted.", ids);
    }

    /// <summary>Stores events idempotently and enqueues one processing job per new event, atomically.</summary>
    public async Task<(IReadOnlyList<Guid> Ids, int Duplicates)> PersistEventsAsync(IDbConnection conn, ConnectionRow c,
        IReadOnlyList<NormalizedEvent> events, string verification, string via)
    {
        var ids = new List<Guid>();
        var dups = 0;
        using var tx = conn.BeginTransaction();
        foreach (var e in events)
        {
            var payload = JsonSerializer.Serialize(Sanitise(e), Json);
            var r = await IntegrationRepository.InsertEventAsync(conn, tx, c, e.ExternalEventId, e.EventType, verification, via, payload);
            ids.Add(r.Id);
            if (r.Inserted)
                await JobQueue.EnqueueAsync(conn, tx, JobTypes.ProcessProviderEvent, c.BusinessId, $"event:{r.Id}", new { eventId = r.Id });
            else dups++;
        }
        tx.Commit();
        return (ids, dups);
    }

    /// <summary>Keep only the normalised fields we need. No card numbers or personal data are stored.</summary>
    private static NormalizedEvent Sanitise(NormalizedEvent e) =>
        e with { UserReference = e.UserReference is { Length: > 60 } u ? u[..60] : e.UserReference };

    // ------------------------------------------------------------------ processing (background job)

    public async Task ProcessEventAsync(Guid eventId, CancellationToken ct)
    {
        await using var conn = await db.OpenAsync(ct);
        var snapshot = await conn.QueryFirstOrDefaultAsync<ProviderEventRow>(
            "SELECT id, connection_id, provider_key, verification, event_type, payload::text AS payload, processing_status FROM provider_events WHERE id = @Id", new { Id = eventId });
        if (snapshot is null || snapshot.ProcessingStatus is "processed" or "rejected") return;
        var c = await IntegrationRepository.GetForWebhookAsync(conn, snapshot.ConnectionId) ?? throw new InvalidOperationException("Connection missing.");
        var e = JsonSerializer.Deserialize<NormalizedEvent>(snapshot.Payload, Json) ?? throw new InvalidOperationException("Empty event payload.");
        var adapter = registry.Get(c.ProviderKey);

        // Providers whose webhooks are not authoritative: confirm the payment through the authenticated API first.
        var verification = snapshot.Verification;
        if (adapter is { ConfirmsWebhooksViaApi: true } && snapshot.Verification == VerificationMethods.SignatureVerified
            && e.EventType == EventTypes.Payment && e.ExternalPaymentId is not null)
        {
            var confirmed = await adapter.ConfirmPaymentAsync(c, e.ExternalPaymentId, ct);
            if (confirmed is null)
            {
                await IntegrationRepository.MarkEventAsync(conn, null, eventId, "rejected", "The provider's API does not know this payment, so the webhook was not trusted.", null);
                return;
            }
            e = confirmed with { ExternalEventId = e.ExternalEventId };
            verification = VerificationMethods.ApiConfirmed;
            await conn.ExecuteAsync("UPDATE provider_events SET verification = 'api_confirmed' WHERE id = @Id", new { Id = eventId });
        }

        if (e.EventType == EventTypes.Payment && (e.GrossCents <= 0 || e.TipCents < 0 || e.GrossCents > 100_000_000_00L))
        {
            await IntegrationRepository.MarkEventAsync(conn, null, eventId, "rejected", "The payment amount is missing, zero or invalid, so it was not recorded.", null);
            return;
        }
        if (e.EventType == EventTypes.Settlement && e.FeeCents is < 0)
        {
            await IntegrationRepository.MarkEventAsync(conn, null, eventId, "rejected", "The settlement fee is negative, so it was not recorded.", null);
            return;
        }

        using var tx = conn.BeginTransaction();
        var ev = await IntegrationRepository.GetEventForUpdateAsync(conn, tx, eventId);
        if (ev is null || ev.ProcessingStatus is "processed" or "rejected") { tx.Rollback(); return; }

        Guid? paymentId = null;
        string? note = null;
        if (e.EventType == EventTypes.Payment) (paymentId, note) = await ProcessPaymentAsync(conn, tx, c, e);
        else if (e.EventType == EventTypes.Settlement) note = await ProcessSettlementAsync(conn, tx, c, e);
        else note = $"Unsupported event type '{e.EventType}'.";

        await IntegrationRepository.MarkEventAsync(conn, tx, eventId, "processed", note, paymentId);
        await JobQueue.EnqueueGrowthRefreshAsync(conn, tx, c.BusinessId);
        tx.Commit();
        logger.LogInformation("Processed {Provider} event {EventId} ({Verification})", c.ProviderKey, eventId, verification);
    }

    /// <summary>Ledger references are limited to 80 characters; provider references can be longer.</summary>
    internal static string Ref(string s) => s.Length <= 80 ? s : s[..80];

    private static string OriginFor(ConnectionRow c, NormalizedEvent e) =>
        c.Environment == IntegrationEnvironments.Sandbox ? RecordOrigins.DemoSimulation
        : e.LineItems is { Count: > 0 } ? RecordOrigins.ConnectedPos
        : RecordOrigins.VerifiedProvider;

    private DateOnly SaDate(DateTime utc) => DateOnly.FromDateTime(DateTime.SpecifyKind(utc, DateTimeKind.Utc).AddHours(2));

    private async Task<(Guid? PaymentId, string? Note)> ProcessPaymentAsync(IDbConnection conn, IDbTransaction tx, ConnectionRow c, NormalizedEvent e)
    {
        if (e.ExternalPaymentId is null || e.Status is null) return (null, "Payment event without id or status ignored.");
        var existing = await IntegrationRepository.GetPaymentForUpdateAsync(conn, tx, c.Id, e.ExternalPaymentId);
        var transition = PaymentStateMachine.Apply(existing?.Status, e.Status);
        var occurred = (e.OccurredAt ?? clock.UtcNow).UtcDateTime;
        Guid paymentId;

        if (transition == TransitionResult.Created)
        {
            Guid? refundOf = null;
            if (e.RefundOfExternalPaymentId is not null)
                refundOf = await conn.QueryFirstOrDefaultAsync<Guid?>("SELECT id FROM provider_payments WHERE connection_id = @C AND external_payment_id = @Ext",
                    new { C = c.Id, Ext = e.RefundOfExternalPaymentId }, tx);
            var branchId = await ResolveBranchAsync(conn, tx, c, e.BranchHint);
            var lines = e.LineItems is { Count: > 0 } ? JsonSerializer.Serialize(e.LineItems, Json) : null;
            paymentId = await IntegrationRepository.InsertPaymentAsync(conn, tx, c, e, occurred, refundOf, branchId, lines);
        }
        else
        {
            paymentId = existing!.Id;
            if (transition == TransitionResult.NoChange)
            {
                if (e.StatementReference is not null && existing.StatementReference is null && existing.Status == ProviderPaymentStatuses.Completed)
                {
                    await IntegrationRepository.UpdatePaymentStatusAsync(conn, tx, paymentId, existing.Status, e.StatementReference);
                    await LinkStatementSettlementAsync(conn, tx, c, paymentId, e.StatementReference);
                }
                return (paymentId, $"No status change ({existing.Status}).");
            }
            await IntegrationRepository.UpdatePaymentStatusAsync(conn, tx, paymentId, e.Status, e.StatementReference);
        }

        var payment = (await IntegrationRepository.GetPaymentAsync(conn, c.BusinessId, paymentId, tx))!;
        string? note = null;
        if (payment.Kind == PaymentKinds.Payment)
        {
            switch (payment.Status)
            {
                case ProviderPaymentStatuses.Completed:
                    note = await ReconcileCompletedAsync(conn, tx, c, payment, e);
                    break;
                case ProviderPaymentStatuses.Reversed:
                    note = await ReverseAsync(conn, tx, c, payment, "Reversed by the payment provider.");
                    break;
                case ProviderPaymentStatuses.Failed:
                    await IntegrationRepository.SetReconciliationAsync(conn, tx, paymentId, "not_applicable", null, false);
                    note = "Payment failed: nothing counted as income.";
                    break;
                default:
                    note = "Pending: not counted as income until the provider confirms it.";
                    break;
            }
        }
        else if (payment.Kind == PaymentKinds.Refund && payment.Status == ProviderPaymentStatuses.Completed && payment.TransactionId is null)
        {
            note = await RecordRefundAsync(conn, tx, c, payment, e);
        }
        else if (payment.Kind == PaymentKinds.Refund && payment.Status == ProviderPaymentStatuses.Reversed && payment.TransactionId is { } refundTx)
        {
            await conn.ExecuteAsync("UPDATE transactions SET status = 'voided', void_reason = 'Refund reversed by the payment provider.', voided_at = now(), updated_at = now() WHERE id = @T AND business_id = @B AND status <> 'voided'",
                new { T = refundTx, B = c.BusinessId }, tx);
            note = "Refund reversed: the refund no longer counts as money out.";
        }

        if (payment.Status == ProviderPaymentStatuses.Completed && e.StatementReference is not null)
            await LinkStatementSettlementAsync(conn, tx, c, paymentId, e.StatementReference);
        return (paymentId, note);
    }

    private static async Task<Guid?> ResolveBranchAsync(IDbConnection conn, IDbTransaction tx, ConnectionRow c, string? hint)
    {
        // A branch is only attached when the source data reliably identifies it: an exact branch name from the
        // provider, or the branch the owner configured for this connection.
        if (!string.IsNullOrWhiteSpace(hint))
        {
            var byName = await conn.QueryFirstOrDefaultAsync<Guid?>("SELECT id FROM branches WHERE business_id = @B AND lower(name) = lower(@N) AND is_active",
                new { B = c.BusinessId, N = hint.Trim() }, tx);
            if (byName is not null) return byName;
        }
        return c.DefaultBranchId;
    }

    public sealed class CandidateRow
    {
        public Guid Id { get; set; }
        public long AmountCents { get; set; }
        public DateOnly TransactionDate { get; set; }
        public string? Reference { get; set; }
        public string PaymentMethod { get; set; } = "";
        public Guid? ProviderPaymentId { get; set; }
    }

    internal static async Task<IReadOnlyList<CandidateRow>> CandidatesAsync(IDbConnection conn, IDbTransaction tx, Guid businessId,
        long gross, DateOnly date, string? reference) =>
        (await conn.QueryAsync<CandidateRow>(
            """
            SELECT id, amount_cents, transaction_date, reference, payment_method, provider_payment_id
            FROM transactions
            WHERE business_id = @B AND type = 'income' AND status = 'posted' AND origin = 'staff_recorded' AND source = 'manual'
              AND provider_payment_id IS NULL
              AND transaction_date BETWEEN @From AND @To
              AND (amount_cents = @Gross OR (@Ref::text IS NOT NULL AND lower(reference) = lower(@Ref)))
            ORDER BY transaction_date, created_at
            LIMIT 20
            """, new { B = businessId, Gross = gross, From = date.AddDays(-ReconciliationPolicy.DateWindowDays), To = date.AddDays(ReconciliationPolicy.DateWindowDays), Ref = reference }, tx)).ToList();

    private async Task<string> ReconcileCompletedAsync(IDbConnection conn, IDbTransaction tx, ConnectionRow c, ProviderPaymentRow p, NormalizedEvent e)
    {
        if (p.TransactionId is not null || p.ReconciliationStatus is "auto_matched" or "matched" or "created_sale" or "ignored")
            return "Already reconciled.";
        var date = SaDate(p.OccurredAt);
        var candidates = await CandidatesAsync(conn, tx, c.BusinessId, p.GrossCents, date, p.MerchantReference);
        var decision = ReconciliationPolicy.Decide(p.GrossCents, date, p.MerchantReference,
            candidates.Select(x => new LedgerCandidate(x.Id, x.AmountCents, x.TransactionDate, x.Reference, x.PaymentMethod, x.ProviderPaymentId is not null)).ToList());

        switch (decision.Kind)
        {
            case MatchDecisionKind.AutoMatchExactReference:
                await LinkTransactionAsync(conn, tx, c.BusinessId, p.Id, decision.TransactionId!.Value);
                await InsertMatchAsync(conn, tx, c.BusinessId, p.Id, decision.TransactionId.Value, "exact_reference", 1.0m, decision.Reason, "accepted", null);
                await IntegrationRepository.SetReconciliationAsync(conn, tx, p.Id, "auto_matched", decision.TransactionId);
                await ApplyLineItemsAsync(conn, tx, c, p, decision.TransactionId.Value);
                return "Matched automatically to the recorded sale with the same reference.";

            case MatchDecisionKind.NeedsReview:
                foreach (var s in decision.Suggestions)
                    await InsertMatchAsync(conn, tx, c.BusinessId, p.Id, s.TransactionId, s.Confidence >= 0.7m ? "exact_reference" : "amount_date", s.Confidence, s.Reason, "suggested", null);
                await IntegrationRepository.SetReconciliationAsync(conn, tx, p.Id, "needs_review", null);
                await NotificationRepository.NotifyAsync(conn, tx, c.BusinessId, Permission.ManageReconciliation, "reconciliation", "informational",
                    "A payment needs your review", $"{Money.FormatZar(p.GrossCents)} from {p.ConnectionName} may match a sale you recorded. Confirm or create a new sale.",
                    "/reconciliation", $"review:{p.Id}");
                return decision.Reason + " Held for review; not counted twice.";

            default:
                var txId = await CreateSaleAsync(conn, tx, c, p, e, userId: null);
                await InsertMatchAsync(conn, tx, c.BusinessId, p.Id, txId, "created_from_payment", 1.0m, "No recorded sale matched; created from the confirmed payment.", "accepted", null);
                await IntegrationRepository.SetReconciliationAsync(conn, tx, p.Id, "created_sale", txId);
                return "Created a sale from the confirmed payment.";
        }
    }

    internal static async Task LinkTransactionAsync(IDbConnection conn, IDbTransaction tx, Guid businessId, Guid paymentId, Guid transactionId) =>
        await conn.ExecuteAsync(
            "UPDATE transactions SET provider_payment_id = @P, payment_status = 'confirmed_external', updated_at = now() WHERE business_id = @B AND id = @T",
            new { B = businessId, P = paymentId, T = transactionId }, tx);

    internal static Task InsertMatchAsync(IDbConnection conn, IDbTransaction tx, Guid businessId, Guid paymentId, Guid transactionId,
        string method, decimal confidence, string reason, string status, Guid? decidedBy) =>
        conn.ExecuteAsync(
            """
            INSERT INTO reconciliation_matches (business_id, provider_payment_id, transaction_id, method, confidence, reason, status, decided_by, decided_at)
            VALUES (@B, @P, @T, @Method, @Confidence, @Reason, @Status, @DecidedBy, CASE WHEN @Status = 'accepted' THEN now() ELSE NULL END)
            """, new { B = businessId, P = paymentId, T = transactionId, Method = method, Confidence = confidence, Reason = reason, Status = status, DecidedBy = decidedBy }, tx);

    internal async Task<Guid> CreateSaleAsync(IDbConnection conn, IDbTransaction tx, ConnectionRow c, ProviderPaymentRow p, NormalizedEvent? e, Guid? userId)
    {
        var origin = e is null ? (c.Environment == IntegrationEnvironments.Sandbox ? RecordOrigins.DemoSimulation : RecordOrigins.VerifiedProvider) : OriginFor(c, e);
        var label = c.Environment == IntegrationEnvironments.Sandbox ? "Sandbox" : c.DisplayName;
        var description = p.LineItems is not null ? $"{label} POS sale" : $"{label} {(p.Method == "card" ? "card" : "QR")} payment";
        var txId = await LedgerRepository.InsertAsync(conn, tx, c.BusinessId, userId ?? Guid.Empty, TransactionTypes.Income, description,
            p.GrossCents, "Sales", SaDate(p.OccurredAt), p.Method == "card" ? PaymentMethods.Card : PaymentMethods.MobilePayment,
            PaymentStatuses.ConfirmedExternal, TransactionStatuses.Posted, TransactionSources.ProviderPayment,
            Ref(p.MerchantReference ?? $"{c.ProviderKey.ToUpperInvariant()}-{p.ExternalPaymentId}"),
            c.Environment == IntegrationEnvironments.Sandbox ? "SANDBOX — simulated, not real money." : null,
            origin, p.BranchId, null, p.Id);
        await ApplyLineItemsAsync(conn, tx, c, p, txId);
        return txId;
    }

    /// <summary>Reduces stock once per sale line. Source keys make retries and replays harmless. The generation number
    /// changes after each unmatch, so a payment that is matched again moves stock again (the earlier lines were returned).</summary>
    internal static async Task ApplyLineItemsAsync(IDbConnection conn, IDbTransaction tx, ConnectionRow c, ProviderPaymentRow p, Guid transactionId)
    {
        if (p.LineItems is null || p.BranchId is null) return;
        // A staff-recorded sale with its own product lines already moved stock; do not take it off twice.
        if (await conn.ExecuteScalarAsync<int>(
                "SELECT COUNT(*) FROM stock_movements WHERE business_id = @B AND transaction_id = @T AND movement_type = 'sold' AND source_key LIKE 'tx:%'",
                new { B = c.BusinessId, T = transactionId }, tx) > 0)
            return;
        var generation = await conn.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM reconciliation_matches WHERE provider_payment_id = @P AND status = 'unmatched'", new { P = p.Id }, tx);
        var lines = JsonSerializer.Deserialize<List<NormalizedLineItem>>(p.LineItems, Json) ?? [];
        for (var i = 0; i < lines.Count; i++)
        {
            var productId = await conn.QueryFirstOrDefaultAsync<Guid?>("SELECT id FROM products WHERE business_id = @B AND sku = @Sku AND kind = 'product'",
                new { B = c.BusinessId, Sku = lines[i].Sku }, tx);
            if (productId is null || lines[i].Quantity <= 0) continue;
            var r = await StockLedger.ApplyAsync(conn, tx, c.BusinessId, productId.Value, p.BranchId.Value, Core.Inventory.MovementTypes.Sold,
                -lines[i].Quantity, $"POS sale {p.ExternalPaymentId}", $"pp:{p.Id}:g{generation}:{i}", null, p.Id, transactionId);
            await StockLedger.NotifyIfLowAsync(conn, tx, c.BusinessId, productId.Value, p.BranchId.Value, r, -lines[i].Quantity);
        }
    }

    private sealed class SoldMovement
    {
        public Guid ProductId { get; set; }
        public Guid BranchId { get; set; }
        public int QuantityDelta { get; set; }
        public string SourceKey { get; set; } = "";
    }

    /// <summary>Returns the stock taken by a payment's product lines. Each sold line can be returned only once
    /// (key suffix ':back'), whether the cause is a reversal, a refund or an unmatch.</summary>
    internal static async Task RestockLineItemsAsync(IDbConnection conn, IDbTransaction tx, Guid businessId, ProviderPaymentRow p, string reason)
    {
        var applied = await conn.QueryAsync<SoldMovement>(
            """
            SELECT sm.product_id, sm.branch_id, sm.quantity_delta, sm.source_key FROM stock_movements sm
            WHERE sm.business_id = @B AND sm.provider_payment_id = @P AND sm.movement_type = 'sold' AND sm.status = 'applied' AND sm.source_key IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM stock_movements b WHERE b.source_key = sm.source_key || ':back')
            """, new { B = businessId, P = p.Id }, tx);
        foreach (var m in applied)
            await StockLedger.ApplyAsync(conn, tx, businessId, m.ProductId, m.BranchId, Core.Inventory.MovementTypes.SaleReversal, -m.QuantityDelta, reason,
                m.SourceKey + ":back", null, p.Id);
    }

    internal async Task<string> ReverseAsync(IDbConnection conn, IDbTransaction tx, ConnectionRow c, ProviderPaymentRow p, string reason)
    {
        if (p.TransactionId is { } txId)
        {
            if (p.ReconciliationStatus == "created_sale")
                await conn.ExecuteAsync("UPDATE transactions SET status = 'voided', void_reason = @R, voided_at = now(), updated_at = now() WHERE id = @T AND business_id = @B AND status <> 'voided'",
                    new { T = txId, B = c.BusinessId, R = reason }, tx);
            else
                await conn.ExecuteAsync("UPDATE transactions SET payment_status = 'cancelled', notes = left(coalesce(notes || ' ', '') || @R, 1000), updated_at = now() WHERE id = @T AND business_id = @B",
                    new { T = txId, B = c.BusinessId, R = reason }, tx);
        }
        // Refunds already recorded for this payment are superseded by the reversal (the whole amount is gone once, not twice).
        var refundsVoided = await conn.ExecuteAsync(
            """
            UPDATE transactions t SET status = 'voided', void_reason = 'Superseded: the original payment was reversed.', voided_at = now(), updated_at = now()
            FROM provider_payments r
            WHERE r.refund_of_payment_id = @P AND r.transaction_id = t.id AND t.business_id = @B AND t.status <> 'voided'
            """, new { P = p.Id, B = c.BusinessId }, tx);
        // A reversed payment no longer needs a reconciliation decision.
        if (p.ReconciliationStatus is "needs_review" or "unmatched")
        {
            await IntegrationRepository.SetReconciliationAsync(conn, tx, p.Id, "not_applicable", null, setTransaction: false);
            await conn.ExecuteAsync("UPDATE reconciliation_matches SET status = 'rejected', decided_at = now(), note = 'Payment reversed by the provider.' WHERE provider_payment_id = @P AND status = 'suggested'",
                new { P = p.Id }, tx);
        }
        await RestockLineItemsAsync(conn, tx, c.BusinessId, p, reason);
        await NotificationRepository.NotifyAsync(conn, tx, c.BusinessId, Permission.ManageReconciliation, "integration", "warning",
            "A payment was reversed", $"{Money.FormatZar(p.GrossCents)} from {p.ConnectionName} was reversed. It no longer counts as income.",
            "/reconciliation", $"reversed:{p.Id}");
        return "Reversal applied: the sale no longer counts as income." + (refundsVoided > 0 ? " Earlier refunds of this payment were superseded." : "");
    }

    private async Task<string> RecordRefundAsync(IDbConnection conn, IDbTransaction tx, ConnectionRow c, ProviderPaymentRow p, NormalizedEvent e)
    {
        var origin = c.Environment == IntegrationEnvironments.Sandbox ? RecordOrigins.DemoSimulation : RecordOrigins.VerifiedProvider;
        var txId = await LedgerRepository.InsertAsync(conn, tx, c.BusinessId, Guid.Empty, TransactionTypes.Expense,
            $"Refund via {(c.Environment == IntegrationEnvironments.Sandbox ? "sandbox" : c.DisplayName)}", p.GrossCents, Categories.Refunds,
            SaDate(p.OccurredAt), p.Method == "card" ? PaymentMethods.Card : PaymentMethods.MobilePayment, PaymentStatuses.ConfirmedExternal,
            TransactionStatuses.Posted, TransactionSources.ProviderRefund, Ref(p.MerchantReference ?? $"REFUND-{p.ExternalPaymentId}"),
            c.Environment == IntegrationEnvironments.Sandbox ? "SANDBOX — simulated, not real money." : null, origin, p.BranchId, null, p.Id);
        await IntegrationRepository.SetReconciliationAsync(conn, tx, p.Id, "not_applicable", txId);
        if (p.RefundOfPaymentId is { } original)
        {
            var orig = await IntegrationRepository.GetPaymentAsync(conn, c.BusinessId, original, tx);
            // Stock comes back once the refunds add up to the full payment (partial refunds keep the stock out).
            var refunded = await conn.ExecuteScalarAsync<long>(
                "SELECT COALESCE(SUM(gross_cents), 0)::bigint FROM provider_payments WHERE refund_of_payment_id = @O AND kind = 'refund' AND status = 'completed'",
                new { O = original }, tx);
            if (orig is not null && refunded >= orig.GrossCents) await RestockLineItemsAsync(conn, tx, c.BusinessId, orig, "Refunded");
        }
        return "Refund recorded as money out (Refunds).";
    }

    private async Task LinkStatementSettlementAsync(IDbConnection conn, IDbTransaction tx, ConnectionRow c, Guid paymentId, string statementReference)
    {
        var settlementId = await conn.QuerySingleAsync<Guid>(
            """
            INSERT INTO settlements (business_id, connection_id, external_settlement_id, settled_on, environment)
            VALUES (@B, @C, @Ref, @Today, @Env)
            ON CONFLICT (connection_id, external_settlement_id) DO UPDATE SET updated_at = now()
            RETURNING id
            """, new { B = c.BusinessId, C = c.Id, Ref = statementReference, Today = clock.Today, Env = c.Environment }, tx);
        await conn.ExecuteAsync("UPDATE provider_payments SET settlement_id = @S WHERE id = @P", new { S = settlementId, P = paymentId }, tx);
        await RecalculateSettlementAsync(conn, tx, settlementId);
    }

    private static Task RecalculateSettlementAsync(IDbConnection conn, IDbTransaction tx, Guid settlementId) =>
        conn.ExecuteAsync(
            """
            UPDATE settlements s SET
                gross_cents = COALESCE((SELECT SUM(CASE WHEN p.kind = 'refund' THEN -p.gross_cents ELSE p.gross_cents END) FROM provider_payments p WHERE p.settlement_id = s.id AND p.status = 'completed'), 0)::bigint,
                payment_count = (SELECT COUNT(*) FROM provider_payments p WHERE p.settlement_id = s.id AND p.status = 'completed'),
                net_cents = CASE WHEN s.fee_cents IS NULL THEN NULL ELSE COALESCE((SELECT SUM(CASE WHEN p.kind = 'refund' THEN -p.gross_cents ELSE p.gross_cents END) FROM provider_payments p WHERE p.settlement_id = s.id AND p.status = 'completed'), 0)::bigint - s.fee_cents END,
                updated_at = now()
            WHERE s.id = @Id
            """, new { Id = settlementId }, tx);

    /// <summary>A settlement moves money the provider already holds into the bank. It never creates revenue;
    /// only the provider's fee (when the provider reports it) is recorded, once, as an expense.</summary>
    private async Task<string> ProcessSettlementAsync(IDbConnection conn, IDbTransaction tx, ConnectionRow c, NormalizedEvent e)
    {
        if (e.ExternalSettlementId is null) return "Settlement without id ignored.";
        var settledOn = e.SettledOn ?? clock.Today;
        var settlementId = await conn.QuerySingleAsync<Guid>(
            """
            INSERT INTO settlements (business_id, connection_id, external_settlement_id, settled_on, fee_cents, environment)
            VALUES (@B, @C, @Ref, @On, @Fee, @Env)
            ON CONFLICT (connection_id, external_settlement_id) DO UPDATE SET fee_cents = COALESCE(EXCLUDED.fee_cents, settlements.fee_cents), settled_on = EXCLUDED.settled_on, updated_at = now()
            RETURNING id
            """, new { B = c.BusinessId, C = c.Id, Ref = e.ExternalSettlementId, On = settledOn, Fee = e.FeeCents, Env = c.Environment }, tx);
        var linked = 0;
        foreach (var ext in e.SettledPaymentIds ?? [])
            linked += await conn.ExecuteAsync(
                "UPDATE provider_payments SET settlement_id = @S, statement_reference = COALESCE(statement_reference, @Ref), updated_at = now() WHERE connection_id = @C AND external_payment_id = @Ext AND status = 'completed'",
                new { S = settlementId, Ref = e.ExternalSettlementId, C = c.Id, Ext = ext }, tx);
        await RecalculateSettlementAsync(conn, tx, settlementId);

        var fee = await conn.QuerySingleAsync<(long? Fee, Guid? FeeTx)>("SELECT fee_cents, fee_transaction_id FROM settlements WHERE id = @Id", new { Id = settlementId }, tx);
        if (fee.Fee is > 0 && fee.FeeTx is null)
        {
            var origin = c.Environment == IntegrationEnvironments.Sandbox ? RecordOrigins.DemoSimulation : RecordOrigins.VerifiedProvider;
            var feeTx = await LedgerRepository.InsertAsync(conn, tx, c.BusinessId, Guid.Empty, TransactionTypes.Expense,
                $"{(c.Environment == IntegrationEnvironments.Sandbox ? "Sandbox" : c.DisplayName)} fees for settlement {e.ExternalSettlementId}", fee.Fee.Value,
                Categories.FeesAndCharges, settledOn, PaymentMethods.Eft, PaymentStatuses.ConfirmedExternal, TransactionStatuses.Posted,
                TransactionSources.ProviderFee, e.ExternalSettlementId, c.Environment == IntegrationEnvironments.Sandbox ? "SANDBOX — simulated, not real money." : null, origin);
            await conn.ExecuteAsync("UPDATE settlements SET fee_transaction_id = @T WHERE id = @Id", new { T = feeTx, Id = settlementId }, tx);
        }
        return $"Settlement recorded for {linked} payment(s). Settlements are not counted as sales.";
    }
}
