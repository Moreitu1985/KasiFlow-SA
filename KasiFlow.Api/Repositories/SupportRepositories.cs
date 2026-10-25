using System.Data;
using System.Text.Json;
using Dapper;
using KasiFlow.Api.DTOs;
using KasiFlow.Api.Models;

namespace KasiFlow.Api.Repositories;

public static class ChecklistRepository
{
    public enum List { Registration, Funding }

    private static string Table(List l) => l == List.Registration ? "registration_checklist_items" : "funding_readiness_items";

    public static async Task<IReadOnlyList<ChecklistRow>> GetAsync(IDbConnection conn, List list, Guid businessId) =>
        (await conn.QueryAsync<ChecklistRow>($"SELECT item_key, completed, notes, updated_at FROM {Table(list)} WHERE business_id = @BusinessId",
            new { BusinessId = businessId })).ToList();

    public static Task UpsertAsync(IDbConnection conn, List list, Guid businessId, string key, bool completed, string? notes) =>
        conn.ExecuteAsync(
            $"""
            INSERT INTO {Table(list)} (business_id, item_key, completed, notes, updated_at)
            VALUES (@BusinessId, @Key, @Completed, @Notes, now())
            ON CONFLICT (business_id, item_key) DO UPDATE SET completed = EXCLUDED.completed, notes = EXCLUDED.notes, updated_at = now()
            """, new { BusinessId = businessId, Key = key, Completed = completed, Notes = string.IsNullOrWhiteSpace(notes) ? null : notes.Trim() });

    public static Task<FundingProfileRow?> GetFundingProfileAsync(IDbConnection conn, Guid businessId) =>
        conn.QueryFirstOrDefaultAsync<FundingProfileRow>(
            "SELECT funding_purpose, amount_requested_cents, business_bank_account_status FROM funding_profiles WHERE business_id = @BusinessId",
            new { BusinessId = businessId });

    public static Task UpsertFundingProfileAsync(IDbConnection conn, Guid businessId, FundingProfileDto p) =>
        conn.ExecuteAsync(
            """
            INSERT INTO funding_profiles (business_id, funding_purpose, amount_requested_cents, business_bank_account_status, updated_at)
            VALUES (@BusinessId, @FundingPurpose, @AmountRequestedCents, @BusinessBankAccountStatus, now())
            ON CONFLICT (business_id) DO UPDATE SET funding_purpose = EXCLUDED.funding_purpose,
                amount_requested_cents = EXCLUDED.amount_requested_cents,
                business_bank_account_status = EXCLUDED.business_bank_account_status, updated_at = now()
            """,
            new
            {
                BusinessId = businessId,
                FundingPurpose = string.IsNullOrWhiteSpace(p.FundingPurpose) ? null : p.FundingPurpose.Trim(),
                p.AmountRequestedCents,
                p.BusinessBankAccountStatus
            });

    public static Task SetRegistrationStatusAsync(IDbConnection conn, Guid businessId, string status) =>
        conn.ExecuteAsync("UPDATE businesses SET registration_status = @Status, updated_at = now() WHERE id = @BusinessId",
            new { BusinessId = businessId, Status = status });

    /// <summary>Whether income and expense rows exist in the window (for the 'recent records' readiness item).</summary>
    public static async Task<(bool Income, bool Expense)> RecentActivityAsync(IDbConnection conn, Guid businessId, DateOnly since)
    {
        var types = (await conn.QueryAsync<string>(
            "SELECT DISTINCT type FROM transactions WHERE business_id = @BusinessId AND status = 'posted' AND payment_status IN ('recorded_manually','confirmed_external') AND transaction_date >= @Since",
            new { BusinessId = businessId, Since = since })).ToHashSet();
        return (types.Contains("income"), types.Contains("expense"));
    }
}

public static class PublicProfileRepository
{
    private const string Select = """
        SELECT p.business_id, p.slug, p.is_published, p.description, p.category, p.products_services, p.show_phone,
               p.show_email, p.show_town, p.service_area, p.opening_hours, p.image_url,
               b.name AS business_name, b.province, b.town, b.contact_phone, b.contact_email
        FROM public_profiles p JOIN businesses b ON b.id = p.business_id
        """;

    public static Task<PublicProfileRow?> GetForBusinessAsync(IDbConnection conn, Guid businessId) =>
        conn.QueryFirstOrDefaultAsync<PublicProfileRow>(Select + " WHERE p.business_id = @BusinessId", new { BusinessId = businessId });

    /// <summary>Anonymous lookup. Only published profiles are returned.</summary>
    public static Task<PublicProfileRow?> GetPublishedBySlugAsync(IDbConnection conn, string slug) =>
        conn.QueryFirstOrDefaultAsync<PublicProfileRow>(Select + " WHERE p.slug = @Slug AND p.is_published", new { Slug = slug });

    public static Task<bool> SlugTakenByOtherAsync(IDbConnection conn, string slug, Guid businessId) =>
        conn.ExecuteScalarAsync<bool>("SELECT EXISTS (SELECT 1 FROM public_profiles WHERE slug = @Slug AND business_id <> @BusinessId)",
            new { Slug = slug, BusinessId = businessId });

