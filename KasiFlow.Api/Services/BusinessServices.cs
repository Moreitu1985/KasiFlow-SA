using KasiFlow.Api.Configuration;
using KasiFlow.Api.Data;
using KasiFlow.Core.Access;
using KasiFlow.Api.DTOs;
using KasiFlow.Api.Middleware;
using KasiFlow.Api.Models;
using KasiFlow.Api.Repositories;
using KasiFlow.Api.Validators;
using KasiFlow.Core.Common;
using KasiFlow.Core.Domain;
using KasiFlow.Core.Finance;
using KasiFlow.Core.Readiness;
using KasiFlow.Core.Validation;
using Microsoft.Extensions.Options;

namespace KasiFlow.Api.Services;

public sealed class BusinessService(IBusinessRepository repo, ICurrentUser user, IBusinessContext business, IClock clock)
{
    public const int MaxBusinessesPerUser = 5;

    public async Task<MeDto> MeAsync(CancellationToken ct) =>
        new(user.UserId, user.Email, (await repo.ListForUserAsync(user.UserId, ct)).Select(b => b.ToDto()).ToList());

    public async Task<IReadOnlyList<BusinessDto>> ListAsync(CancellationToken ct) =>
        (await repo.ListForUserAsync(user.UserId, ct)).Select(b => b.ToDto()).ToList();

    public async Task<BusinessDto> GetAsync(Guid id, CancellationToken ct) =>
        (await repo.GetForUserAsync(id, user.UserId, ct) ?? throw new NotFoundException("Business not found.")).ToDto();

    public async Task<BusinessDto> CreateAsync(BusinessInput input, CancellationToken ct)
    {
        RequestValidationException.ThrowIfInvalid(RequestValidators.Business(input));
        var existing = await repo.ListForUserAsync(user.UserId, ct);
        if (existing.Count(b => b.Role == Roles.Owner) >= MaxBusinessesPerUser)
            throw new ConflictException($"You can own up to {MaxBusinessesPerUser} businesses.");
        return (await repo.CreateAsync(user.UserId, user.Email, input, ct)).ToDto();
    }

    public async Task<BusinessDto> UpdateAsync(Guid id, BusinessInput input, CancellationToken ct)
    {
        RequestValidationException.ThrowIfInvalid(RequestValidators.Business(input));
        var m = await repo.GetMembershipAsync(id, user.UserId, ct);
        if (m is null || !m.IsActive) throw new NotFoundException("Business not found.");
        if (!RolePermissions.Has(m.Role, Permission.ManageSettings))
            throw new ForbiddenException($"Your role ({Roles.Label(m.Role)}) does not allow changing the business profile.");
        return (await repo.UpdateForUserAsync(id, user.UserId, input, ct) ?? throw new NotFoundException("Business not found.")).ToDto();
    }

    public async Task<SettingsDto> GetSettingsAsync(CancellationToken ct)
    {
        var access = await business.RequireAsync(Permission.ViewFinancials, Permission.ManageSettings);
        return (await repo.GetSettingsAsync(access.BusinessId, ct)).ToDto();
    }

    public async Task<SettingsDto> UpdateSettingsAsync(SettingsDto input, CancellationToken ct)
    {
        RequestValidationException.ThrowIfInvalid(RequestValidators.Settings(input, clock.Today));
        var access = await business.RequireAsync(Permission.ManageSettings);
        return (await repo.UpdateSettingsAsync(access.BusinessId, input, ct)).ToDto();
    }
}

