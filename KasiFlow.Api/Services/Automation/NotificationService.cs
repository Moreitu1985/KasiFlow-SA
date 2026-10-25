using Dapper;
using KasiFlow.Api.Data;
using KasiFlow.Api.DTOs;
using KasiFlow.Api.Middleware;
using KasiFlow.Core.Validation;

namespace KasiFlow.Api.Services.Automation;

/// <summary>In-app notifications for the signed-in member of the current business, plus preferences and the briefing.</summary>
public sealed class NotificationService(IDbConnectionFactory db, IBusinessContext business, BriefingBuilder briefing)
{
    private sealed class Row
    {
        public Guid Id { get; set; }
        public string Kind { get; set; } = "";
        public string Severity { get; set; } = "";
        public string Title { get; set; } = "";
        public string Body { get; set; } = "";
        public string? Link { get; set; }
        public DateTime CreatedAt { get; set; }
        public DateTime? ReadAt { get; set; }
    }

    public async Task<NotificationListDto> ListAsync(bool unreadOnly, CancellationToken ct)
    {
        var access = await business.GetAccessAsync(ct);
        await using var conn = await db.OpenAsync(ct);
        var p = new { B = access.BusinessId, U = access.UserId, Unread = unreadOnly };
        var rows = await conn.QueryAsync<Row>(
            "SELECT id, kind, severity, title, body, link, created_at, read_at FROM notifications WHERE business_id = @B AND user_id = @U AND (NOT @Unread OR read_at IS NULL) ORDER BY created_at DESC LIMIT 50", p);
        var unread = await conn.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM notifications WHERE business_id = @B AND user_id = @U AND read_at IS NULL", p);
        return new NotificationListDto(rows.Select(r => new NotificationDto(r.Id, r.Kind, r.Severity, r.Title, r.Body, r.Link, r.CreatedAt, r.ReadAt)).ToList(), unread);
    }

    public async Task MarkReadAsync(Guid? id, CancellationToken ct)
    {
        var access = await business.GetAccessAsync(ct);
        await using var conn = await db.OpenAsync(ct);
        await conn.ExecuteAsync(
            "UPDATE notifications SET read_at = now() WHERE business_id = @B AND user_id = @U AND read_at IS NULL AND (@Id::uuid IS NULL OR id = @Id::uuid)",
            new { B = access.BusinessId, U = access.UserId, Id = id });
    }

    private sealed class PrefRow
    {
        public string BriefingTime { get; set; } = "07:00";
        public bool InApp { get; set; } = true;
        public bool Email { get; set; }
        public bool CriticalCash { get; set; } = true;
        public bool Cashup { get; set; } = true;
        public bool LowStock { get; set; } = true;
        public bool Integrations { get; set; } = true;
    }

    public async Task<NotificationPreferencesDto> GetPreferencesAsync(CancellationToken ct)
    {
        var access = await business.GetAccessAsync(ct);
        await using var conn = await db.OpenAsync(ct);
        var r = await conn.QueryFirstOrDefaultAsync<PrefRow>(
            "SELECT to_char(briefing_time, 'HH24:MI') AS briefing_time, in_app, email, critical_cash, cashup, low_stock, integrations FROM notification_preferences WHERE business_id = @B AND user_id = @U",
            new { B = access.BusinessId, U = access.UserId }) ?? new PrefRow();
        return ToDto(r);
    }

    private static NotificationPreferencesDto ToDto(PrefRow r) =>
        // Email is shown but unavailable: no email provider is configured, and KasiFlow never sends through an unconfigured service.
        new(r.BriefingTime, r.InApp, false, r.CriticalCash, r.Cashup, r.LowStock, r.Integrations, EmailAvailable: false);

    public async Task<NotificationPreferencesDto> UpdatePreferencesAsync(NotificationPreferencesDto input, CancellationToken ct)
    {
        var access = await business.GetAccessAsync(ct);
        if (!TimeOnly.TryParseExact(input.BriefingTime ?? "", "HH:mm", out var time))
            throw new RequestValidationException(new ValidationErrors().Add("briefingTime", "Use a time like 07:00."));
        if (input.Email) throw new RequestValidationException(new ValidationErrors().Add("email", "Email notifications are not available yet: no email service is configured."));
        await using var conn = await db.OpenAsync(ct);
        await conn.ExecuteAsync(
            """
            INSERT INTO notification_preferences (business_id, user_id, briefing_time, in_app, email, critical_cash, cashup, low_stock, integrations, updated_at)
            VALUES (@B, @U, @Time::time, @InApp, FALSE, @Cash, @Cashup, @Low, @Int, now())
            ON CONFLICT (business_id, user_id) DO UPDATE SET briefing_time = EXCLUDED.briefing_time, in_app = EXCLUDED.in_app, email = FALSE,
                critical_cash = EXCLUDED.critical_cash, cashup = EXCLUDED.cashup, low_stock = EXCLUDED.low_stock, integrations = EXCLUDED.integrations, updated_at = now()
            """, new { B = access.BusinessId, U = access.UserId, Time = time.ToString("HH:mm"), input.InApp, Cash = input.CriticalCash, input.Cashup, Low = input.LowStock, Int = input.Integrations });
        return await GetPreferencesAsync(ct);
    }

    public async Task<BriefingDto> BriefingAsync(CancellationToken ct)
    {
        var access = await business.GetAccessAsync(ct);
        return await briefing.BuildAsync(access.BusinessId, access, ct);
    }
}
