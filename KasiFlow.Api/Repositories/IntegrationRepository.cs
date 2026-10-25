using System.Data;
using Dapper;

namespace KasiFlow.Api.Repositories;

public sealed class ConnectionRow
{
    public Guid Id { get; set; }
    public Guid BusinessId { get; set; }
    public string ProviderKey { get; set; } = "";
    public string Environment { get; set; } = "";
    public string Status { get; set; } = "";
    public string DisplayName { get; set; } = "";
    public string? CredentialRef { get; set; }
    public string? MerchantRef { get; set; }
    public Guid? DefaultBranchId { get; set; }
    public DateTime? ConnectedAt { get; set; }
    public DateTime? DisconnectedAt { get; set; }
    public DateTime? LastTestAt { get; set; }
    public bool? LastTestOk { get; set; }
    public DateTime? LastSyncAt { get; set; }
    public DateTime? LastSuccessAt { get; set; }
    public string? LastError { get; set; }
    public string? LastErrorHint { get; set; }
    public DateTime CreatedAt { get; set; }
    public bool BusinessIsDemo { get; set; }
}

public sealed class ProviderEventRow
{
    public Guid Id { get; set; }
    public Guid BusinessId { get; set; }
    public Guid ConnectionId { get; set; }
    public string ProviderKey { get; set; } = "";
    public string Environment { get; set; } = "";
    public string ExternalEventId { get; set; } = "";
    public string EventType { get; set; } = "";
    public string Verification { get; set; } = "";
    public string ReceivedVia { get; set; } = "";
    public string Payload { get; set; } = "{}";
    public DateTime ReceivedAt { get; set; }
    public string ProcessingStatus { get; set; } = "";
    public int Attempts { get; set; }
    public string? LastError { get; set; }
    public DateTime? ProcessedAt { get; set; }
    public Guid? ProviderPaymentId { get; set; }
    public int DuplicateCount { get; set; }
    public DateTime? LastDuplicateAt { get; set; }
}

public sealed class ProviderPaymentRow
{
    public Guid Id { get; set; }
    public Guid BusinessId { get; set; }
    public Guid ConnectionId { get; set; }
    public string ProviderKey { get; set; } = "";
    public string Environment { get; set; } = "";
    public string ExternalPaymentId { get; set; } = "";
    public string Kind { get; set; } = "";
    public string Method { get; set; } = "";
    public string Status { get; set; } = "";
    public long GrossCents { get; set; }
    public long TipCents { get; set; }
    public long? FeeCents { get; set; }
    public long? NetCents { get; set; }
    public string? MerchantReference { get; set; }
    public string? UserReference { get; set; }
    public string? StatementReference { get; set; }
    public Guid? RefundOfPaymentId { get; set; }
    public DateTime OccurredAt { get; set; }
    public DateTime? CompletedAt { get; set; }
    public Guid? SettlementId { get; set; }
    public Guid? TransactionId { get; set; }
    public string ReconciliationStatus { get; set; } = "";
    public Guid? BranchId { get; set; }
    public string? DeviceId { get; set; }
    public string? LineItems { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
    public string? ConnectionName { get; set; }
    public long TotalCount { get; set; }
}

public static class IntegrationRepository
{
    private const string ConnectionColumns = """
        c.id, c.business_id, c.provider_key, c.environment, c.status, c.display_name, c.credential_ref, c.merchant_ref, c.default_branch_id,
        c.connected_at, c.disconnected_at, c.last_test_at, c.last_test_ok, c.last_sync_at, c.last_success_at, c.last_error, c.last_error_hint,
        c.created_at, b.is_demo AS business_is_demo
        """;

    public static async Task<IReadOnlyList<ConnectionRow>> ListAsync(IDbConnection conn, Guid businessId, bool includeDisconnected) =>
        (await conn.QueryAsync<ConnectionRow>(
            $"SELECT {ConnectionColumns} FROM integration_connections c JOIN businesses b ON b.id = c.business_id WHERE c.business_id = @BusinessId AND (@All OR c.status <> 'disconnected') ORDER BY c.created_at DESC",
            new { BusinessId = businessId, All = includeDisconnected })).ToList();