public sealed class ReadinessService(IDbConnectionFactory db, IBusinessContext business, IBusinessRepository businesses, ICurrentUser user, IClock clock)
{
    public async Task<RegistrationDto> GetRegistrationAsync(CancellationToken ct)
    {
        var access = await business.RequireAsync(Permission.ViewFinancials, Permission.ManageSettings);
        var businessId = access.BusinessId;
        var b = await businesses.GetForUserAsync(businessId, user.UserId, ct) ?? throw new NotFoundException("Business not found.");
        await using var conn = await db.OpenAsync(ct);
        var rows = (await ChecklistRepository.GetAsync(conn, ChecklistRepository.List.Registration, businessId)).ToDictionary(r => r.ItemKey);
        var steps = RegistrationCatalogue.Steps.Select(s =>
        {
            rows.TryGetValue(s.Key, out var r);
            return new RegistrationStepDto(s.Key, s.Title, s.Description, s.AppliesTo,
                s.Resources.Select(x => new ResourceDto(x.Title, x.Url, x.Purpose, x.LastChecked)).ToList(),
                r?.Completed ?? false, r?.Notes, r?.UpdatedAt);
        }).ToList();
        var done = steps.Count(s => s.Completed);
        return new RegistrationDto(b.RegistrationStatus, FundingReadinessCalculator.Percent(done, steps.Count), done, steps.Count,
            RegistrationCatalogue.Disclaimer, steps);
    }

    public async Task<RegistrationDto> UpdateRegistrationItemAsync(string key, ChecklistItemInput input, CancellationToken ct)
    {
        if (!RegistrationCatalogue.IsValidKey(key)) throw new NotFoundException("Checklist item not found.");
        RequestValidationException.ThrowIfInvalid(RequestValidators.Checklist(input));
        var access = await business.RequireAsync(Permission.ManageSettings);
        var businessId = access.BusinessId;
        await using (var conn = await db.OpenAsync(ct))
            await ChecklistRepository.UpsertAsync(conn, ChecklistRepository.List.Registration, businessId, key, input.Completed!.Value, input.Notes);
        return await GetRegistrationAsync(ct);
    }

    public async Task<RegistrationDto> UpdateRegistrationStatusAsync(RegistrationStatusInput input, CancellationToken ct)
    {
        RequestValidationException.ThrowIfInvalid(new ValidationErrors().OneOf("registrationStatus", input.RegistrationStatus, RegistrationStatuses.All));
        var access = await business.RequireAsync(Permission.ManageSettings);
        var businessId = access.BusinessId;
        await using (var conn = await db.OpenAsync(ct))
            await ChecklistRepository.SetRegistrationStatusAsync(conn, businessId, input.RegistrationStatus!);
        return await GetRegistrationAsync(ct);
    }

    public async Task<FundingReadinessDto> GetFundingAsync(CancellationToken ct)
    {
        var access = await business.RequireAsync(Permission.ViewFinancials, Permission.ManageSettings);
        var businessId = access.BusinessId;
        var b = await businesses.GetForUserAsync(businessId, user.UserId, ct) ?? throw new NotFoundException("Business not found.");
        await using var conn = await db.OpenAsync(ct);
        var profile = await ChecklistRepository.GetFundingProfileAsync(conn, businessId) ?? new FundingProfileRow();
        var manual = (await ChecklistRepository.GetAsync(conn, ChecklistRepository.List.Funding, businessId))
            .ToDictionary(r => r.ItemKey, r => (r.Completed, r.Notes));
        var (inc, exp) = await ChecklistRepository.RecentActivityAsync(conn, businessId, clock.Today.AddDays(-89));

        var facts = new FundingFacts(IsProfileComplete(b), b.RegistrationStatus, inc, exp, profile.BusinessBankAccountStatus,
            profile.FundingPurpose, profile.AmountRequestedCents);
        var items = FundingReadinessCalculator.Evaluate(facts, manual);
        var done = items.Count(i => i.Completed);
        return new FundingReadinessDto(FundingReadinessCalculator.Percent(done, items.Count), done, items.Count,
            FundingReadinessCatalogue.Disclaimer,
            new FundingProfileDto(profile.FundingPurpose, profile.AmountRequestedCents, profile.BusinessBankAccountStatus),
            items.Select(i => new FundingItemDto(i.Definition.Key, i.Definition.Title, i.Definition.Description, i.Definition.HowToComplete,
                i.Definition.Automatic ? "automatic" : "manual", i.Completed, i.Notes, i.Definition.AppRoute)).ToList());
    }

