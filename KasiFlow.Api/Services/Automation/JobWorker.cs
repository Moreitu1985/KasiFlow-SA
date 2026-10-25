using System.Text.Json;
using Dapper;
using KasiFlow.Api.Data;
using KasiFlow.Api.Repositories;
using KasiFlow.Api.Services.Integrations;
using KasiFlow.Core.Access;
using KasiFlow.Core.Common;
using KasiFlow.Core.Integrations;

namespace KasiFlow.Api.Services.Automation;

public sealed class AutomationOptions
{
    public const string Section = "Automation";
    /// <summary>Runs the background worker in this process. Turn off only when another instance runs it.</summary>
    public bool EnableWorker { get; set; } = true;
    public int SnapScanSyncMinutes { get; set; } = 10;
    /// <summary>Hour (South African time) after which the daily briefing notification is created.</summary>
    public int BriefingHour { get; set; } = 6;
}

/// <summary>Pulls payments from providers that support polling (SnapScan) and feeds them through the same pipeline as webhooks.</summary>
public sealed class ProviderSyncService(IDbConnectionFactory db, PaymentProviderRegistry registry, PaymentIngestionService ingestion,
    IClock clock, ILogger<ProviderSyncService> logger)
{
    /// <summary>Overlap protects against clock skew and late-arriving updates; duplicates are ignored by the event key.</summary>
    private static readonly TimeSpan Overlap = TimeSpan.FromMinutes(30);
    /// <summary>SnapScan adds the statement reference only once a payment settles, so recent days are re-read on every
    /// sync to pick up settlements. Unchanged payments are recognised by their event id and ignored.</summary>
    private static readonly TimeSpan SettlementLookback = TimeSpan.FromDays(3);

    private static DateTimeOffset Min(DateTimeOffset a, DateTimeOffset b) => a < b ? a : b;

    public async Task SyncAsync(Guid connectionId, CancellationToken ct)
    {
        await using var conn = await db.OpenAsync(ct);
        var c = await IntegrationRepository.GetForWebhookAsync(conn, connectionId);
        if (c is null || c.Status != "connected") return;
        var adapter = registry.Get(c.ProviderKey);
        if (adapter is not { SupportsPolling: true }) return;

        var cursor = await IntegrationRepository.GetCursorAsync(conn, c.Id);
        var since = cursor is { } cur
            ? Min(new DateTimeOffset(DateTime.SpecifyKind(cur, DateTimeKind.Utc)) - Overlap, clock.UtcNow - SettlementLookback)
            : clock.UtcNow.AddDays(-7);
        try
        {
            var events = await adapter.FetchSinceAsync(c, since, ct);
            var (_, dups) = await ingestion.PersistEventsAsync(conn, c, events, VerificationMethods.ApiConfirmed, "sync");
            var newest = events.Select(e => e.OccurredAt).Where(d => d is not null).Select(d => d!.Value.UtcDateTime).DefaultIfEmpty(since.UtcDateTime).Max();
            await IntegrationRepository.SetCursorAsync(conn, c.Id, newest, events.LastOrDefault()?.ExternalPaymentId);
            await IntegrationRepository.SetSyncResultAsync(conn, c.Id, true, null, null);
            logger.LogInformation("Synced {Provider} connection {ConnectionId}: {Count} event(s), {Dups} already known", c.ProviderKey, c.Id, events.Count, dups);
        }
        catch (Exception ex) when (ex is HttpRequestException or InvalidOperationException or TaskCanceledException or JsonException)
        {
            logger.LogWarning("Sync failed for {Provider} connection {ConnectionId}: {Message}", c.ProviderKey, c.Id, ex.Message);
            const string hint = "Check the API key on the server and the provider's status, then press Test connection.";
            var auth = ex is InvalidOperationException && (ex.Message.Contains("401") || ex.Message.Contains("not configured"));
            await IntegrationRepository.SetSyncResultAsync(conn, c.Id, false, "Sync failed: " + ex.Message, hint, auth);
            await NotificationRepository.NotifyAsync(conn, null, c.BusinessId, Permission.ManageIntegrations, "integration", "warning",
                $"{c.DisplayName}: sync failed", "Payments could not be fetched. " + hint, "/integrations", $"syncfail:{c.Id}:{clock.Today:yyyyMMdd}");
            throw;
        }
    }
}

