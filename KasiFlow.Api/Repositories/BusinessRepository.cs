using System.Data;
using Dapper;
using KasiFlow.Api.Data;
using KasiFlow.Api.DTOs;
using KasiFlow.Api.Models;

namespace KasiFlow.Api.Repositories;

public interface IBusinessRepository
{
    Task<Guid?> GetDefaultBusinessIdAsync(Guid userId, CancellationToken ct);
    Task<MembershipRow?> GetMembershipAsync(Guid businessId, Guid userId, CancellationToken ct);
    Task<IReadOnlyList<BusinessRow>> ListForUserAsync(Guid userId, CancellationToken ct);
    Task<BusinessRow?> GetForUserAsync(Guid businessId, Guid userId, CancellationToken ct);
    Task<BusinessRow> CreateAsync(Guid userId, string? email, BusinessInput input, CancellationToken ct);
    Task<BusinessRow?> UpdateForUserAsync(Guid businessId, Guid userId, BusinessInput input, CancellationToken ct);
    Task<SettingsRow> GetSettingsAsync(Guid businessId, CancellationToken ct);
    Task<SettingsRow> UpdateSettingsAsync(Guid businessId, SettingsDto input, CancellationToken ct);
}

/// <summary>Every query filters by the authenticated user's membership. All SQL is parameterised.</summary>
public sealed class BusinessRepository(IDbConnectionFactory db) : IBusinessRepository
{
    private const string BusinessColumns =
        "b.id, b.name, b.business_type, b.owner_name, b.contact_email, b.contact_phone, b.province, b.town, b.registration_status, b.currency, b.created_at, b.updated_at, b.is_demo";

    public async Task<Guid?> GetDefaultBusinessIdAsync(Guid userId, CancellationToken ct)
    {
        await using var conn = await db.OpenAsync(ct);
        return await conn.QueryFirstOrDefaultAsync<Guid?>(
            "SELECT m.business_id FROM business_members m JOIN businesses b ON b.id = m.business_id WHERE m.user_id = @UserId AND m.is_active ORDER BY b.created_at, b.id LIMIT 1",
            new { UserId = userId });
    }

    public async Task<MembershipRow?> GetMembershipAsync(Guid businessId, Guid userId, CancellationToken ct)
    {
        await using var conn = await db.OpenAsync(ct);
        var row = await conn.QueryFirstOrDefaultAsync<MembershipRow>(
            "SELECT m.role, m.is_active, b.is_demo FROM business_members m JOIN businesses b ON b.id = m.business_id WHERE m.business_id = @BusinessId AND m.user_id = @UserId",
            new { BusinessId = businessId, UserId = userId });
        if (row is null) return null;
        row.BranchIds = (await conn.QueryAsync<Guid>(
            "SELECT mb.branch_id FROM member_branches mb JOIN branches br ON br.id = mb.branch_id AND br.is_active WHERE mb.business_id = @BusinessId AND mb.user_id = @UserId",
            new { BusinessId = businessId, UserId = userId })).ToArray();
        return row;
    }

    public async Task<IReadOnlyList<BusinessRow>> ListForUserAsync(Guid userId, CancellationToken ct)
    {
        await using var conn = await db.OpenAsync(ct);
        var rows = await conn.QueryAsync<BusinessRow>(
            $"SELECT {BusinessColumns}, m.role FROM businesses b JOIN business_members m ON m.business_id = b.id WHERE m.user_id = @UserId AND m.is_active ORDER BY b.created_at, b.id",
            new { UserId = userId });
        return rows.ToList();
    }

    public async Task<BusinessRow?> GetForUserAsync(Guid businessId, Guid userId, CancellationToken ct)
    {
        await using var conn = await db.OpenAsync(ct);
        return await conn.QueryFirstOrDefaultAsync<BusinessRow>(
            $"SELECT {BusinessColumns}, m.role FROM businesses b JOIN business_members m ON m.business_id = b.id WHERE b.id = @BusinessId AND m.user_id = @UserId AND m.is_active",
            new { BusinessId = businessId, UserId = userId });
    }