    public async Task<FundingReadinessDto> UpdateFundingItemAsync(string key, ChecklistItemInput input, CancellationToken ct)
    {
        var def = FundingReadinessCatalogue.Find(key) ?? throw new NotFoundException("Checklist item not found.");
        if (def.Automatic)
            throw new BadRequestException("This item is completed automatically from your records and cannot be ticked manually.");
        RequestValidationException.ThrowIfInvalid(RequestValidators.Checklist(input));
        var access = await business.RequireAsync(Permission.ManageSettings);
        var businessId = access.BusinessId;
        await using (var conn = await db.OpenAsync(ct))
            await ChecklistRepository.UpsertAsync(conn, ChecklistRepository.List.Funding, businessId, key, input.Completed!.Value, input.Notes);
        return await GetFundingAsync(ct);
    }

    public async Task<FundingReadinessDto> UpdateFundingProfileAsync(FundingProfileDto input, CancellationToken ct)
    {
        RequestValidationException.ThrowIfInvalid(RequestValidators.FundingProfile(input));
        var access = await business.RequireAsync(Permission.ManageSettings);
        var businessId = access.BusinessId;
        await using (var conn = await db.OpenAsync(ct))
            await ChecklistRepository.UpsertFundingProfileAsync(conn, businessId, input);
        return await GetFundingAsync(ct);
    }

    public static bool IsProfileComplete(BusinessRow b) =>
        !string.IsNullOrWhiteSpace(b.Name) && !string.IsNullOrWhiteSpace(b.BusinessType) && !string.IsNullOrWhiteSpace(b.OwnerName)
        && !string.IsNullOrWhiteSpace(b.ContactEmail) && Provinces.IsValid(b.Province);
}

public sealed class PublicProfileService(IDbConnectionFactory db, IBusinessContext business, IBusinessRepository businesses, ICurrentUser user)
{
    public async Task<PublicProfileSettingsDto> GetSettingsAsync(CancellationToken ct)
    {
        var access = await business.RequireAsync(Permission.ManageSettings);
        var businessId = access.BusinessId;
        await using var conn = await db.OpenAsync(ct);
        var p = await PublicProfileRepository.GetForBusinessAsync(conn, businessId);
        if (p is null)
        {
            var b = await businesses.GetForUserAsync(businessId, user.UserId, ct) ?? throw new NotFoundException("Business not found.");
            return new PublicProfileSettingsDto(false, Slug.FromName(b.Name), false, null, b.BusinessType, null, false, false, true,
                b.Town, null, null, null);
        }
        return ToSettings(p);
    }

    public async Task<PublicProfileSettingsDto> UpdateAsync(PublicProfileInput input, CancellationToken ct)
    {
        input = input with { Slug = input.Slug?.Trim().ToLowerInvariant() };
        RequestValidationException.ThrowIfInvalid(RequestValidators.PublicProfile(input));
        var access = await business.RequireAsync(Permission.ManageSettings);
        var businessId = access.BusinessId;
        await using var conn = await db.OpenAsync(ct);
        if (await PublicProfileRepository.SlugTakenByOtherAsync(conn, input.Slug!, businessId))
            throw new ConflictException("That link name is already taken. Try another one.");
        try
        {
            await PublicProfileRepository.UpsertAsync(conn, businessId, input);
        }
        catch (Exception ex) when (PostgresErrors.IsUniqueViolation(ex))
        {
            throw new ConflictException("That link name is already taken. Try another one.");
        }
        await AuditRepository.WriteAsync(conn, null, businessId, user.UserId, "public_profile.updated", "public_profile", businessId);
        return ToSettings((await PublicProfileRepository.GetForBusinessAsync(conn, businessId))!);
    }

    /// <summary>Anonymous. Returns ONLY fields the owner chose to make public; never financial or internal data.</summary>
    public async Task<PublicProfileDto> GetPublicAsync(string slug, CancellationToken ct)
    {
        slug = (slug ?? "").Trim().ToLowerInvariant();
        if (!Slug.IsValid(slug)) throw new NotFoundException("Profile not found.");
        await using var conn = await db.OpenAsync(ct);
        var p = await PublicProfileRepository.GetPublishedBySlugAsync(conn, slug) ?? throw new NotFoundException("Profile not found.");
        return ToPublic(p);
    }