    public static Task<ConnectionRow?> GetAsync(IDbConnection conn, Guid businessId, Guid id, IDbTransaction? tx = null) =>
        conn.QueryFirstOrDefaultAsync<ConnectionRow>(
            $"SELECT {ConnectionColumns} FROM integration_connections c JOIN businesses b ON b.id = c.business_id WHERE c.business_id = @BusinessId AND c.id = @Id",
            new { BusinessId = businessId, Id = id }, tx);

    /// <summary>Webhook lookup by id only — the caller is a provider, not a user. The signature check decides trust.</summary>
    public static Task<ConnectionRow?> GetForWebhookAsync(IDbConnection conn, Guid id) =>
        conn.QueryFirstOrDefaultAsync<ConnectionRow>(
            $"SELECT {ConnectionColumns} FROM integration_connections c JOIN businesses b ON b.id = c.business_id WHERE c.id = @Id", new { Id = id });

    public static Task<IReadOnlyList<ConnectionRow>> DueForSyncAsync(IDbConnection conn, string providerKey, TimeSpan interval) =>
        conn.QueryAsync<ConnectionRow>(
            $"""
            SELECT {ConnectionColumns} FROM integration_connections c JOIN businesses b ON b.id = c.business_id
            WHERE c.provider_key = @Provider AND c.status = 'connected'
              AND (c.last_sync_at IS NULL OR c.last_sync_at < now() - make_interval(secs => @Seconds))
            """, new { Provider = providerKey, Seconds = interval.TotalSeconds })
        .ContinueWith(t => (IReadOnlyList<ConnectionRow>)t.Result.ToList());

    public static Task<Guid> InsertAsync(IDbConnection conn, Guid businessId, string provider, string environment, string displayName,
        string? credentialRef, string? merchantRef, Guid? defaultBranchId, Guid userId) =>
        conn.QuerySingleAsync<Guid>(
            """
            INSERT INTO integration_connections (business_id, provider_key, environment, display_name, credential_ref, merchant_ref, default_branch_id, created_by)
            VALUES (@BusinessId, @Provider, @Environment, @DisplayName, @CredentialRef, @MerchantRef, @DefaultBranchId, @UserId)
            RETURNING id
            """,
            new { BusinessId = businessId, Provider = provider, Environment = environment, DisplayName = displayName, CredentialRef = credentialRef, MerchantRef = merchantRef, DefaultBranchId = defaultBranchId, UserId = userId });

    public static Task SetTestResultAsync(IDbConnection conn, Guid id, string status, bool ok, string? error, string? hint) =>
        conn.ExecuteAsync(
            """
            UPDATE integration_connections SET status = @Status, last_test_at = now(), last_test_ok = @Ok,
                last_error = @Error, last_error_hint = @Hint,
                connected_at = CASE WHEN @Ok AND connected_at IS NULL THEN now() ELSE connected_at END, updated_at = now()
            WHERE id = @Id AND status <> 'disconnected'
            """, new { Id = id, Status = status, Ok = ok, Error = error, Hint = hint });

    /// <summary>Records a sync result. Transient failures keep the connection 'connected' (the job retries and the next
    /// scheduled sync runs); only an authentication failure moves it to 'error' until someone tests it again.</summary>
    public static Task SetSyncResultAsync(IDbConnection conn, Guid id, bool ok, string? error, string? hint, bool authFailure = false) =>
        conn.ExecuteAsync(
            """
            UPDATE integration_connections SET last_sync_at = now(),
                last_success_at = CASE WHEN @Ok THEN now() ELSE last_success_at END,
                last_error = CASE WHEN @Ok THEN NULL ELSE @Error END, last_error_hint = CASE WHEN @Ok THEN NULL ELSE @Hint END,
                status = CASE WHEN NOT @Ok AND @Auth THEN 'error' ELSE status END, updated_at = now()
            WHERE id = @Id AND status <> 'disconnected'
            """, new { Id = id, Ok = ok, Error = error, Hint = hint, Auth = authFailure });

