using KasiFlow.Core.Domain;

namespace KasiFlow.Core.Growth;

/// <summary>
/// The KasiFlow Growth Engine: runs deterministic rules over recorded data and returns explainable
/// recommendation drafts. It performs no I/O and uses no AI model, so every output is reproducible
/// from the same inputs. An explainability assistant can later be layered on top of the drafts
/// without touching these calculations.
/// </summary>
public sealed class GrowthEngine
{
    private readonly IReadOnlyList<IGrowthRule> _rules;

    public GrowthEngine(IEnumerable<IGrowthRule> rules) => _rules = rules.ToList();

    public static GrowthEngine CreateDefault() => new(DefaultRules());

    public static IReadOnlyList<IGrowthRule> DefaultRules() => new IGrowthRule[]
    {
        new CashShortfallRule(),
        new BelowBufferRule(),
        new RelianceOnCollectionsRule(),
        new OverdueReceivablesRule(),
        new OverdueBillsRule(),
        new BillsDueSoonRule(),
        new ExpenseSpikeRule(),
        new DebtConcentrationRule(),
        new DataQualityRule(),
        new DuplicateEventsRule(),
        new PaymentFailuresRule(),
        new UnusualRefundsRule(),
        new LargeTransactionRule(),
        new CashUpVarianceRule(),
        new StockAdjustmentRule(),
        new IntegrationChangeRule(),
        new DuplicateExpenseRule(),
        new BookingPaymentMismatchRule(),
        new UnverifiedProofRule(),
        new SupplierBankChangeRule(),
        new FinancialRecordChangesRule(),
        new FailedCollectionsRule(),
        new HouseCallFeeRule(),
        new StrongestServicesRule(),
        new LowStockReorderRule(),
    };

    public IReadOnlyList<IGrowthRule> Rules => _rules;

    public IReadOnlyList<RecommendationDraft> Evaluate(GrowthContext context)
    {
        var drafts = new List<RecommendationDraft>();
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var rule in _rules)
        {
            foreach (var d in rule.Evaluate(context))
            {
                if (seen.Add(d.Fingerprint)) drafts.Add(d);
            }
        }
        return drafts
            .OrderByDescending(d => Severities.Rank(d.Severity))
            .ThenBy(d => d.RuleCode, StringComparer.Ordinal)
            .ToList();
    }

    /// <summary>
    /// Decides how to persist a fresh evaluation without creating duplicates:
    /// <list type="bullet">
    /// <item>Same situation already open → update its content (no new row).</item>
    /// <item>Same situation previously dismissed, or resolved by the user → respect that and do nothing.</item>
    /// <item>Same situation previously auto-resolved (condition had cleared) and now back → create a new one.</item>
    /// <item>New situation → create.</item>
    /// <item>Open recommendation no longer detected → auto-resolve.</item>
    /// </list>
    /// </summary>
    public static ReconciliationPlan Reconcile(IReadOnlyList<RecommendationDraft> drafts, IReadOnlyList<ExistingRecommendation> existing)
    {
        var open = existing.Where(e => e.Status == RecommendationStatuses.Open)
            .GroupBy(e => e.Fingerprint, StringComparer.Ordinal)
            .ToDictionary(g => g.Key, g => g.First(), StringComparer.Ordinal);
        var suppressed = existing
            .Where(e => e.Status == RecommendationStatuses.Dismissed || (e.Status == RecommendationStatuses.Resolved && !e.AutoResolved))
            .Select(e => e.Fingerprint)
            .ToHashSet(StringComparer.Ordinal);

        var create = new List<RecommendationDraft>();
        var update = new List<(Guid, RecommendationDraft)>();
        var current = new HashSet<string>(StringComparer.Ordinal);

        foreach (var d in drafts)
        {
            if (!current.Add(d.Fingerprint)) continue;
            if (open.TryGetValue(d.Fingerprint, out var match)) update.Add((match.Id, d));
            else if (!suppressed.Contains(d.Fingerprint)) create.Add(d);
        }

        var autoResolve = open.Values.Where(o => !current.Contains(o.Fingerprint)).Select(o => o.Id).ToList();
        return new ReconciliationPlan(create, update, autoResolve);
    }
}
