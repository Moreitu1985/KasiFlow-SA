using KasiFlow.Core.Domain;
using KasiFlow.Core.Forecasting;
using KasiFlow.Core.Growth;
using static KasiFlow.Api.Tests.Core.TestData;

namespace KasiFlow.Api.Tests.Core;

public class GrowthEngineTests
{
    private static readonly GrowthEngine Engine = GrowthEngine.CreateDefault();

    [Fact]
    public void Cash_shortage_recommendation_is_explainable_and_traceable()
    {
        var input = BarberScenario(out var expected, out var supplierBill, out var otherBill);
        var drafts = Engine.Evaluate(Context(input));
        var rec = Assert.Single(drafts, d => d.RuleCode == "CASH_SHORTFALL");

        Assert.Equal(Severities.Critical, rec.Severity);
        Assert.Equal("Potential cash shortage in 5 days", rec.Title);
        Assert.Contains("-R500.00", rec.Explanation);
        // Evidence points at the exact records that caused it.
        Assert.Contains(rec.Evidence, e => e.SourceId == supplierBill.Id && e.AmountCents == -150_000);
        Assert.Contains(rec.Evidence, e => e.SourceId == otherBill.Id);
        Assert.Contains(rec.Evidence, e => e.SourceId == expected.Id && e.Detail!.Contains("AFTER"));
        Assert.Contains(rec.RelevantDates, d => d.Date == Day(5));
        Assert.Equal(50_000, rec.EstimatedImpactCents);
        Assert.Contains(rec.Actions, a => a.Contains("payment arrangement"));
        Assert.DoesNotContain(rec.Actions, a => a.Contains("guarantee", StringComparison.OrdinalIgnoreCase));
        // Shortage wins over the buffer warning for the same situation.
        Assert.DoesNotContain(drafts, d => d.RuleCode == "BELOW_BUFFER");
    }

    [Fact]
    public void Healthy_business_gets_no_cash_warnings()
    {
        var drafts = Engine.Evaluate(Context(Input(500_000, buffer: 10_000, payables: [Payable(20_000, 10)])));
        Assert.DoesNotContain(drafts, d => d.RuleCode is "CASH_SHORTFALL" or "BELOW_BUFFER" or "RELIES_ON_COLLECTIONS");
    }

    [Fact]
    public void Below_buffer_warning_when_positive_but_under_buffer()
    {
        var drafts = Engine.Evaluate(Context(Input(60_000, buffer: 50_000, payables: [Payable(20_000, 2)])));
        var rec = Assert.Single(drafts, d => d.RuleCode == "BELOW_BUFFER");
        Assert.Equal(Severities.Warning, rec.Severity);
        Assert.Equal(10_000, rec.EstimatedImpactCents);
    }

    [Fact]
    public void Reliance_on_unconfirmed_collections_is_flagged()
    {
        var drafts = Engine.Evaluate(Context(Input(10_000, receivables: [Receivable(50_000, 2)], payables: [Payable(30_000, 4)])));
        Assert.DoesNotContain(drafts, d => d.RuleCode == "CASH_SHORTFALL");
        var rec = Assert.Single(drafts, d => d.RuleCode == "RELIES_ON_COLLECTIONS");
        Assert.Contains("-R200.00", rec.Explanation);
    }

    [Fact]
    public void Overdue_customer_debts_are_listed_with_days_overdue()
    {
        var r = Receivable(40_000, -10, "Sipho M.");
        var rec = Assert.Single(Engine.Evaluate(Context(Input(100_000, receivables: [r]))), d => d.RuleCode == "OVERDUE_RECEIVABLES");
        Assert.Equal(40_000, rec.EstimatedImpactCents);
        var ev = Assert.Single(rec.Evidence);
        Assert.Equal(r.Id, ev.SourceId);
        Assert.Equal("10 days overdue", ev.Detail);
    }

    [Fact]
    public void Bills_due_soon_escalate_when_cash_does_not_cover_them()
    {
        var covered = Engine.Evaluate(Context(Input(100_000, payables: [Payable(50_000, 2)]))).Single(d => d.RuleCode == "BILLS_DUE_SOON");
        Assert.Equal(Severities.Informational, covered.Severity);
        var short_ = Engine.Evaluate(Context(Input(10_000, payables: [Payable(50_000, 2)]))).Single(d => d.RuleCode == "BILLS_DUE_SOON");
        Assert.Equal(Severities.Warning, short_.Severity);
    }

    [Fact]
    public void Expense_spike_needs_enough_history_and_says_so()
    {
        // Only recent expenses: insufficient history → no spike, but a data-quality note.
        var thin = new List<DailyExpense> { new(Day(-2), "Rent", 500_000) };
        var drafts = Engine.Evaluate(Context(Input(1_000_000), thin));
        Assert.DoesNotContain(drafts, d => d.RuleCode == "EXPENSE_SPIKE");
        var dq = Assert.Single(drafts, d => d.RuleCode == "DATA_QUALITY");
        Assert.Contains(dq.Evidence, e => e.Label.Contains("expense history"));
    }