    public static Task<int> DisconnectAsync(IDbConnection conn, Guid businessId, Guid id) =>
        conn.ExecuteAsync(
            "UPDATE integration_connections SET status = 'disconnected', disconnected_at = now(), updated_at = now() WHERE business_id = @BusinessId AND id = @Id AND status <> 'disconnected'",
            new { BusinessId = businessId, Id = id });

    public static Task<DateTime?> GetCursorAsync(IDbConnection conn, Guid connectionId) =>
        conn.QueryFirstOrDefaultAsync<DateTime?>("SELECT cursor_time FROM sync_checkpoints WHERE connection_id = @Id", new { Id = connectionId });

    public static Task SetCursorAsync(IDbConnection conn, Guid connectionId, DateTime cursor, string? lastId) =>
        conn.ExecuteAsync(
            """
            INSERT INTO sync_checkpoints (connection_id, cursor_time, last_external_id, updated_at) VALUES (@Id, @Cursor, @LastId, now())
            ON CONFLICT (connection_id) DO UPDATE SET cursor_time = EXCLUDED.cursor_time, last_external_id = EXCLUDED.last_external_id, updated_at = now()
            """, new { Id = connectionId, Cursor = cursor, LastId = lastId });

    // ---- events ----

    public sealed class InsertEventResult
    {
        public Guid Id { get; set; }
        public bool Inserted { get; set; }
    }

    /// <summary>Idempotent insert keyed by (connection, external event id). A repeat bumps the duplicate counter.</summary>
    public static Task<InsertEventResult> InsertEventAsync(IDbConnection conn, IDbTransaction tx, ConnectionRow c, string externalEventId,
        string eventType, string verification, string receivedVia, string payloadJson) =>
        conn.QuerySingleAsync<InsertEventResult>(
            """
            INSERT INTO provider_events (business_id, connection_id, provider_key, environment, external_event_id, event_type, verification, received_via, payload)
            VALUES (@BusinessId, @ConnectionId, @Provider, @Environment, @ExternalEventId, @EventType, @Verification, @ReceivedVia, @Payload::jsonb)
            ON CONFLICT (connection_id, external_event_id)
            DO UPDATE SET duplicate_count = provider_events.duplicate_count + CASE WHEN EXCLUDED.received_via = 'webhook' THEN 1 ELSE 0 END,
                last_duplicate_at = CASE WHEN EXCLUDED.received_via = 'webhook' THEN now() ELSE provider_events.last_duplicate_at END
            RETURNING id, (xmax = 0) AS inserted
            """,
            new
            {
                c.BusinessId, ConnectionId = c.Id, Provider = c.ProviderKey, c.Environment, ExternalEventId = externalEventId,
                EventType = eventType, Verification = verification, ReceivedVia = receivedVia, Payload = payloadJson
            }, tx);

    public static Task<ProviderEventRow?> GetEventForUpdateAsync(IDbConnection conn, IDbTransaction tx, Guid id) =>
        conn.QueryFirstOrDefaultAsync<ProviderEventRow>(
            "SELECT id, business_id, connection_id, provider_key, environment, external_event_id, event_type, verification, received_via, payload::text AS payload, received_at, processing_status, attempts, last_error, processed_at, provider_payment_id, duplicate_count, last_duplicate_at FROM provider_events WHERE id = @Id FOR UPDATE",
            new { Id = id }, tx);

    public static Task MarkEventAsync(IDbConnection conn, IDbTransaction? tx, Guid id, string status, string? error, Guid? paymentId) =>
        conn.ExecuteAsync(
            """
            UPDATE provider_events SET processing_status = @Status, last_error = @Error, attempts = attempts + 1,
                processed_at = CASE WHEN @Status = 'processed' THEN now() ELSE processed_at END,
                provider_payment_id = COALESCE(@PaymentId, provider_payment_id)
            WHERE id = @Id
            """, new { Id = id, Status = status, Error = error, PaymentId = paymentId }, tx);