    public static PublicProfileDto ToPublic(PublicProfileRow p) =>
        new(p.Slug, p.BusinessName, p.Description, p.Category, p.ProductsServices, p.Province,
            p.ShowTown ? p.Town : null, p.ServiceArea, p.OpeningHours, p.ImageUrl,
            p.ShowPhone ? p.ContactPhone : null,
            p.ShowEmail ? p.ContactEmail : null);

    private static PublicProfileSettingsDto ToSettings(PublicProfileRow p) =>
        new(true, p.Slug, p.IsPublished, p.Description, p.Category, p.ProductsServices, p.ShowPhone, p.ShowEmail, p.ShowTown,
            p.ServiceArea, p.OpeningHours, p.ImageUrl, "/p/" + p.Slug);
}

public sealed class OpportunityService(IDbConnectionFactory db, IBusinessContext business, ICurrentUser user)
{
    public async Task<IReadOnlyList<OpportunityDto>> ListAsync(string? type, string? verification, string? search, bool savedOnly, CancellationToken ct)
    {
        var e = new ValidationErrors().Optional("search", search, 100);
        if (type is not null) e.OneOf("type", type, OpportunityTypes.All);
        if (verification is not null) e.OneOf("verification", verification, VerificationStatuses.All);
        RequestValidationException.ThrowIfInvalid(e);
        var access = await business.RequireAsync(Permission.ViewFinancials, Permission.ManageSettings);
        var businessId = access.BusinessId;
        await using var conn = await db.OpenAsync(ct);
        return (await OpportunityRepository.ListAsync(conn, businessId, type, verification, search, savedOnly)).Select(o => o.ToDto()).ToList();
    }

    public async Task<OpportunityDto> GetAsync(Guid id, CancellationToken ct)
    {
        var access = await business.RequireAsync(Permission.ViewFinancials, Permission.ManageSettings);
        var businessId = access.BusinessId;
        await using var conn = await db.OpenAsync(ct);
        return (await OpportunityRepository.GetAsync(conn, businessId, id) ?? throw new NotFoundException("Opportunity not found.")).ToDto();
    }

    public async Task<OpportunityDto> CreatePrivateAsync(OpportunityInput input, CancellationToken ct)
    {
        RequestValidationException.ThrowIfInvalid(RequestValidators.Opportunity(input));
        var access = await business.RequireAsync(Permission.ManageSettings);
        var businessId = access.BusinessId;
        await using var conn = await db.OpenAsync(ct);
        var id = await OpportunityRepository.InsertPrivateAsync(conn, businessId, input);
        await AuditRepository.WriteAsync(conn, null, businessId, user.UserId, "opportunity.created", "opportunity", id);
        return (await OpportunityRepository.GetAsync(conn, businessId, id))!.ToDto();
    }

    public async Task<OpportunityDto> SaveAsync(Guid id, CancellationToken ct)
    {
        var access = await business.RequireAsync(Permission.ManageSettings);
        var businessId = access.BusinessId;
        await using var conn = await db.OpenAsync(ct);
        _ = await OpportunityRepository.GetAsync(conn, businessId, id) ?? throw new NotFoundException("Opportunity not found.");
        await OpportunityRepository.SaveAsync(conn, businessId, id);
        return (await OpportunityRepository.GetAsync(conn, businessId, id))!.ToDto();
    }

    public async Task<OpportunityDto> TrackAsync(Guid id, TrackingInput input, CancellationToken ct)
    {
        RequestValidationException.ThrowIfInvalid(RequestValidators.Tracking(input));
        var access = await business.RequireAsync(Permission.ManageSettings);
        var businessId = access.BusinessId;
        await using var conn = await db.OpenAsync(ct);
        _ = await OpportunityRepository.GetAsync(conn, businessId, id) ?? throw new NotFoundException("Opportunity not found.");
        await OpportunityRepository.UpsertTrackingAsync(conn, businessId, id, input);
        return (await OpportunityRepository.GetAsync(conn, businessId, id))!.ToDto();
    }