    [Fact]
    public void Expense_spike_detected_against_baseline()
    {
        var history = new List<DailyExpense>();
        for (var w = 1; w <= 3; w++) history.Add(new DailyExpense(Day(-30 * w - 5), "Stock & supplies", 100_000));
        history.Add(new DailyExpense(Day(-3), "Stock & supplies", 120_000));
        history.Add(new DailyExpense(Day(-2), "Equipment", 100_000));
        var rec = Assert.Single(Engine.Evaluate(Context(Input(1_000_000), history)), d => d.RuleCode == "EXPENSE_SPIKE");
        Assert.Equal("Spending is 120% higher than usual", rec.Title);
        Assert.Equal(120_000, rec.EstimatedImpactCents);
    }

    [Fact]
    public void Debt_concentration_flags_dominant_customer()
    {
        var big = Guid.NewGuid();
        var input = Input(100_000, receivables: [Receivable(90_000, 5, "Big", big), Receivable(10_000, 5, "Small")]);
        var rec = Assert.Single(Engine.Evaluate(Context(input)), d => d.RuleCode == "DEBT_CONCENTRATION");
        Assert.Contains("90%", rec.Title);
        Assert.Equal($"DEBT_CONCENTRATION:{big}", rec.Fingerprint);
    }

    [Fact]
    public void Missing_opening_balance_is_reported()
    {
        var drafts = Engine.Evaluate(Context(Input(0, openingConfigured: false), postedCount: 0, lastPosted: null));
        var dq = Assert.Single(drafts, d => d.RuleCode == "DATA_QUALITY");
        Assert.Contains(dq.Evidence, e => e.Label.Contains("Opening cash balance"));
        Assert.Contains(dq.Evidence, e => e.Label.Contains("No transactions"));
    }

    [Fact]
    public void Evaluation_is_deterministic_and_fingerprints_are_stable()
    {
        var input = BarberScenario(out _, out _, out _);
        var a = Engine.Evaluate(Context(input)).Select(d => d.Fingerprint).ToList();
        var b = Engine.Evaluate(Context(input)).Select(d => d.Fingerprint).ToList();
        Assert.Equal(string.Join(",", a), string.Join(",", b));
        Assert.Equal(a.Count, a.Distinct().Count());
    }

    // ---- duplicate prevention / reconciliation ----

    private static RecommendationDraft Draft(string fp) =>
        new("X", fp, "t", Severities.Warning, "e", [], [], [], null);

    [Fact]
    public void Reconcile_updates_existing_open_instead_of_duplicating()
    {
        var id = Guid.NewGuid();
        var plan = GrowthEngine.Reconcile([Draft("A")], [new ExistingRecommendation(id, "A", RecommendationStatuses.Open, false)]);
        Assert.Empty(plan.ToCreate);
        Assert.Equal(id, Assert.Single(plan.ToUpdate).Id);
        Assert.Empty(plan.ToAutoResolve);
    }

    [Fact]
    public void Reconcile_respects_dismissed_and_user_resolved()
    {
        var plan = GrowthEngine.Reconcile([Draft("A"), Draft("B")],
        [
            new ExistingRecommendation(Guid.NewGuid(), "A", RecommendationStatuses.Dismissed, false),
            new ExistingRecommendation(Guid.NewGuid(), "B", RecommendationStatuses.Resolved, false),
        ]);
        Assert.Empty(plan.ToCreate);
    }

    [Fact]
    public void Reconcile_recreates_after_auto_resolution_and_auto_resolves_cleared()
    {
        var stale = Guid.NewGuid();
        var plan = GrowthEngine.Reconcile([Draft("A"), Draft("A"), Draft("C")],
        [
            new ExistingRecommendation(Guid.NewGuid(), "A", RecommendationStatuses.Resolved, true),
            new ExistingRecommendation(stale, "OLD", RecommendationStatuses.Open, false),
        ]);
        Assert.Equal(2, plan.ToCreate.Count); // A once (deduplicated within the batch) + C
        Assert.Equal(stale, Assert.Single(plan.ToAutoResolve));
    }

    [Fact]
    public void Rules_catalogue_is_complete()
    {
        var codes = Engine.Rules.Select(r => r.Code).ToList();
        Assert.Equal(codes.Count, codes.Distinct().Count());
        Assert.Contains("CASH_SHORTFALL", codes);
        Assert.All(Engine.Rules, r => Assert.True(Severities.All.Contains(r.DefaultSeverity)));
    }
}