    public async Task<BusinessRow> CreateAsync(Guid userId, string? email, BusinessInput input, CancellationToken ct)
    {
        await using var conn = await db.OpenAsync(ct);
        await using var tx = await conn.BeginTransactionAsync(ct);
        var row = await conn.QuerySingleAsync<BusinessRow>(
            $"""
            INSERT INTO businesses (name, business_type, owner_name, contact_email, contact_phone, province, town, registration_status, created_by)
            VALUES (@Name, @BusinessType, @OwnerName, @ContactEmail, @ContactPhone, @Province, @Town, @RegistrationStatus, @UserId)
            RETURNING {BusinessColumns.Replace("b.", "")}
            """,
            new
            {
                Name = input.Name!.Trim(), BusinessType = input.BusinessType!.Trim(), OwnerName = input.OwnerName!.Trim(),
                ContactEmail = input.ContactEmail!.Trim(), ContactPhone = Clean(input.ContactPhone), input.Province,
                Town = Clean(input.Town), input.RegistrationStatus, UserId = userId
            }, tx);
        await conn.ExecuteAsync("INSERT INTO business_members (business_id, user_id, role, display_name, email) VALUES (@Id, @UserId, 'owner', @Name, @Email)",
            new { row.Id, UserId = userId, Name = input.OwnerName!.Trim(), Email = email }, tx);
        // Every business starts with one branch so branch-scoped staff, shifts and stock work immediately.
        await conn.ExecuteAsync("INSERT INTO branches (business_id, name) VALUES (@Id, 'Main branch')", new { row.Id }, tx);
        row.Role = "owner";
        await conn.ExecuteAsync("INSERT INTO business_settings (business_id) VALUES (@Id)", new { row.Id }, tx);
        await AuditRepository.WriteAsync(conn, tx, row.Id, userId, "business.created", "business", row.Id);
        await tx.CommitAsync(ct);
        return row;
    }

    public async Task<BusinessRow?> UpdateForUserAsync(Guid businessId, Guid userId, BusinessInput input, CancellationToken ct)
    {
        await using var conn = await db.OpenAsync(ct);
        await using var tx = await conn.BeginTransactionAsync(ct);
        var row = await conn.QueryFirstOrDefaultAsync<BusinessRow>(
            $"""
            UPDATE businesses b SET name = @Name, business_type = @BusinessType, owner_name = @OwnerName,
                contact_email = @ContactEmail, contact_phone = @ContactPhone, province = @Province, town = @Town,
                registration_status = @RegistrationStatus, updated_at = now()
            WHERE b.id = @BusinessId
              AND EXISTS (SELECT 1 FROM business_members m WHERE m.business_id = b.id AND m.user_id = @UserId)
            RETURNING {BusinessColumns}, (SELECT m.role FROM business_members m WHERE m.business_id = b.id AND m.user_id = @UserId) AS role
            """,
            new
            {
                BusinessId = businessId, UserId = userId, Name = input.Name!.Trim(), BusinessType = input.BusinessType!.Trim(),
                OwnerName = input.OwnerName!.Trim(), ContactEmail = input.ContactEmail!.Trim(), ContactPhone = Clean(input.ContactPhone),
                input.Province, Town = Clean(input.Town), input.RegistrationStatus
            }, tx);
        if (row is not null)
            await AuditRepository.WriteAsync(conn, tx, businessId, userId, "business.updated", "business", businessId);
        await tx.CommitAsync(ct);
        return row;
    }

    public async Task<SettingsRow> GetSettingsAsync(Guid businessId, CancellationToken ct)
    {
        await using var conn = await db.OpenAsync(ct);
        return await GetSettingsAsync(conn, null, businessId);
    }