    public static Task RecordDeliveryAsync(IDbConnection conn, IDbTransaction? tx, string provider, Guid? connectionId, Guid? businessId,
        bool signatureValid, string outcome, int httpStatus, string bodySha256, string? error, Guid? eventId) =>
        conn.ExecuteAsync(
            """
            INSERT INTO webhook_deliveries (provider_key, connection_id, business_id, signature_valid, outcome, http_status, body_sha256, error, event_id)
            VALUES (@Provider, @ConnectionId, @BusinessId, @SignatureValid, @Outcome, @HttpStatus, @BodySha256, @Error, @EventId)
            """,
            new { Provider = provider, ConnectionId = connectionId, BusinessId = businessId, SignatureValid = signatureValid, Outcome = outcome, HttpStatus = httpStatus, BodySha256 = bodySha256, Error = error, EventId = eventId }, tx);

    public sealed class ActivityRow
    {
        public string Kind { get; set; } = "";
        public Guid? Id { get; set; }
        public DateTime At { get; set; }
        public string Status { get; set; } = "";
        public string Summary { get; set; } = "";
        public string? Detail { get; set; }
    }

    /// <summary>Combined activity log for a connection: deliveries, events and their processing results. No secrets or payloads.</summary>
    public static async Task<IReadOnlyList<ActivityRow>> ActivityAsync(IDbConnection conn, Guid businessId, Guid connectionId, int limit) =>
        (await conn.QueryAsync<ActivityRow>(
            """
            SELECT * FROM (
                SELECT 'event' AS kind, e.id, e.received_at AS at, e.processing_status AS status,
                       e.event_type || ' · ' || e.external_event_id || ' (' || e.verification || ', via ' || e.received_via || ')' AS summary,
                       CASE WHEN e.duplicate_count > 0 THEN 'Repeated ' || e.duplicate_count || ' time(s); repeats ignored. ' ELSE '' END || COALESCE(e.last_error, '') AS detail
                FROM provider_events e WHERE e.business_id = @BusinessId AND e.connection_id = @ConnectionId
                UNION ALL
                SELECT 'delivery', NULL, d.received_at, d.outcome,
                       'Webhook delivery · HTTP ' || d.http_status || CASE WHEN d.signature_valid THEN ' · signature valid' ELSE ' · signature INVALID' END,
                       d.error
                FROM webhook_deliveries d WHERE d.connection_id = @ConnectionId
            ) x ORDER BY at DESC LIMIT @Limit
            """, new { BusinessId = businessId, ConnectionId = connectionId, Limit = limit })).ToList();

    // ---- payments ----

    private const string PaymentColumns = """
        p.id, p.business_id, p.connection_id, p.provider_key, p.environment, p.external_payment_id, p.kind, p.method, p.status,
        p.gross_cents, p.tip_cents, p.fee_cents, p.net_cents, p.merchant_reference, p.user_reference, p.statement_reference,
        p.refund_of_payment_id, p.occurred_at, p.completed_at, p.settlement_id, p.transaction_id, p.reconciliation_status,
        p.branch_id, p.device_id, p.line_items::text AS line_items, p.created_at, p.updated_at, c.display_name AS connection_name
        """;

    public static Task<ProviderPaymentRow?> GetPaymentForUpdateAsync(IDbConnection conn, IDbTransaction tx, Guid connectionId, string externalPaymentId) =>
        conn.QueryFirstOrDefaultAsync<ProviderPaymentRow>(
            $"SELECT {PaymentColumns} FROM provider_payments p JOIN integration_connections c ON c.id = p.connection_id WHERE p.connection_id = @ConnectionId AND p.external_payment_id = @Ext FOR UPDATE OF p",
            new { ConnectionId = connectionId, Ext = externalPaymentId }, tx);

    public static Task<ProviderPaymentRow?> GetPaymentAsync(IDbConnection conn, Guid businessId, Guid id, IDbTransaction? tx = null, bool forUpdate = false) =>
        conn.QueryFirstOrDefaultAsync<ProviderPaymentRow>(
            $"SELECT {PaymentColumns} FROM provider_payments p JOIN integration_connections c ON c.id = p.connection_id WHERE p.business_id = @BusinessId AND p.id = @Id{(forUpdate ? " FOR UPDATE OF p" : "")}",
            new { BusinessId = businessId, Id = id }, tx);

