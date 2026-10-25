using System.Data;
using System.Text.Json;
using System.Text.RegularExpressions;
using Dapper;
using KasiFlow.Api.Data;
using KasiFlow.Api.DTOs;
using KasiFlow.Api.Middleware;
using KasiFlow.Api.Repositories;
using KasiFlow.Core.Access;
using KasiFlow.Core.Common;
using KasiFlow.Core.Integrations;
using KasiFlow.Core.Validation;

namespace KasiFlow.Api.Services.Integrations;

/// <summary>Integrations Centre: catalogue, connections, connection tests, health, activity and the demo sandbox.</summary>
public sealed partial class IntegrationService(IDbConnectionFactory db, IBusinessContext business, PaymentProviderRegistry registry,
    PaymentIngestionService ingestion, SandboxAdapter sandbox, IClock clock)
{
    [GeneratedRegex("^[A-Za-z0-9_-]{1,64}$")]
    private static partial Regex CredentialRefPattern();

    // ------------------------------------------------------------------ catalogue & connections

    public async Task<IntegrationsOverviewDto> OverviewAsync(CancellationToken ct)
    {
        var access = await business.RequireAsync(Permission.ViewIntegrations);
        await using var conn = await db.OpenAsync(ct);
        var connections = await IntegrationRepository.ListAsync(conn, access.BusinessId, includeDisconnected: false);
        var dtos = new List<ConnectionDto>();
        foreach (var c in connections) dtos.Add(await ToDtoAsync(conn, c));
        return new IntegrationsOverviewDto(PaymentProviderRegistry.Catalogue(access.IsDemoBusiness), dtos, access.IsDemoBusiness,
            access.Can(Permission.ManageIntegrations));
    }

    public async Task<ConnectionDto> GetAsync(Guid id, CancellationToken ct)
    {
        var access = await business.RequireAsync(Permission.ViewIntegrations);
        await using var conn = await db.OpenAsync(ct);
        var c = await IntegrationRepository.GetAsync(conn, access.BusinessId, id) ?? throw new NotFoundException();
        return await ToDtoAsync(conn, c);
    }

    public async Task<ConnectionTestDto> ConnectAsync(ConnectInput input, CancellationToken ct)
    {
        var access = await business.RequireAsync(Permission.ManageIntegrations);
        var e = new ValidationErrors();
        var provider = input.ProviderKey?.Trim().ToLowerInvariant();
        if (provider is ProviderKeys.Yoco) throw new BadRequestException("Yoco is planned and awaiting provider access, so it cannot be connected yet.");
        if (provider is not (ProviderKeys.Sandbox or ProviderKeys.SnapScan)) e.Add("providerKey", "Choose an available provider.");
        var name = string.IsNullOrWhiteSpace(input.DisplayName) ? null : input.DisplayName.Trim();
        if (name is { Length: > 80 }) e.Add("displayName", "Use 80 characters or fewer.");
        string? credentialRef = null;
        if (provider == ProviderKeys.SnapScan)
        {
            credentialRef = input.CredentialRef?.Trim();
            if (string.IsNullOrEmpty(credentialRef) || !CredentialRefPattern().IsMatch(credentialRef))
                e.Add("credentialRef", "Give the credential a short name using letters, numbers, '-' or '_' (for example 'main'). Never paste the API key here.");
        }
        if (!e.IsValid) throw new RequestValidationException(e);
        if (provider == ProviderKeys.Sandbox && !access.IsDemoBusiness)
            throw new ForbiddenException("The sandbox only runs on the fictional demo business, so simulated data never mixes with real records.");

        await using var conn = await db.OpenAsync(ct);
        if (input.DefaultBranchId is { } branchId &&
            await conn.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM branches WHERE id = @Id AND business_id = @B AND is_active", new { Id = branchId, B = access.BusinessId }) == 0)
            throw new RequestValidationException(new ValidationErrors().Add("defaultBranchId", "Choose one of your branches."));
        var defaultBranch = input.DefaultBranchId ?? await conn.QueryFirstOrDefaultAsync<Guid?>(
            "SELECT id FROM branches WHERE business_id = @B AND is_active ORDER BY created_at LIMIT 1", new { B = access.BusinessId });

        if (await conn.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM integration_connections WHERE business_id = @B AND provider_key = @P AND status <> 'disconnected'",
                new { B = access.BusinessId, P = provider }) > 0)
            throw new ConflictException("This provider is already connected. Disconnect it first to reconnect.");
        Guid id;
        try
        {
            id = await IntegrationRepository.InsertAsync(conn, access.BusinessId, provider!,
                provider == ProviderKeys.Sandbox ? IntegrationEnvironments.Sandbox : IntegrationEnvironments.Production,
                name ?? (provider == ProviderKeys.Sandbox ? "Demo sandbox" : "SnapScan"), credentialRef, null, defaultBranch, access.UserId);
        }
        catch (Exception ex) when (PostgresErrors.IsUniqueViolation(ex))
        {
            throw new ConflictException("This provider is already connected. Disconnect it first to reconnect.");
        }
        await AuditRepository.WriteAsync(conn, null, access.BusinessId, access.UserId, "integration_connected", "integration_connection", id,
            JsonSerializer.Serialize(new { provider }));
        return await TestInternalAsync(conn, access, id, ct);
    }

    public async Task<ConnectionTestDto> TestAsync(Guid id, CancellationToken ct)
    {
        var access = await business.RequireAsync(Permission.ManageIntegrations);
        await using var conn = await db.OpenAsync(ct);
        return await TestInternalAsync(conn, access, id, ct);
    }

    /// <summary>Only a successful, genuine test marks a connection as connected.</summary>
    private async Task<ConnectionTestDto> TestInternalAsync(IDbConnection conn, AccessContext access, Guid id, CancellationToken ct)
    {
        var c = await IntegrationRepository.GetAsync(conn, access.BusinessId, id) ?? throw new NotFoundException();
        if (c.Status == "disconnected") throw new ConflictException("This connection was disconnected.");
        var adapter = registry.Get(c.ProviderKey) ?? throw new BadRequestException("This provider is not available.");
        var result = await adapter.TestAsync(c, ct);
        await IntegrationRepository.SetTestResultAsync(conn, c.Id, result.Status, result.Ok, result.Error, result.Hint);
        await AuditRepository.WriteAsync(conn, null, access.BusinessId, access.UserId, "integration_tested", "integration_connection", c.Id,
            JsonSerializer.Serialize(new { ok = result.Ok, status = result.Status }));
        if (!result.Ok)
            await NotificationRepository.NotifyAsync(conn, null, access.BusinessId, Permission.ManageIntegrations, "integration", "warning",
                $"{c.DisplayName}: connection not ready", result.Error ?? "The connection test failed.", "/integrations", $"test:{c.Id}:{clock.Today:yyyyMMdd}");
        var fresh = (await IntegrationRepository.GetAsync(conn, access.BusinessId, id))!;
        return new ConnectionTestDto(result.Ok, result.Status, result.Error, result.Hint, await ToDtoAsync(conn, fresh));
    }

    public async Task DisconnectAsync(Guid id, CancellationToken ct)
    {
        var access = await business.RequireAsync(Permission.ManageIntegrations);
        await using var conn = await db.OpenAsync(ct);
        if (await IntegrationRepository.DisconnectAsync(conn, access.BusinessId, id) == 0) throw new NotFoundException();
        await AuditRepository.WriteAsync(conn, null, access.BusinessId, access.UserId, "integration_disconnected", "integration_connection", id);
    }

    public async Task<IReadOnlyList<ActivityDto>> ActivityAsync(Guid id, CancellationToken ct)
    {
        var access = await business.RequireAsync(Permission.ViewIntegrations);
        await using var conn = await db.OpenAsync(ct);
        _ = await IntegrationRepository.GetAsync(conn, access.BusinessId, id) ?? throw new NotFoundException();
        return (await IntegrationRepository.ActivityAsync(conn, access.BusinessId, id, 100))
            .Select(a => new ActivityDto(a.Kind, a.Id, a.At, a.Status, a.Summary, string.IsNullOrWhiteSpace(a.Detail) ? null : a.Detail)).ToList();
    }

    public async Task SyncNowAsync(Guid id, CancellationToken ct)
    {
        var access = await business.RequireAsync(Permission.ManageIntegrations);
        await using var conn = await db.OpenAsync(ct);
        var c = await IntegrationRepository.GetAsync(conn, access.BusinessId, id) ?? throw new NotFoundException();
        var adapter = registry.Get(c.ProviderKey);
        if (adapter is not { SupportsPolling: true }) throw new BadRequestException("This provider does not support scheduled sync.");
        if (c.Status != "connected") throw new ConflictException("Run a successful connection test first.");
        await JobQueue.EnqueueAsync(conn, null, JobTypes.SyncConnection, access.BusinessId, $"sync:{c.Id}", new { connectionId = c.Id });
    }

    public async Task<PagedResult<ProviderPaymentDto>> PaymentsAsync(string? reconciliationStatus, string? status, Guid? connectionId,
        DateOnly? from, DateOnly? to, int page, int pageSize, CancellationToken ct)
    {
        var access = await business.RequireAsync(Permission.ViewIntegrations, Permission.ManageReconciliation);
        page = Math.Max(1, page);
        pageSize = Math.Clamp(pageSize, 1, 100);
        await using var conn = await db.OpenAsync(ct);
        var (rows, total) = await IntegrationRepository.ListPaymentsAsync(conn, access.BusinessId, reconciliationStatus, status, connectionId, from, to, page, pageSize);
        return new PagedResult<ProviderPaymentDto>(rows.Select(ToDto).ToList(), page, pageSize, total, (int)Math.Ceiling(total / (double)pageSize));
    }

    private sealed class SettlementRow
    {
        public Guid Id { get; set; }
        public Guid ConnectionId { get; set; }
        public string ExternalSettlementId { get; set; } = "";
        public DateOnly SettledOn { get; set; }
        public long GrossCents { get; set; }
        public long? FeeCents { get; set; }
        public long? NetCents { get; set; }
        public int PaymentCount { get; set; }
        public Guid? FeeTransactionId { get; set; }
        public string Environment { get; set; } = "";
    }

    public async Task<IReadOnlyList<SettlementDto>> SettlementsAsync(CancellationToken ct)
    {
        var access = await business.RequireAsync(Permission.ViewIntegrations, Permission.ManageReconciliation);
        await using var conn = await db.OpenAsync(ct);
        return (await conn.QueryAsync<SettlementRow>(
            "SELECT id, connection_id, external_settlement_id, settled_on, gross_cents, fee_cents, net_cents, payment_count, fee_transaction_id, environment FROM settlements WHERE business_id = @B ORDER BY settled_on DESC, created_at DESC LIMIT 100",
            new { B = access.BusinessId }))
            .Select(s => new SettlementDto(s.Id, s.ConnectionId, s.ExternalSettlementId, s.SettledOn, s.GrossCents, s.FeeCents, s.NetCents, s.PaymentCount, s.FeeTransactionId, s.Environment))
            .ToList();
    }

    public async Task<IReadOnlyList<JobDto>> JobsAsync(string? status, CancellationToken ct)
    {
        var access = await business.RequireAsync(Permission.ManageIntegrations);
        await using var conn = await db.OpenAsync(ct);
        return (await JobQueue.ListAsync(conn, access.BusinessId, status))
            .Select(j => new JobDto(j.Id, j.JobType, j.Status, j.Attempts, j.MaxAttempts, j.RunAfter, j.LastError, j.CreatedAt, j.UpdatedAt, j.CompletedAt)).ToList();
    }

    public async Task RetryJobAsync(Guid id, CancellationToken ct)
    {
        var access = await business.RequireAsync(Permission.ManageIntegrations);
        await using var conn = await db.OpenAsync(ct);
        if (await JobQueue.RetryAsync(conn, access.BusinessId, id) == 0) throw new NotFoundException("No failed job with that id.");
        await conn.ExecuteAsync(
            "UPDATE provider_events SET processing_status = 'received' WHERE business_id = @B AND processing_status IN ('failed','dead') AND id = (SELECT (payload->>'eventId')::uuid FROM background_jobs WHERE id = @Id AND job_type = 'process_provider_event')",
            new { B = access.BusinessId, Id = id });
        await AuditRepository.WriteAsync(conn, null, access.BusinessId, access.UserId, "job_retried", "background_job", id);
    }

    // ------------------------------------------------------------------ mapping & health

    internal static ProviderPaymentDto ToDto(ProviderPaymentRow p) =>
        new(p.Id, p.ConnectionId, p.ConnectionName ?? p.ProviderKey, p.ProviderKey, p.Environment, p.ExternalPaymentId, p.Kind, p.Method,
            p.Status, p.GrossCents, p.TipCents, p.FeeCents, p.NetCents, p.MerchantReference, p.StatementReference, p.OccurredAt, p.CompletedAt,
            p.SettlementId, p.TransactionId, p.ReconciliationStatus, p.BranchId,
            p.Kind == PaymentKinds.Payment && PaymentStateMachine.CountsAsIncome(p.Status),
            p.Environment == IntegrationEnvironments.Sandbox ? "Demo simulation" : p.LineItems is not null ? "Connected POS" : "Verified payment provider");

    private sealed class HealthRow
    {
        public int Events24 { get; set; }
        public int Failed { get; set; }
        public int Duplicates { get; set; }
        public int Pending { get; set; }
        public int Dead { get; set; }
        public DateTime? LastEventAt { get; set; }
    }

    private async Task<ConnectionDto> ToDtoAsync(IDbConnection conn, ConnectionRow c)
    {
        var h = await conn.QuerySingleAsync<HealthRow>(
            """
            SELECT
              (SELECT COUNT(*) FROM provider_events WHERE connection_id = @C AND received_at > now() - interval '24 hours')::int AS events24,
              (SELECT COUNT(*) FROM provider_events WHERE connection_id = @C AND processing_status IN ('failed','dead','rejected'))::int AS failed,
              (SELECT COALESCE(SUM(duplicate_count), 0) FROM provider_events WHERE connection_id = @C AND received_at > now() - interval '7 days')::int AS duplicates,
              (SELECT COUNT(*) FROM background_jobs j WHERE j.business_id = @B AND j.status IN ('queued','running','failed')
                  AND (j.payload->>'connectionId' = @CText OR (j.job_type = 'process_provider_event' AND (j.payload->>'eventId')::uuid IN (SELECT id FROM provider_events WHERE connection_id = @C))))::int AS pending,
              (SELECT COUNT(*) FROM background_jobs j WHERE j.business_id = @B AND j.status = 'dead'
                  AND (j.payload->>'connectionId' = @CText OR (j.job_type = 'process_provider_event' AND (j.payload->>'eventId')::uuid IN (SELECT id FROM provider_events WHERE connection_id = @C))))::int AS dead,
              (SELECT MAX(received_at) FROM provider_events WHERE connection_id = @C) AS last_event_at
            """, new { C = c.Id, CText = c.Id.ToString(), B = c.BusinessId });

        var (state, label) = c.Status switch
        {
            "connected" when h.Dead > 0 => ("degraded", $"{h.Dead} event(s) could not be processed — retry them below"),
            "connected" when c.LastError is not null => ("degraded", "Connected, but the last sync failed"),
            "connected" => ("healthy", c.Environment == IntegrationEnvironments.Sandbox ? "Sandbox active (simulated, not real money)" : "Connected and verified"),
            "awaiting_credentials" => ("setup", "Waiting for credentials on the server"),
            "pending_setup" => ("setup", "Setup not finished"),
            "error" => ("error", c.LastError ?? "Connection test failed"),
            _ => ("disconnected", "Disconnected")
        };
        return new ConnectionDto(c.Id, c.ProviderKey, c.Environment, c.Status, c.DisplayName, c.CredentialRef, c.DefaultBranchId, c.ConnectedAt,
            c.LastTestAt, c.LastTestOk, c.LastSyncAt, c.LastSuccessAt, c.LastError, c.LastErrorHint,
            $"/api/webhooks/{c.ProviderKey}/{c.Id}", c.Environment == IntegrationEnvironments.Sandbox,
            new ConnectionHealthDto(state, label, h.Events24, h.Failed, h.Duplicates, h.Pending, h.Dead, h.LastEventAt));
    }

    // ------------------------------------------------------------------ demo sandbox

    private async Task<(AccessContext Access, ConnectionRow Connection)> SandboxConnectionAsync(IDbConnection conn, Guid id)
    {
        var access = await business.RequireAsync(Permission.ManageIntegrations);
        if (!access.IsDemoBusiness) throw new ForbiddenException("The sandbox only runs on the fictional demo business.");
        var c = await IntegrationRepository.GetAsync(conn, access.BusinessId, id) ?? throw new NotFoundException();
        if (c.ProviderKey != ProviderKeys.Sandbox || c.Status != "connected") throw new ConflictException("Connect the sandbox first.");
        return (access, c);
    }

    private sealed class SimProduct
    {
        public string Sku { get; set; } = "";
        public long UnitPriceCents { get; set; }
    }

    /// <summary>Builds clearly labelled simulated events and sends them through the real webhook pipeline,
    /// including signature verification, idempotent storage and background processing.</summary>
    public async Task<SimulateResultDto> SimulateAsync(Guid connectionId, SimulateInput input, CancellationToken ct)
    {
        await using var conn = await db.OpenAsync(ct);
        var (access, c) = await SandboxConnectionAsync(conn, connectionId);
        var scenario = input.Scenario?.Trim().ToLowerInvariant() ?? "";
        var e = new ValidationErrors();
        if (input.AmountCents is { } a && a is < 100 or > 10_000_000) e.Add("amountCents", "Use an amount between R1 and R100 000.");
        if (input.Reference is { Length: > 60 }) e.Add("reference", "Use 60 characters or fewer.");
        if (input.Quantity is { } q && q is < 1 or > 50) e.Add("quantity", "Use a quantity between 1 and 50.");
        if (input.FeeCents is < 0 or > 10_000_000) e.Add("feeCents", "Use a fee between R0 and R100 000.");
        if (!e.IsValid) throw new RequestValidationException(e);

        var now = clock.UtcNow;
        string NewId() => "SBX-" + Guid.NewGuid().ToString("N")[..10].ToUpperInvariant();
        var method = input.Method is "card" ? "card" : "qr";
        var amount = input.AmountCents ?? 15_000;
        var events = new List<NormalizedEvent>();
        string message;

        switch (scenario)
        {
            case "qr_payment":
            {
                var id = NewId();
                events.Add(new NormalizedEvent($"payment:{id}:completed", EventTypes.Payment, id, Method: method, Status: ProviderPaymentStatuses.Completed,
                    GrossCents: amount, MerchantReference: string.IsNullOrWhiteSpace(input.Reference) ? null : input.Reference.Trim(), OccurredAt: now));
                message = $"Simulated a completed {method.ToUpperInvariant()} payment of {Money.FormatZar(amount)}.";
                break;
            }
            case "pos_sale":
            {
                var products = (await conn.QueryAsync<SimProduct>(
                    "SELECT sku, unit_price_cents FROM products WHERE business_id = @B AND is_active AND kind = 'product' AND (@Sku::text IS NULL OR sku = @Sku) ORDER BY name LIMIT 1",
                    new { B = access.BusinessId, Sku = input.Sku })).ToList();
                if (products.Count == 0) throw new BadRequestException("Add a stock product first (Inventory → Products).");
                var qty = input.Quantity ?? 1;
                var id = NewId();
                var lines = new List<NormalizedLineItem> { new(products[0].Sku, qty, products[0].UnitPriceCents) };
                var gross = products[0].UnitPriceCents * qty;
                events.Add(new NormalizedEvent($"payment:{id}:completed", EventTypes.Payment, id, Method: "card", Status: ProviderPaymentStatuses.Completed,
                    GrossCents: gross, MerchantReference: id, OccurredAt: now, LineItems: lines, DeviceId: "SANDBOX-POS-1"));
                message = $"Simulated a POS sale: {qty} × {products[0].Sku} ({Money.FormatZar(gross)}).";
                break;
            }
            case "pending_payment":
            {
                var id = NewId();
                events.Add(new NormalizedEvent($"payment:{id}:pending", EventTypes.Payment, id, Method: method, Status: ProviderPaymentStatuses.Pending,
                    GrossCents: amount, MerchantReference: input.Reference, OccurredAt: now));
                message = "Simulated a pending payment. It is not counted as income until it completes.";
                break;
            }
            case "complete_pending":
            case "fail_pending":
            case "reverse_payment":
            case "duplicate":
            case "refund":
            {
                var p = await TargetPaymentAsync(conn, access.BusinessId, c.Id, input.PaymentId, scenario);
                var status = scenario switch
                {
                    "complete_pending" => ProviderPaymentStatuses.Completed,
                    "fail_pending" => ProviderPaymentStatuses.Failed,
                    "reverse_payment" => ProviderPaymentStatuses.Reversed,
                    _ => p.Status
                };
                if (scenario == "refund")
                {
                    var rid = NewId();
                    var refundAmount = Math.Min(input.AmountCents ?? p.GrossCents, p.GrossCents);
                    events.Add(new NormalizedEvent($"payment:{rid}:completed", EventTypes.Payment, rid, PaymentKinds.Refund, p.Method, ProviderPaymentStatuses.Completed,
                        refundAmount, OccurredAt: now, RefundOfExternalPaymentId: p.ExternalPaymentId, MerchantReference: $"REFUND-{p.ExternalPaymentId}"));
                    message = $"Simulated a refund of {Money.FormatZar(refundAmount)}.";
                }
                else if (scenario == "duplicate")
                {
                    var original = await conn.QueryFirstOrDefaultAsync<string>(
                        "SELECT payload::text FROM provider_events WHERE connection_id = @C AND provider_payment_id = @P ORDER BY received_at DESC LIMIT 1", new { C = c.Id, P = p.Id })
                        ?? throw new BadRequestException("No event found for that payment.");
                    var ev = JsonSerializer.Deserialize<NormalizedEvent>(original, PaymentIngestionService.Json)!;
                    events.Add(ev);
                    events.Add(ev);
                    message = "Re-sent the same event twice. Duplicates are acknowledged and ignored.";
                }
                else
                {
                    events.Add(new NormalizedEvent($"payment:{p.ExternalPaymentId}:{status}", EventTypes.Payment, p.ExternalPaymentId, p.Kind, p.Method, status,
                        p.GrossCents, MerchantReference: p.MerchantReference, OccurredAt: new DateTimeOffset(DateTime.SpecifyKind(p.OccurredAt, DateTimeKind.Utc))));
                    message = scenario switch
                    {
                        "complete_pending" => "Simulated the provider confirming the pending payment.",
                        "fail_pending" => "Simulated the payment failing. Nothing is counted as income.",
                        _ => "Simulated the provider reversing the payment."
                    };
                }
                break;
            }
            case "settlement":
            {
                var ids = (await conn.QueryAsync<string>(
                    "SELECT external_payment_id FROM provider_payments WHERE connection_id = @C AND status = 'completed' AND kind = 'payment' AND settlement_id IS NULL ORDER BY occurred_at LIMIT 200",
                    new { C = c.Id })).ToList();
                if (ids.Count == 0) throw new BadRequestException("There are no unsettled completed sandbox payments.");
                var gross = await conn.ExecuteScalarAsync<long>("SELECT COALESCE(SUM(gross_cents),0)::bigint FROM provider_payments WHERE connection_id = @C AND external_payment_id = ANY(@Ids)",
                    new { C = c.Id, Ids = ids.ToArray() });
                // Simulated fee: 2.95% (illustrative only — real fees come from the provider).
                var fee = Math.Min(gross, input.FeeCents ?? (long)Math.Round(gross * 0.0295m, MidpointRounding.AwayFromZero));
                var sid = "SBX-SETTLE-" + Guid.NewGuid().ToString("N")[..8].ToUpperInvariant();
                events.Add(new NormalizedEvent($"settlement:{sid}", EventTypes.Settlement, ExternalSettlementId: sid, SettledOn: clock.Today,
                    SettledPaymentIds: ids, FeeCents: fee, GrossCents: gross, NetCents: gross - fee, OccurredAt: now));
                message = $"Simulated a payout of {ids.Count} payment(s): gross {Money.FormatZar(gross)}, fees {Money.FormatZar(fee)}, net {Money.FormatZar(gross - fee)}.";
                break;
            }
            case "bad_signature":
            {
                var id = NewId();
                var ev = new NormalizedEvent($"payment:{id}:completed", EventTypes.Payment, id, Status: ProviderPaymentStatuses.Completed, GrossCents: amount, OccurredAt: now);
                var body = SandboxPayload.Serialize(ev);
                var outcome = await ingestion.IngestWebhookAsync(c.ProviderKey, c.Id, body, Headers("sha256=" + new string('0', 64)), ct);
                return new SimulateResultDto(scenario, "Sent an event with a forged signature. It was rejected and nothing was recorded.",
                    [new SimulatedDeliveryDto(ev.ExternalEventId, outcome.StatusCode, outcome.Outcome)]);
            }
            default:
                throw new RequestValidationException(new ValidationErrors().Add("scenario",
                    "Choose qr_payment, pos_sale, pending_payment, complete_pending, fail_pending, reverse_payment, refund, settlement, duplicate or bad_signature."));
        }

        var deliveries = new List<SimulatedDeliveryDto>();
        foreach (var ev in events)
        {
            var (body, signature) = sandbox.Sign(c.Id, ev);
            var outcome = await ingestion.IngestWebhookAsync(c.ProviderKey, c.Id, body, Headers(signature), ct);
            deliveries.Add(new SimulatedDeliveryDto(ev.ExternalEventId, outcome.StatusCode, outcome.Outcome));
        }
        await AuditRepository.WriteAsync(conn, null, access.BusinessId, access.UserId, "sandbox_simulated", "integration_connection", c.Id,
            JsonSerializer.Serialize(new { scenario }));
        return new SimulateResultDto(scenario, message + " (SANDBOX — simulated, not real money.)", deliveries);
    }

    private static HeaderDictionary Headers(string signature) => new() { [SandboxAdapter.SignatureHeader] = signature };

    private static async Task<ProviderPaymentRow> TargetPaymentAsync(IDbConnection conn, Guid businessId, Guid connectionId, Guid? paymentId, string scenario)
    {
        var wanted = scenario switch
        {
            "complete_pending" or "fail_pending" => "pending",
            "reverse_payment" or "refund" => "completed",
            _ => null
        };
        var id = paymentId ?? await conn.QueryFirstOrDefaultAsync<Guid?>(
            "SELECT id FROM provider_payments WHERE connection_id = @C AND kind = 'payment' AND (@Status::text IS NULL OR status = @Status) ORDER BY occurred_at DESC LIMIT 1",
            new { C = connectionId, Status = wanted });
        if (id is null) throw new BadRequestException(wanted is null ? "Simulate a payment first." : $"There is no {wanted} sandbox payment to use.");
        var p = await IntegrationRepository.GetPaymentAsync(conn, businessId, id.Value) ?? throw new NotFoundException();
        if (p.ConnectionId != connectionId) throw new NotFoundException();
        if (wanted is not null && p.Status != wanted) throw new ConflictException($"That payment is {p.Status}; this action needs a {wanted} payment.");
        if (p.Kind != PaymentKinds.Payment) throw new ConflictException("Choose a payment, not a refund.");
        return p;
    }

    /// <summary>Removes every sandbox record from the demo business: events, payments, settlements, created sales and
    /// their stock movements. Staff-recorded sales that were matched go back to unconfirmed-by-provider.</summary>
    public async Task<SandboxResetDto> ResetSandboxAsync(CancellationToken ct)
    {
        var access = await business.RequireAsync(Permission.ManageIntegrations);
        if (!access.IsDemoBusiness) throw new ForbiddenException("The sandbox only runs on the fictional demo business.");
        await using var conn = await db.OpenAsync(ct);
        using var tx = conn.BeginTransaction();
        var b = new { B = access.BusinessId };
        const string sandboxPayments = "SELECT id FROM provider_payments WHERE business_id = @B AND environment = 'sandbox'";

        var movements = (await conn.QueryAsync<(Guid Id, Guid ProductId, Guid BranchId, int Delta, string Status)>(
            $"SELECT id, product_id, branch_id, quantity_delta, status FROM stock_movements WHERE business_id = @B AND provider_payment_id IN ({sandboxPayments})", b, tx)).ToList();
        foreach (var m in movements.Where(m => m.Status == "applied"))
            await StockLedger.ApplyLevelAsync(conn, tx, access.BusinessId, m.ProductId, m.BranchId, -m.Delta);
        await conn.ExecuteAsync($"DELETE FROM stock_movements WHERE business_id = @B AND provider_payment_id IN ({sandboxPayments})", b, tx);

        await conn.ExecuteAsync(
            $"""
            UPDATE transactions SET provider_payment_id = NULL, payment_status = 'recorded_manually', updated_at = now()
            WHERE business_id = @B AND origin = 'staff_recorded' AND provider_payment_id IN ({sandboxPayments})
            """, b, tx);
        await conn.ExecuteAsync("UPDATE settlements SET fee_transaction_id = NULL WHERE business_id = @B AND environment = 'sandbox'", b, tx);
        var txRemoved = await conn.ExecuteAsync("DELETE FROM transactions WHERE business_id = @B AND origin = 'demo_simulation'", b, tx);
        var paymentsRemoved = await conn.ExecuteScalarAsync<int>($"SELECT COUNT(*) FROM ({sandboxPayments}) x", b, tx);
        await conn.ExecuteAsync("DELETE FROM webhook_deliveries WHERE business_id = @B AND connection_id IN (SELECT id FROM integration_connections WHERE business_id = @B AND provider_key = 'sandbox')", b, tx);
        await conn.ExecuteAsync("DELETE FROM background_jobs WHERE business_id = @B AND job_type = 'process_provider_event' AND status <> 'running'", b, tx);
        await conn.ExecuteAsync("DELETE FROM provider_payments WHERE business_id = @B AND environment = 'sandbox'", b, tx);
        await conn.ExecuteAsync("DELETE FROM provider_events WHERE business_id = @B AND environment = 'sandbox'", b, tx);
        await conn.ExecuteAsync("DELETE FROM settlements WHERE business_id = @B AND environment = 'sandbox'", b, tx);
        await AuditRepository.WriteAsync(conn, tx, access.BusinessId, access.UserId, "sandbox_reset", "integration_connection", null);
        await JobQueue.EnqueueGrowthRefreshAsync(conn, tx, access.BusinessId);
        tx.Commit();
        return new SandboxResetDto(paymentsRemoved, txRemoved, movements.Count);
    }
}
