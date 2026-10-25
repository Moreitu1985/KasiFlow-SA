using KasiFlow.Core.Forecasting;

namespace KasiFlow.Core.Growth;

/// <summary>One record or fact that contributed to a recommendation. Always traceable to stored data.</summary>
public sealed record EvidenceItem(string SourceType, Guid? SourceId, string Label, long? AmountCents, DateOnly? Date, string? Detail);

public sealed record RelevantDate(string Label, DateOnly Date);

/// <summary>A recommendation produced by a rule, before it is persisted.</summary>
public sealed record RecommendationDraft(
    string RuleCode,
    string Fingerprint,
    string Title,
    string Severity,
    string Explanation,
    IReadOnlyList<EvidenceItem> Evidence,
    IReadOnlyList<RelevantDate> RelevantDates,
    IReadOnlyList<string> Actions,
    long? EstimatedImpactCents);

/// <summary>Daily expense total used for historical baselines.</summary>
public sealed record DailyExpense(DateOnly Date, string Category, long AmountCents);

/// <summary>Everything the rules need. Built by the API from database records; pure data.</summary>
public sealed record GrowthContext(
    DateOnly Today,
    ForecastResult Forecast,
    long CurrentCashBalanceCents,
    long CashBufferCents,
    bool OpeningBalanceConfigured,
    IReadOnlyList<OpenReceivable> OpenReceivables,
    IReadOnlyList<OpenPayable> OpenPayables,
    IReadOnlyList<DailyExpense> ExpenseHistory,
    DateOnly? LastPostedTransactionDate,
    int PostedTransactionCount,
    IReadOnlyList<UnconfirmedItem> Unconfirmed,
    AnomalySignals? Signals = null);

public interface IGrowthRule
{
    string Code { get; }
    string Name { get; }
    string Description { get; }
    string DefaultSeverity { get; }
    IEnumerable<RecommendationDraft> Evaluate(GrowthContext context);
}

/// <summary>An existing stored recommendation, as needed for de-duplication.</summary>
public sealed record ExistingRecommendation(Guid Id, string Fingerprint, string Status, bool AutoResolved);

public sealed record ReconciliationPlan(
    IReadOnlyList<RecommendationDraft> ToCreate,
    IReadOnlyList<(Guid Id, RecommendationDraft Draft)> ToUpdate,
    IReadOnlyList<Guid> ToAutoResolve);
