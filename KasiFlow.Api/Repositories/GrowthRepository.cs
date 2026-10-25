using System.Data;
using System.Text.Json;
using Dapper;
using KasiFlow.Api.Models;
using KasiFlow.Core.Growth;

namespace KasiFlow.Api.Repositories;

public static class GrowthRepository
{
    public const string AutoResolvedNote = "Automatically resolved: the condition is no longer detected in your records.";

    internal static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    private const string Columns = "id, rule_code, fingerprint, title, severity, explanation, evidence::text AS evidence, relevant_dates::text AS relevant_dates, actions::text AS actions, estimated_impact_cents, status, resolution_note, created_at, updated_at";

    public static async Task<IReadOnlyList<RecommendationRow>> ListAsync(IDbConnection conn, Guid businessId, string? status, string? severity) =>
        (await conn.QueryAsync<RecommendationRow>(
            $"""
            SELECT {Columns} FROM growth_recommendations
            WHERE business_id = @BusinessId
              AND (CASE WHEN @Status::text = 'all' THEN TRUE ELSE status = COALESCE(@Status::text, 'open') END)
              AND (@Severity::text IS NULL OR severity = @Severity)
            ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END, updated_at DESC
            LIMIT 200
            """, new { BusinessId = businessId, Status = status, Severity = severity })).ToList();

    public static Task<RecommendationRow?> GetAsync(IDbConnection conn, Guid businessId, Guid id) =>
        conn.QueryFirstOrDefaultAsync<RecommendationRow>($"SELECT {Columns} FROM growth_recommendations WHERE business_id = @BusinessId AND id = @Id",
            new { BusinessId = businessId, Id = id });

    public static async Task<IReadOnlyList<ExistingRecommendation>> ExistingForReconcileAsync(IDbConnection conn, IDbTransaction tx, Guid businessId, IReadOnlyCollection<string> fingerprints) =>
        (await conn.QueryAsync<ExistingRow>(
            """
            SELECT id, fingerprint, status, (resolution_note = @AutoNote) AS auto_resolved
            FROM growth_recommendations
            WHERE business_id = @BusinessId AND (status = 'open' OR fingerprint = ANY(@Fingerprints))
            """, new { BusinessId = businessId, Fingerprints = fingerprints.ToArray(), AutoNote = AutoResolvedNote }, tx))
        .Select(r => new ExistingRecommendation(r.Id, r.Fingerprint, r.Status, r.AutoResolved ?? false)).ToList();

    public static async Task<bool> InsertAsync(IDbConnection conn, IDbTransaction tx, Guid businessId, RecommendationDraft d) =>
        await conn.ExecuteAsync(
            """
            INSERT INTO growth_recommendations (business_id, rule_code, fingerprint, title, severity, explanation, evidence,
                                                relevant_dates, actions, estimated_impact_cents)
            VALUES (@BusinessId, @RuleCode, @Fingerprint, @Title, @Severity, @Explanation, @Evidence::jsonb,
                    @RelevantDates::jsonb, @Actions::jsonb, @EstimatedImpactCents)
            ON CONFLICT (business_id, fingerprint) WHERE status = 'open' DO NOTHING
            """, Params(businessId, d), tx) > 0;

    public static Task UpdateContentAsync(IDbConnection conn, IDbTransaction tx, Guid businessId, Guid id, RecommendationDraft d) =>
        conn.ExecuteAsync(
            """
            UPDATE growth_recommendations SET title = @Title, severity = @Severity, explanation = @Explanation,
                evidence = @Evidence::jsonb, relevant_dates = @RelevantDates::jsonb, actions = @Actions::jsonb,
                estimated_impact_cents = @EstimatedImpactCents, updated_at = now()
            WHERE business_id = @BusinessId AND id = @Id AND status = 'open'
              AND (title, severity, explanation, evidence, relevant_dates, actions, estimated_impact_cents)
                  IS DISTINCT FROM (@Title, @Severity, @Explanation, @Evidence::jsonb, @RelevantDates::jsonb, @Actions::jsonb, @EstimatedImpactCents)
            """, new
            {
                BusinessId = businessId, Id = id, d.Title, d.Severity, d.Explanation,
                Evidence = JsonSerializer.Serialize(d.Evidence, Json),
                RelevantDates = JsonSerializer.Serialize(d.RelevantDates, Json),
                Actions = JsonSerializer.Serialize(d.Actions, Json),
                d.EstimatedImpactCents
            }, tx);

    public static Task AutoResolveAsync(IDbConnection conn, IDbTransaction tx, Guid businessId, IReadOnlyCollection<Guid> ids) =>
        conn.ExecuteAsync(
            "UPDATE growth_recommendations SET status = 'resolved', resolution_note = @Note, status_changed_at = now(), updated_at = now() WHERE business_id = @BusinessId AND id = ANY(@Ids) AND status = 'open'",
            new { BusinessId = businessId, Ids = ids.ToArray(), Note = AutoResolvedNote }, tx);

    public static Task<int> SetStatusAsync(IDbConnection conn, Guid businessId, Guid id, string status, string? note) =>
        conn.ExecuteAsync(
            "UPDATE growth_recommendations SET status = @Status, resolution_note = @Note, status_changed_at = now(), updated_at = now() WHERE business_id = @BusinessId AND id = @Id",
            new { BusinessId = businessId, Id = id, Status = status, Note = note });

    public static async Task<(int Critical, int Warning, int Informational)> OpenCountsAsync(IDbConnection conn, Guid businessId)
    {
        var rows = await conn.QueryAsync<(string Severity, long Count)>(
            "SELECT severity, COUNT(*) FROM growth_recommendations WHERE business_id = @BusinessId AND status = 'open' GROUP BY severity",
            new { BusinessId = businessId });
        int c = 0, w = 0, i = 0;
        foreach (var (sev, count) in rows)
        {
            if (sev == "critical") c = (int)count;
            else if (sev == "warning") w = (int)count;
            else i = (int)count;
        }
        return (c, w, i);
    }

    private static object Params(Guid businessId, RecommendationDraft d) => new
    {
        BusinessId = businessId, d.RuleCode, d.Fingerprint, d.Title, d.Severity, d.Explanation,
        Evidence = JsonSerializer.Serialize(d.Evidence, Json),
        RelevantDates = JsonSerializer.Serialize(d.RelevantDates, Json),
        Actions = JsonSerializer.Serialize(d.Actions, Json),
        d.EstimatedImpactCents
    };

    private sealed class ExistingRow
    {
        public Guid Id { get; set; }
        public string Fingerprint { get; set; } = "";
        public string Status { get; set; } = "";
        public bool? AutoResolved { get; set; }
    }
}