    public static Task UpsertAsync(IDbConnection conn, Guid businessId, PublicProfileInput i) =>
        conn.ExecuteAsync(
            """
            INSERT INTO public_profiles (business_id, slug, is_published, description, category, products_services, show_phone,
                                         show_email, show_town, service_area, opening_hours, image_url, updated_at)
            VALUES (@BusinessId, @Slug, @IsPublished, @Description, @Category, @ProductsServices, @ShowPhone,
                    @ShowEmail, @ShowTown, @ServiceArea, @OpeningHours, @ImageUrl, now())
            ON CONFLICT (business_id) DO UPDATE SET slug = EXCLUDED.slug, is_published = EXCLUDED.is_published,
                description = EXCLUDED.description, category = EXCLUDED.category, products_services = EXCLUDED.products_services,
                show_phone = EXCLUDED.show_phone, show_email = EXCLUDED.show_email, show_town = EXCLUDED.show_town,
                service_area = EXCLUDED.service_area, opening_hours = EXCLUDED.opening_hours, image_url = EXCLUDED.image_url,
                updated_at = now()
            """,
            new
            {
                BusinessId = businessId, Slug = i.Slug!.Trim(), IsPublished = i.IsPublished ?? false,
                Description = N(i.Description), Category = N(i.Category), ProductsServices = N(i.ProductsServices),
                ShowPhone = i.ShowPhone ?? false, ShowEmail = i.ShowEmail ?? false, ShowTown = i.ShowTown ?? true,
                ServiceArea = N(i.ServiceArea), OpeningHours = N(i.OpeningHours), ImageUrl = N(i.ImageUrl)
            });

    private static string? N(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();
}

public static class OpportunityRepository
{
    private const string Select = """
        SELECT o.id, o.business_id, o.title, o.description, o.organisation, o.opportunity_type, o.industry,
               o.eligibility_criteria, o.required_documents::text AS required_documents, o.application_deadline,
               o.source_url, o.geographic_scope, o.verification_status, o.last_checked_on,
               so.id AS tracking_id, so.application_status, so.notes AS tracking_notes, so.personal_deadline,
               so.updated_at AS tracking_updated_at
        FROM opportunities o
        LEFT JOIN saved_opportunities so ON so.opportunity_id = o.id AND so.business_id = @BusinessId
        WHERE (o.business_id IS NULL OR o.business_id = @BusinessId)
        """;

    public static async Task<IReadOnlyList<OpportunityRow>> ListAsync(IDbConnection conn, Guid businessId, string? type, string? verification, string? search, bool savedOnly) =>
        (await conn.QueryAsync<OpportunityRow>(
            Select + """
                 AND (@Type::text IS NULL OR o.opportunity_type = @Type)
                 AND (@Verification::text IS NULL OR o.verification_status = @Verification)
                 AND (@Search::text IS NULL OR o.title ILIKE @Search OR o.organisation ILIKE @Search OR o.description ILIKE @Search)
                 AND (NOT @SavedOnly OR so.id IS NOT NULL)
                ORDER BY CASE o.verification_status WHEN 'verified_official' THEN 0 WHEN 'requires_verification' THEN 1 ELSE 2 END,
                         o.application_deadline NULLS LAST, o.title
                LIMIT 200
                """,
            new
            {
                BusinessId = businessId, Type = type, Verification = verification, SavedOnly = savedOnly,
                Search = string.IsNullOrWhiteSpace(search) ? null : "%" + LedgerRepository.EscapeLike(search.Trim()) + "%"
            })).ToList();

    public static Task<OpportunityRow?> GetAsync(IDbConnection conn, Guid businessId, Guid id) =>
        conn.QueryFirstOrDefaultAsync<OpportunityRow>(Select + " AND o.id = @Id", new { BusinessId = businessId, Id = id });

    public static Task<Guid> InsertPrivateAsync(IDbConnection conn, Guid businessId, OpportunityInput i) =>
        conn.QuerySingleAsync<Guid>(
            """
            INSERT INTO opportunities (business_id, title, description, organisation, opportunity_type, industry, eligibility_criteria,
                                       required_documents, application_deadline, source_url, geographic_scope, verification_status)
            VALUES (@BusinessId, @Title, @Description, @Organisation, @OpportunityType, @Industry, @EligibilityCriteria,
                    @RequiredDocuments::jsonb, @ApplicationDeadline, @SourceUrl, @GeographicScope, 'requires_verification')
            RETURNING id
            """,
            new
            {
                BusinessId = businessId, Title = i.Title!.Trim(), Description = (i.Description ?? "").Trim(), Organisation = i.Organisation!.Trim(),
                i.OpportunityType, Industry = string.IsNullOrWhiteSpace(i.Industry) ? "any" : i.Industry.Trim(),
                EligibilityCriteria = (i.EligibilityCriteria ?? "").Trim(),
                RequiredDocuments = JsonSerializer.Serialize((i.RequiredDocuments ?? Array.Empty<string>()).Where(d => !string.IsNullOrWhiteSpace(d)).Select(d => d.Trim()).ToArray()),
                i.ApplicationDeadline,
                SourceUrl = string.IsNullOrWhiteSpace(i.SourceUrl) ? null : i.SourceUrl.Trim(),
                GeographicScope = string.IsNullOrWhiteSpace(i.GeographicScope) ? "national" : i.GeographicScope.Trim()
            });