    public static async Task<(IReadOnlyList<ProviderPaymentRow> Rows, long Total)> ListPaymentsAsync(IDbConnection conn, Guid businessId,
        string? reconciliationStatus, string? status, Guid? connectionId, DateOnly? from, DateOnly? to, int page, int pageSize)
    {
        var rows = (await conn.QueryAsync<ProviderPaymentRow>(
            $"""
            SELECT COUNT(*) OVER() AS total_count, {PaymentColumns}
            FROM provider_payments p JOIN integration_connections c ON c.id = p.connection_id
            WHERE p.business_id = @BusinessId
              AND (@Recon::text IS NULL OR p.reconciliation_status = @Recon)
              AND (@Status::text IS NULL OR p.status = @Status)
              AND (@ConnectionId::uuid IS NULL OR p.connection_id = @ConnectionId::uuid)
              AND (@From::date IS NULL OR (p.occurred_at AT TIME ZONE 'Africa/Johannesburg')::date >= @From::date)
              AND (@To::date IS NULL OR (p.occurred_at AT TIME ZONE 'Africa/Johannesburg')::date <= @To::date)
            ORDER BY p.occurred_at DESC, p.id
            LIMIT @Limit OFFSET @Offset
            """,
            new { BusinessId = businessId, Recon = reconciliationStatus, Status = status, ConnectionId = connectionId, From = from, To = to, Limit = pageSize, Offset = (page - 1) * pageSize })).ToList();
        return (rows, rows.Count > 0 ? rows[0].TotalCount : 0);
    }

    public static Task<Guid> InsertPaymentAsync(IDbConnection conn, IDbTransaction tx, ConnectionRow c, Core.Integrations.NormalizedEvent e,
        DateTime occurredAt, Guid? refundOf, Guid? branchId, string? lineItemsJson) =>
        conn.QuerySingleAsync<Guid>(
            """
            INSERT INTO provider_payments (business_id, connection_id, provider_key, environment, external_payment_id, kind, method, status,
                gross_cents, tip_cents, fee_cents, net_cents, merchant_reference, user_reference, statement_reference, refund_of_payment_id,
                occurred_at, completed_at, reconciliation_status, branch_id, device_id, line_items)
            VALUES (@BusinessId, @ConnectionId, @Provider, @Environment, @Ext, @Kind, @Method, @Status,
                @Gross, @Tip, @Fee, @Net, @MerchantRef, @UserRef, @StatementRef, @RefundOf,
                @OccurredAt, CASE WHEN @Status = 'completed' THEN now() ELSE NULL END, 'unmatched', @BranchId, @DeviceId, @Lines::jsonb)
            RETURNING id
            """,
            new
            {
                c.BusinessId, ConnectionId = c.Id, Provider = c.ProviderKey, c.Environment, Ext = e.ExternalPaymentId, e.Kind,
                Method = e.Method is "qr" or "card" ? e.Method : "other", e.Status, Gross = e.GrossCents, Tip = e.TipCents, Fee = e.FeeCents,
                Net = e.NetCents, MerchantRef = e.MerchantReference, UserRef = e.UserReference, StatementRef = e.StatementReference,
                RefundOf = refundOf, OccurredAt = occurredAt, BranchId = branchId, DeviceId = e.DeviceId, Lines = lineItemsJson
            }, tx);

    public static Task UpdatePaymentStatusAsync(IDbConnection conn, IDbTransaction tx, Guid id, string status, string? statementReference) =>
        conn.ExecuteAsync(
            """
            UPDATE provider_payments SET status = @Status, statement_reference = COALESCE(@StatementRef, statement_reference),
                completed_at = CASE WHEN @Status = 'completed' AND completed_at IS NULL THEN now() ELSE completed_at END, updated_at = now()
            WHERE id = @Id
            """, new { Id = id, Status = status, StatementRef = statementReference }, tx);

    public static Task SetReconciliationAsync(IDbConnection conn, IDbTransaction tx, Guid paymentId, string reconStatus, Guid? transactionId, bool setTransaction = true) =>
        conn.ExecuteAsync(
            $"UPDATE provider_payments SET reconciliation_status = @Recon{(setTransaction ? ", transaction_id = @TransactionId" : "")}, updated_at = now() WHERE id = @Id",
            new { Id = paymentId, Recon = reconStatus, TransactionId = transactionId }, tx);
}