    internal static async Task<SettingsRow> GetSettingsAsync(IDbConnection conn, IDbTransaction? tx, Guid businessId)
    {
        // Upsert-then-read keeps older businesses working even if the settings row is missing.
        await conn.ExecuteAsync("INSERT INTO business_settings (business_id) VALUES (@BusinessId) ON CONFLICT (business_id) DO NOTHING",
            new { BusinessId = businessId }, tx);
        return await conn.QuerySingleAsync<SettingsRow>(
            "SELECT business_id, opening_cash_balance_cents, opening_balance_date, cash_buffer_cents, forecast_days, large_tx_multiplier, cashup_variance_threshold_cents, reorder_safety_days, reorder_cover_days, default_lead_time_days FROM business_settings WHERE business_id = @BusinessId",
            new { BusinessId = businessId }, tx);
    }

    public async Task<SettingsRow> UpdateSettingsAsync(Guid businessId, SettingsDto input, CancellationToken ct)
    {
        await using var conn = await db.OpenAsync(ct);
        return await conn.QuerySingleAsync<SettingsRow>(
            """
            INSERT INTO business_settings (business_id, opening_cash_balance_cents, opening_balance_date, cash_buffer_cents, forecast_days,
                large_tx_multiplier, cashup_variance_threshold_cents, reorder_safety_days, reorder_cover_days, default_lead_time_days, updated_at)
            VALUES (@BusinessId, @OpeningCashBalanceCents, @OpeningBalanceDate, @CashBufferCents, @ForecastDays,
                COALESCE(@LargeTxMultiplier, 3.0), COALESCE(@CashupVarianceThresholdCents, 5000), COALESCE(@ReorderSafetyDays, 3),
                COALESCE(@ReorderCoverDays, 14), COALESCE(@DefaultLeadTimeDays, 7), now())
            ON CONFLICT (business_id) DO UPDATE SET
                opening_cash_balance_cents = EXCLUDED.opening_cash_balance_cents,
                opening_balance_date = EXCLUDED.opening_balance_date,
                cash_buffer_cents = EXCLUDED.cash_buffer_cents,
                forecast_days = EXCLUDED.forecast_days,
                large_tx_multiplier = COALESCE(@LargeTxMultiplier, business_settings.large_tx_multiplier),
                cashup_variance_threshold_cents = COALESCE(@CashupVarianceThresholdCents, business_settings.cashup_variance_threshold_cents),
                reorder_safety_days = COALESCE(@ReorderSafetyDays, business_settings.reorder_safety_days),
                reorder_cover_days = COALESCE(@ReorderCoverDays, business_settings.reorder_cover_days),
                default_lead_time_days = COALESCE(@DefaultLeadTimeDays, business_settings.default_lead_time_days),
                updated_at = now()
            RETURNING business_id, opening_cash_balance_cents, opening_balance_date, cash_buffer_cents, forecast_days, large_tx_multiplier, cashup_variance_threshold_cents, reorder_safety_days, reorder_cover_days, default_lead_time_days
            """,
            new { BusinessId = businessId, input.OpeningCashBalanceCents, input.OpeningBalanceDate, input.CashBufferCents, input.ForecastDays,
                input.LargeTxMultiplier, input.CashupVarianceThresholdCents, input.ReorderSafetyDays, input.ReorderCoverDays, input.DefaultLeadTimeDays });
    }

    private static string? Clean(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();
}

public static class AuditRepository
{
    /// <summary>Writes an audit event. <paramref name="details"/> must not contain amounts or personal data.</summary>
    public static Task WriteAsync(IDbConnection conn, IDbTransaction? tx, Guid? businessId, Guid userId, string action, string entityType, Guid? entityId, string detailsJson = "{}") =>
        conn.ExecuteAsync(
            "INSERT INTO audit_events (business_id, user_id, action, entity_type, entity_id, details) VALUES (@BusinessId, @UserId, @Action, @EntityType, @EntityId, @Details::jsonb)",
            new { BusinessId = businessId, UserId = userId, Action = action, EntityType = entityType, EntityId = entityId, Details = detailsJson }, tx);
}