    public static Task SaveAsync(IDbConnection conn, Guid businessId, Guid opportunityId) =>
        conn.ExecuteAsync(
            "INSERT INTO saved_opportunities (business_id, opportunity_id) VALUES (@BusinessId, @OpportunityId) ON CONFLICT (business_id, opportunity_id) DO NOTHING",
            new { BusinessId = businessId, OpportunityId = opportunityId });

    public static Task UpsertTrackingAsync(IDbConnection conn, Guid businessId, Guid opportunityId, TrackingInput t) =>
        conn.ExecuteAsync(
            """
            INSERT INTO saved_opportunities (business_id, opportunity_id, application_status, notes, personal_deadline, updated_at)
            VALUES (@BusinessId, @OpportunityId, @ApplicationStatus, @Notes, @PersonalDeadline, now())
            ON CONFLICT (business_id, opportunity_id) DO UPDATE SET application_status = EXCLUDED.application_status,
                notes = EXCLUDED.notes, personal_deadline = EXCLUDED.personal_deadline, updated_at = now()
            """,
            new
            {
                BusinessId = businessId, OpportunityId = opportunityId, t.ApplicationStatus,
                Notes = string.IsNullOrWhiteSpace(t.Notes) ? null : t.Notes.Trim(), t.PersonalDeadline
            });

    public static Task UnsaveAsync(IDbConnection conn, Guid businessId, Guid opportunityId) =>
        conn.ExecuteAsync("DELETE FROM saved_opportunities WHERE business_id = @BusinessId AND opportunity_id = @OpportunityId",
            new { BusinessId = businessId, OpportunityId = opportunityId });
}

public static class FraudRepository
{
    private const string Columns = "id, incident_type, description, incident_date, related_transaction_id, status, action_taken, private_notes, created_at, updated_at";

    public static async Task<IReadOnlyList<FraudIncidentRow>> ListAsync(IDbConnection conn, Guid businessId, string? status) =>
        (await conn.QueryAsync<FraudIncidentRow>(
            $"SELECT {Columns} FROM fraud_incidents WHERE business_id = @BusinessId AND (@Status::text IS NULL OR status = @Status) ORDER BY incident_date DESC, created_at DESC LIMIT 500",
            new { BusinessId = businessId, Status = status })).ToList();

    public static Task<FraudIncidentRow?> GetAsync(IDbConnection conn, Guid businessId, Guid id) =>
        conn.QueryFirstOrDefaultAsync<FraudIncidentRow>($"SELECT {Columns} FROM fraud_incidents WHERE business_id = @BusinessId AND id = @Id",
            new { BusinessId = businessId, Id = id });

    public static Task<Guid> InsertAsync(IDbConnection conn, Guid businessId, FraudIncidentInput i) =>
        conn.QuerySingleAsync<Guid>(
            """
            INSERT INTO fraud_incidents (business_id, incident_type, description, incident_date, related_transaction_id, status, action_taken, private_notes)
            VALUES (@BusinessId, @IncidentType, @Description, @IncidentDate, @RelatedTransactionId, @Status, @ActionTaken, @PrivateNotes)
            RETURNING id
            """, Params(businessId, Guid.Empty, i));

    public static Task<int> UpdateAsync(IDbConnection conn, Guid businessId, Guid id, FraudIncidentInput i) =>
        conn.ExecuteAsync(
            """
            UPDATE fraud_incidents SET incident_type = @IncidentType, description = @Description, incident_date = @IncidentDate,
                related_transaction_id = @RelatedTransactionId, status = @Status, action_taken = @ActionTaken,
                private_notes = @PrivateNotes, updated_at = now()
            WHERE business_id = @BusinessId AND id = @Id
            """, Params(businessId, id, i));

    private static object Params(Guid businessId, Guid id, FraudIncidentInput i) => new
    {
        BusinessId = businessId, Id = id, i.IncidentType, Description = i.Description!.Trim(), i.IncidentDate,
        i.RelatedTransactionId, Status = i.Status ?? "open",
        ActionTaken = string.IsNullOrWhiteSpace(i.ActionTaken) ? null : i.ActionTaken.Trim(),
        PrivateNotes = string.IsNullOrWhiteSpace(i.PrivateNotes) ? null : i.PrivateNotes.Trim()
    };

    public static Task<bool> TransactionBelongsAsync(IDbConnection conn, Guid businessId, Guid transactionId) =>
        conn.ExecuteScalarAsync<bool>("SELECT EXISTS (SELECT 1 FROM transactions WHERE business_id = @BusinessId AND id = @Id)",
            new { BusinessId = businessId, Id = transactionId });
}
