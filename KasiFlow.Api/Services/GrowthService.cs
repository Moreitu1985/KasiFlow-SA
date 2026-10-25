using KasiFlow.Api.Data;
using KasiFlow.Core.Access;
using KasiFlow.Api.DTOs;
using KasiFlow.Api.Middleware;
using KasiFlow.Api.Repositories;
using KasiFlow.Api.Validators;
using KasiFlow.Core.Domain;
using KasiFlow.Core.Forecasting;
using KasiFlow.Core.Growth;
using KasiFlow.Core.Validation;

namespace KasiFlow.Api.Services;

/// <summary>Application service around the deterministic Growth Engine: loads records, evaluates the rules
/// and persists recommendations without duplicates.</summary>
public sealed class GrowthService(IDbConnectionFactory db, IBusinessContext business, FinancialSnapshotService snapshots, GrowthEngine engine, Automation.GrowthRefresher refresher)
{
    public async Task<ForecastDto> GetForecastAsync(int? days, CancellationToken ct)
    {
        if (days is { } d && d is < CashFlowForecaster.MinHorizon or > CashFlowForecaster.MaxHorizon)
            throw new RequestValidationException(new ValidationErrors().Add("days", $"Choose between {CashFlowForecaster.MinHorizon} and {CashFlowForecaster.MaxHorizon} days."));
        var access = await business.RequireAsync(Permission.ViewBusinessInsights);
        var businessId = access.BusinessId;
        await using var conn = await db.OpenAsync(ct);
        var snap = await snapshots.LoadAsync(conn, businessId);
        return FinancialSnapshotService.Forecast(snap, days).ToDto();
    }

    /// <summary>Re-evaluates all rules and reconciles stored recommendations. Idempotent: running it twice
    /// with unchanged records creates nothing new.</summary>
    public async Task<RefreshResultDto> RefreshAsync(CancellationToken ct)
    {
        var access = await business.RequireAsync(Permission.ViewBusinessInsights);
        return await refresher.RefreshAsync(access.BusinessId, ct);
    }

    public async Task<IReadOnlyList<RecommendationDto>> ListAsync(string? status, string? severity, CancellationToken ct)
    {
        var e = new ValidationErrors();
        if (status is not null && status != "all") e.OneOf("status", status, RecommendationStatuses.All);
        if (severity is not null) e.OneOf("severity", severity, Severities.All);
        RequestValidationException.ThrowIfInvalid(e);

        await RefreshAsync(ct);
        var access = await business.RequireAsync(Permission.ViewBusinessInsights);
        var businessId = access.BusinessId;
        await using var conn = await db.OpenAsync(ct);
        return (await GrowthRepository.ListAsync(conn, businessId, status, severity)).Select(r => r.ToDto()).ToList();
    }

    public async Task<RecommendationDto> UpdateStatusAsync(Guid id, RecommendationStatusInput input, CancellationToken ct)
    {
        RequestValidationException.ThrowIfInvalid(RequestValidators.RecommendationStatus(input));
        var access = await business.RequireAsync(Permission.ViewBusinessInsights);
        var businessId = access.BusinessId;
        await using var conn = await db.OpenAsync(ct);
        var current = await GrowthRepository.GetAsync(conn, businessId, id) ?? throw new NotFoundException("Recommendation not found.");
        if (current.Status == input.Status) return current.ToDto();
        try
        {
            await GrowthRepository.SetStatusAsync(conn, businessId, id, input.Status!,
                string.IsNullOrWhiteSpace(input.Note) ? null : input.Note.Trim());
        }
        catch (Exception ex) when (PostgresErrors.IsUniqueViolation(ex))
        {
            throw new ConflictException("An open recommendation for the same situation already exists.");
        }
        return (await GrowthRepository.GetAsync(conn, businessId, id))!.ToDto();
    }

    public IReadOnlyList<GrowthRuleDto> Rules() =>
        engine.Rules.Select(r => new GrowthRuleDto(r.Code, r.Name, r.Description, r.DefaultSeverity)).ToList();
}