    public async Task UnsaveAsync(Guid id, CancellationToken ct)
    {
        var access = await business.RequireAsync(Permission.ManageSettings);
        var businessId = access.BusinessId;
        await using var conn = await db.OpenAsync(ct);
        _ = await OpportunityRepository.GetAsync(conn, businessId, id) ?? throw new NotFoundException("Opportunity not found.");
        await OpportunityRepository.UnsaveAsync(conn, businessId, id);
    }
}

public sealed class FraudService(IDbConnectionFactory db, IBusinessContext business, ICurrentUser user, IClock clock)
{
    public async Task<IReadOnlyList<FraudIncidentDto>> ListAsync(string? status, CancellationToken ct)
    {
        if (status is not null) RequestValidationException.ThrowIfInvalid(new ValidationErrors().OneOf("status", status, FraudIncidentStatuses.All));
        var access = await business.RequireAsync(Permission.ViewFraud);
        var businessId = access.BusinessId;
        await using var conn = await db.OpenAsync(ct);
        return (await FraudRepository.ListAsync(conn, businessId, status)).Select(f => f.ToDto()).ToList();
    }

    public async Task<FraudIncidentDto> GetAsync(Guid id, CancellationToken ct)
    {
        var access = await business.RequireAsync(Permission.ViewFraud);
        var businessId = access.BusinessId;
        await using var conn = await db.OpenAsync(ct);
        return (await FraudRepository.GetAsync(conn, businessId, id) ?? throw new NotFoundException("Incident not found.")).ToDto();
    }

    public async Task<FraudIncidentDto> CreateAsync(FraudIncidentInput input, CancellationToken ct)
    {
        RequestValidationException.ThrowIfInvalid(RequestValidators.Fraud(input, clock.Today));
        var access = await business.RequireAsync(Permission.ManageFraud, Permission.RecordSales);
        var businessId = access.BusinessId;
        await using var conn = await db.OpenAsync(ct);
        await EnsureTransactionAsync(conn, businessId, input.RelatedTransactionId);
        var id = await FraudRepository.InsertAsync(conn, businessId, input);
        await AuditRepository.WriteAsync(conn, null, businessId, user.UserId, "fraud_incident.created", "fraud_incident", id);
        return (await FraudRepository.GetAsync(conn, businessId, id))!.ToDto();
    }

    public async Task<FraudIncidentDto> UpdateAsync(Guid id, FraudIncidentInput input, CancellationToken ct)
    {
        RequestValidationException.ThrowIfInvalid(RequestValidators.Fraud(input, clock.Today));
        var access = await business.RequireAsync(Permission.ManageFraud);
        var businessId = access.BusinessId;
        await using var conn = await db.OpenAsync(ct);
        await EnsureTransactionAsync(conn, businessId, input.RelatedTransactionId);
        if (await FraudRepository.UpdateAsync(conn, businessId, id, input) == 0) throw new NotFoundException("Incident not found.");
        await AuditRepository.WriteAsync(conn, null, businessId, user.UserId, "fraud_incident.updated", "fraud_incident", id);
        return (await FraudRepository.GetAsync(conn, businessId, id))!.ToDto();
    }

    /// <summary>A related transaction must belong to the same business (prevents cross-business references).</summary>
    private static async Task EnsureTransactionAsync(System.Data.IDbConnection conn, Guid businessId, Guid? transactionId)
    {
        if (transactionId is { } t && !await FraudRepository.TransactionBelongsAsync(conn, businessId, t))
            throw new RequestValidationException(new ValidationErrors().Add("relatedTransactionId", "Transaction not found."));
    }
}

/// <summary>Builds absolute public-profile links when a public web URL is configured.</summary>
public sealed class PublicLinks(IOptions<AppOptions> options)
{
    public string? ProfileUrl(string slug) =>
        string.IsNullOrWhiteSpace(options.Value.PublicWebBaseUrl) ? null : options.Value.PublicWebBaseUrl.TrimEnd('/') + "/p/" + slug;
}