/// <summary>
/// Durable background worker. Jobs live in PostgreSQL (background_jobs), are claimed with SKIP LOCKED, retried with
/// exponential back-off and moved to 'dead' after the maximum attempts, where a person can retry them.
/// Nothing financial depends on in-memory state.
/// </summary>
public sealed class JobWorker(IServiceProvider services, IDbConnectionFactory db, IClock clock, Microsoft.Extensions.Options.IOptions<AutomationOptions> options,
    ILogger<JobWorker> logger) : BackgroundService
{
    private DateTime _lastSchedule = DateTime.MinValue;
    private DateOnly _lastBriefingDate = DateOnly.MinValue;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!options.Value.EnableWorker)
        {
            logger.LogInformation("Background worker disabled (Automation:EnableWorker=false).");
            return;
        }
        await Task.Yield();
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                if (DateTime.UtcNow - _lastSchedule > TimeSpan.FromSeconds(30)) await ScheduleAsync(stoppingToken);
                var worked = await RunOneAsync(stoppingToken);
                if (!worked) await Task.Delay(TimeSpan.FromMilliseconds(750), stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
            catch (Exception ex)
            {
                logger.LogError(ex, "Background worker loop error; continuing.");
                await Task.Delay(TimeSpan.FromSeconds(5), stoppingToken).ContinueWith(_ => { }, TaskScheduler.Default);
            }
        }
    }

    private async Task ScheduleAsync(CancellationToken ct)
    {
        _lastSchedule = DateTime.UtcNow;
        await using var conn = await db.OpenAsync(ct);
        // Temporary barber statuses whose time is up return to their chosen status (history kept).
        await Barbershop.TeamRepository.ExpireStatusesAsync(conn);
        // House calls whose expected safety check-in is late raise a critical alert for owners and managers.
        await Barbershop.HouseCallSafetyService.MonitorAsync(conn, clock.UtcNow);
        var requeued = await JobQueue.RequeueStaleAsync(conn);
        if (requeued > 0) logger.LogWarning("Re-queued {Count} job(s) left running by a stopped worker.", requeued);

        foreach (var c in await IntegrationRepository.DueForSyncAsync(conn, ProviderKeys.SnapScan, TimeSpan.FromMinutes(options.Value.SnapScanSyncMinutes)))
            await JobQueue.EnqueueAsync(conn, null, JobTypes.SyncConnection, c.BusinessId, $"sync:{c.Id}", new { connectionId = c.Id });

        var today = clock.Today;
        var saHour = clock.UtcNow.ToOffset(TimeSpan.FromHours(2)).Hour;
        if (today != _lastBriefingDate && saHour >= options.Value.BriefingHour)
        {
            _lastBriefingDate = today;
            var businesses = await conn.QueryAsync<Guid>(
                "SELECT DISTINCT business_id FROM transactions WHERE created_at > now() - interval '30 days' UNION SELECT DISTINCT business_id FROM provider_payments WHERE created_at > now() - interval '30 days'");
            foreach (var b in businesses)
                await JobQueue.EnqueueAsync(conn, null, JobTypes.DailyBriefing, b, $"briefing:{b}:{today:yyyyMMdd}", new { businessId = b });
        }
    }

    /// <summary>Claims and runs one job. Returns false when the queue is empty.</summary>
    public async Task<bool> RunOneAsync(CancellationToken ct)
    {
        JobRow? job;
        await using (var conn = await db.OpenAsync(ct)) job = await JobQueue.ClaimAsync(conn);
        if (job is null) return false;

        try
        {
            using var payload = JsonDocument.Parse(job.Payload);
            Guid Arg(string name) => payload.RootElement.GetProperty(name).GetGuid();
            switch (job.JobType)
            {
                case JobTypes.ProcessProviderEvent:
                    await services.GetRequiredService<PaymentIngestionService>().ProcessEventAsync(Arg("eventId"), ct);
                    break;
                case JobTypes.GrowthRefresh:
                    await services.GetRequiredService<GrowthRefresher>().RefreshAsync(Arg("businessId"), ct);
                    break;
                case JobTypes.SyncConnection:
                    await services.GetRequiredService<ProviderSyncService>().SyncAsync(Arg("connectionId"), ct);
                    break;
                case JobTypes.DailyBriefing:
                    // Time passing makes debts overdue and statuses stale, so re-evaluate before the briefing.
                    await services.GetRequiredService<GrowthRefresher>().RefreshAsync(Arg("businessId"), ct);
                    await services.GetRequiredService<BriefingBuilder>().NotifyAsync(Arg("businessId"), ct);
                    break;
                default:
                    throw new InvalidOperationException($"Unknown job type '{job.JobType}'.");
            }
            await using var done = await db.OpenAsync(ct);
            await JobQueue.CompleteAsync(done, job.Id);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw; // left 'running'; re-queued as stale after restart
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Job {JobId} ({JobType}) failed on attempt {Attempt}.", job.Id, job.JobType, job.Attempts);
            await using var conn = await db.OpenAsync(CancellationToken.None);
            string? status;
            try { status = await JobQueue.FailAsync(conn, job.Id, ex.Message); }
            catch (Exception) when (!ct.IsCancellationRequested)
            {
                // A newer waiting job with the same key appeared at the same moment; this one is superseded by it.
                status = "superseded";
                await conn.ExecuteAsync("UPDATE background_jobs SET status = 'superseded', last_error = left(@E, 500), locked_at = NULL, updated_at = now() WHERE id = @Id",
                    new { Id = job.Id, E = ex.Message });
            }
            if (job.JobType == JobTypes.ProcessProviderEvent)
            {
                using var payload = JsonDocument.Parse(job.Payload);
                if (payload.RootElement.TryGetProperty("eventId", out var ev) && ev.TryGetGuid(out var eventId))
                    await conn.ExecuteAsync(
                        "UPDATE provider_events SET processing_status = @S, last_error = left(@E, 500), attempts = attempts + 1 WHERE id = @Id AND processing_status NOT IN ('processed','rejected')",
                        new { Id = eventId, S = status == "dead" ? "dead" : "failed", E = ex.Message });
                if (status == "dead" && job.BusinessId is { } b)
                    await NotificationRepository.NotifyAsync(conn, null, b, Permission.ManageIntegrations, "integration", "warning",
                        "A payment event could not be processed", "It was retried several times. Open the Integrations Centre to retry it.",
                        "/integrations", $"dead:{job.Id}");
            }
        }
        return true;
    }
}
