using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using KasiFlow.Core.Access;
using KasiFlow.Core.Domain;
using KasiFlow.Core.Forecasting;
using KasiFlow.Core.Growth;
using KasiFlow.Core.Integrations;
using KasiFlow.Core.Inventory;
using static KasiFlow.Api.Tests.Core.TestData;

namespace KasiFlow.Api.Tests.Core;

public class PaymentLifecycleTests
{
    [Theory]
    [InlineData(null, "pending", TransitionResult.Created)]
    [InlineData("pending", "completed", TransitionResult.Advanced)]
    [InlineData("pending", "failed", TransitionResult.Advanced)]
    [InlineData("completed", "reversed", TransitionResult.Advanced)]
    [InlineData("completed", "completed", TransitionResult.NoChange)]   // duplicate delivery
    [InlineData("completed", "pending", TransitionResult.NoChange)]     // late, out-of-order delivery
    [InlineData("failed", "completed", TransitionResult.NoChange)]      // failed is final
    [InlineData("reversed", "completed", TransitionResult.NoChange)]    // reversed is final
    public void Status_only_moves_forward(string? current, string incoming, TransitionResult expected) =>
        Assert.Equal(expected, PaymentStateMachine.Apply(current, incoming));

    [Fact]
    public void Unknown_status_is_rejected() =>
        Assert.Throws<ArgumentException>(() => PaymentStateMachine.Apply(null, "maybe"));

    [Theory]
    [InlineData("pending", false)]
    [InlineData("completed", true)]
    [InlineData("failed", false)]
    [InlineData("reversed", false)]
    public void Only_completed_payments_count_as_income(string status, bool counts) =>
        Assert.Equal(counts, PaymentStateMachine.CountsAsIncome(status));
}

public class ReconciliationPolicyTests
{
    private static LedgerCandidate C(long amount, int day = 0, string? reference = null, string method = PaymentMethods.MobilePayment, bool linked = false) =>
        new(Guid.NewGuid(), amount, Day(day), reference, method, linked);

    [Fact]
    public void Exact_reference_and_amount_auto_matches()
    {
        var target = C(14_500, reference: "QR-7781");
        var d = ReconciliationPolicy.Decide(14_500, Today, "qr-7781", [target, C(14_500)]);
        Assert.Equal(MatchDecisionKind.AutoMatchExactReference, d.Kind);
        Assert.Equal(target.TransactionId, d.TransactionId);
    }

    [Fact]
    public void Reference_with_different_amount_is_never_forced()
    {
        var d = ReconciliationPolicy.Decide(14_500, Today, "QR-7781", [C(14_000, reference: "QR-7781")]);
        Assert.Equal(MatchDecisionKind.NeedsReview, d.Kind);
        Assert.Null(d.TransactionId);
    }

    [Fact]
    public void Ambiguous_reference_needs_review()
    {
        var d = ReconciliationPolicy.Decide(5_000, Today, "R1", [C(5_000, reference: "R1"), C(5_000, reference: "R1")]);
        Assert.Equal(MatchDecisionKind.NeedsReview, d.Kind);
        Assert.Equal(2, d.Suggestions.Count);
    }

    [Fact]
    public void Same_amount_same_day_is_only_a_suggestion()
    {
        var d = ReconciliationPolicy.Decide(6_000, Today, null, [C(6_000, method: PaymentMethods.Card)]);
        Assert.Equal(MatchDecisionKind.NeedsReview, d.Kind);
        Assert.True(d.Suggestions[0].Confidence < 1m);
    }

    [Fact]
    public void Cash_sales_and_distant_dates_are_not_candidates()
    {
        var d = ReconciliationPolicy.Decide(6_000, Today, null, [C(6_000, method: PaymentMethods.Cash), C(6_000, day: -3)]);
        Assert.Equal(MatchDecisionKind.CreateSale, d.Kind);
    }

    [Fact]
    public void Already_linked_transactions_are_ignored()
    {
        var d = ReconciliationPolicy.Decide(6_000, Today, "X", [C(6_000, reference: "X", linked: true)]);
        Assert.Equal(MatchDecisionKind.CreateSale, d.Kind);
    }
}

public class CashUpTests
{
    [Fact]
    public void Expected_cash_uses_only_cash_movements()
    {
        var expected = CashUp.Expected(50_000,
        [
            new(CashUp.Kinds.CashSale, 16_500), new(CashUp.Kinds.CashRefund, 2_000), new(CashUp.Kinds.PaidOut, 1_000),
            new(CashUp.Kinds.CashDrop, 10_000), new(CashUp.Kinds.FloatTopUp, 5_000)
        ]);
        Assert.Equal(50_000 + 16_500 - 2_000 - 1_000 - 10_000 + 5_000, expected);
    }

    [Fact]
    public void Variance_sign_and_review_threshold()
    {
        Assert.Equal(-6_500, CashUp.Variance(50_000, 56_500));
        Assert.True(CashUp.NeedsReview(-6_500, 5_000));
        Assert.True(CashUp.NeedsReview(5_000, 5_000));
        Assert.False(CashUp.NeedsReview(4_999, 5_000));
    }

    [Fact]
    public void Negative_amounts_are_rejected() =>
        Assert.Throws<ArgumentOutOfRangeException>(() => CashUp.Expected(0, [new(CashUp.Kinds.CashSale, -1)]));
}

public class ReorderTests
{
    [Fact]
    public void Low_stock_suggests_quantity_with_visible_assumptions()
    {
        var s = ReorderCalculator.Calculate(new ReorderInput(Guid.NewGuid(), "Beard oil", OnHand: 4, MinStock: 4, LeadTimeDays: 7,
            UnitsSoldInWindow: 15, WindowDays: 30, SafetyDays: 3, CoverDays: 14, DefaultLeadTimeDays: 7));
        Assert.True(s.IsLowStock);
        Assert.Equal(0.5m, s.AverageDailySales);
        Assert.Equal(5, s.ReorderPoint);               // ceil(0.5 × (7 + 3))
        Assert.Equal(5 + 7 - 4, s.SuggestedQuantity);    // target = 5 + ceil(0.5 × 14)
        Assert.Contains(s.Assumptions, a => a.Contains("lead time", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public void Enough_stock_suggests_nothing()
    {
        var s = ReorderCalculator.Calculate(new ReorderInput(Guid.NewGuid(), "Pomade", 40, 5, null, 10, 30, 3, 14, 7));
        Assert.False(s.IsLowStock);
        Assert.Equal(0, s.SuggestedQuantity);
        Assert.Contains(s.Assumptions, a => a.Contains("default"));
    }

    [Fact]
    public void No_sales_history_falls_back_to_minimum_and_says_so()
    {
        var s = ReorderCalculator.Calculate(new ReorderInput(Guid.NewGuid(), "New item", 1, 3, 5, 0, 30, 3, 14, 7));
        Assert.True(s.InsufficientHistory);
        Assert.True(s.IsLowStock);
        Assert.Equal(5, s.SuggestedQuantity); // max(target 3, min×2 = 6) − 1
    }
}

public class WebhookSignatureTests
{
    private static string Sign(string key, byte[] body) => Convert.ToHexString(HMACSHA256.HashData(Encoding.UTF8.GetBytes(key), body)).ToLowerInvariant();

    [Fact]
    public void SnapScan_signature_verifies_raw_body()
    {
        var body = Encoding.UTF8.GetBytes("payload=%7B%22id%22%3A1%7D");
        Assert.True(WebhookSignatures.VerifySnapScan("whk", body, "SnapScan signature=" + Sign("whk", body)));
        Assert.False(WebhookSignatures.VerifySnapScan("other", body, "SnapScan signature=" + Sign("whk", body)));
        Assert.False(WebhookSignatures.VerifySnapScan("whk", [.. body, (byte)' '], "SnapScan signature=" + Sign("whk", body)));
        Assert.False(WebhookSignatures.VerifySnapScan("whk", body, "Bearer " + Sign("whk", body)));
        Assert.False(WebhookSignatures.VerifySnapScan("whk", body, null));
    }

    [Fact]
    public void Sandbox_signature_round_trips_and_rejects_tampering()
    {
        var key = RandomNumberGenerator.GetBytes(32);
        var body = Encoding.UTF8.GetBytes("{\"a\":1}");
        var sig = WebhookSignatures.SignSandbox(key, body);
        Assert.True(WebhookSignatures.VerifySandbox(key, body, sig));
        Assert.False(WebhookSignatures.VerifySandbox(key, Encoding.UTF8.GetBytes("{\"a\":2}"), sig));
        Assert.False(WebhookSignatures.VerifySandbox(RandomNumberGenerator.GetBytes(32), body, sig));
    }
}

public class SnapScanMapperTests
{
    [Fact]
    public void Maps_documented_payment_fields_without_inventing_fees()
    {
        using var doc = JsonDocument.Parse("""
            {"id": 9002, "status": "completed", "date": "2026-10-16T09:00:00Z", "totalAmount": 12000, "tipAmount": 1000,
             "merchantReference": "INV-1", "statementReference": "STMT-777", "deviceSerialNumber": "SPEED-1", "transactionType": "payment"}
            """);
        var e = SnapScanMapper.FromPayment(doc.RootElement);
        Assert.Equal("payment:9002:completed:stmt:STMT-777", e.ExternalEventId);
        Assert.Equal("9002", e.ExternalPaymentId);
        Assert.Equal(ProviderPaymentStatuses.Completed, e.Status);
        Assert.Equal(12_000, e.GrossCents);
        Assert.Equal(1_000, e.TipCents);
        Assert.Null(e.FeeCents);
        Assert.Null(e.NetCents);
        Assert.Equal("card", e.Method);
        Assert.Equal("STMT-777", e.StatementReference);
    }

    [Theory]
    [InlineData("error", "failed")]
    [InlineData("pending", "pending")]
    public void Maps_statuses(string raw, string expected)
    {
        using var doc = JsonDocument.Parse($$"""{"id": 1, "status": "{{raw}}", "totalAmount": 100}""");
        Assert.Equal(expected, SnapScanMapper.FromPayment(doc.RootElement).Status);
    }

    [Fact]
    public void Refunds_are_marked_as_refunds()
    {
        using var doc = JsonDocument.Parse("""{"id": 5, "status": "completed", "totalAmount": 100, "transactionType": "refund"}""");
        Assert.Equal(PaymentKinds.Refund, SnapScanMapper.FromPayment(doc.RootElement).Kind);
    }

    [Fact]
    public void Webhook_body_is_form_encoded_payload() =>
        Assert.Equal("77", SnapScanMapper.FromWebhookBody(Encoding.UTF8.GetBytes("payload=" + Uri.EscapeDataString("{\"id\":77,\"status\":\"completed\",\"totalAmount\":5}"))).ExternalPaymentId);
}

public class RolePermissionTests
{
    [Fact]
    public void Owner_and_admin_have_everything_accountant_is_read_only()
    {
        foreach (var p in Enum.GetValues<Permission>())
        {
            Assert.True(RolePermissions.Has(Roles.Owner, p));
            Assert.True(RolePermissions.Has(Roles.BusinessAdmin, p) || p is Permission.ConfigureDebtPolicy or Permission.ViewBusinessInsights);
        }
        foreach (var write in new[] { Permission.ManageFinancials, Permission.RecordSales, Permission.VoidTransactions, Permission.ManageIntegrations,
                     Permission.ManageStaff, Permission.ManageInventory, Permission.ManageReconciliation, Permission.ManageSettings })
            Assert.False(RolePermissions.Has(Roles.Accountant, write));
        Assert.False(RolePermissions.Has(Roles.BusinessAdmin, Permission.ConfigureDebtPolicy));
    }

    [Fact]
    public void Cashier_cannot_see_financials_or_manage_anything()
    {
        Assert.True(RolePermissions.Has(Roles.Cashier, Permission.RecordSales));
        Assert.False(RolePermissions.Has(Roles.Cashier, Permission.ViewFinancials));
        Assert.False(RolePermissions.Has(Roles.Cashier, Permission.VoidTransactions));
        Assert.False(RolePermissions.Has(Roles.Cashier, Permission.ApproveStockAdjustment));
        Assert.True(Roles.IsBranchScoped(Roles.Cashier));
    }

    [Fact]
    public void Role_change_rules()
    {
        Guid owner = Guid.NewGuid(), admin = Guid.NewGuid(), cashier = Guid.NewGuid();
        Assert.Equal(RoleChangeCheck.Ok, RolePermissions.CanChangeRole(Roles.Owner, owner, Roles.Cashier, cashier, Roles.BranchManager));
        Assert.Equal(RoleChangeCheck.CannotChangeOwnRole, RolePermissions.CanChangeRole(Roles.Owner, owner, Roles.Owner, owner, Roles.Staff));
        Assert.Equal(RoleChangeCheck.RoleNotAssignable, RolePermissions.CanChangeRole(Roles.Owner, owner, Roles.Cashier, cashier, Roles.Owner));
        Assert.Equal(RoleChangeCheck.CannotChangeOwner, RolePermissions.CanChangeRole(Roles.BusinessAdmin, admin, Roles.Owner, owner, Roles.Staff));
        Assert.Equal(RoleChangeCheck.OnlyOwnerManagesAdmins, RolePermissions.CanChangeRole(Roles.BusinessAdmin, admin, Roles.Cashier, cashier, Roles.BusinessAdmin));
        Assert.Equal(RoleChangeCheck.NotAllowed, RolePermissions.CanChangeRole(Roles.Cashier, cashier, Roles.Staff, admin, Roles.Cashier));
    }
}

public class ForecastScenarioTests
{
    [Fact]
    public void Pending_provider_payments_appear_only_in_the_optimistic_scenario()
    {
        var pending = new PendingInflow(Guid.NewGuid(), "Pending QR payment", 23_000, Today);
        var f = CashFlowForecaster.Build(Input(100_000) with { PendingInflows = [pending] });
        Assert.All(f.Days, d => Assert.True(d.OptimisticClosingCents >= d.ExpectedClosingCents));
        Assert.Equal(100_000, f.Days[^1].ExpectedClosingCents);
        Assert.Equal(123_000, f.Days[^1].OptimisticClosingCents);
        Assert.Equal(23_000, f.TotalOptimisticExtraCents);
        Assert.Equal("conservative,expected,optimistic", string.Join(",", f.Scenarios.Select(s => s.Key).OrderBy(k => k, StringComparer.Ordinal)));
    }

    [Fact]
    public void Thin_history_marks_forecast_as_preliminary()
    {
        var f = CashFlowForecaster.Build(Input(10_000) with { CountedTransactionCount = 3, HistoryDays = 3 });
        Assert.True(f.IsPreliminary);
        Assert.Contains("preliminary", f.PreliminaryReason);
        Assert.False(CashFlowForecaster.Build(Input(10_000) with { CountedTransactionCount = 50, HistoryDays = 60 }).IsPreliminary);
    }
}

public class AnomalyRuleTests
{
    private static GrowthContext With(AnomalySignals s) => Context(Input(100_000)) with { Signals = s };

    private static AnomalySignals Signals(
        IReadOnlyList<EventSignal>? dups = null, IReadOnlyList<PaymentSignal>? payments = null, IReadOnlyList<PaymentSignal>? refunds = null,
        IReadOnlyList<LedgerSignal>? ledger = null, IReadOnlyList<CashUpSignal>? cash = null, IReadOnlyList<StockAdjustmentSignal>? stock = null,
        IReadOnlyList<ConfigChangeSignal>? changes = null) =>
        new(dups ?? [], payments ?? [], refunds ?? [], ledger ?? [], cash ?? [], stock ?? [], changes ?? [], 3m, 5_000);

    [Fact]
    public void No_signals_no_findings()
    {
        var engine = GrowthEngine.CreateDefault();
        var codes = engine.Evaluate(With(AnomalySignals.Empty)).Select(d => d.RuleCode).ToHashSet();
        Assert.DoesNotContain("DUPLICATE_PROVIDER_EVENTS", codes);
        Assert.DoesNotContain("CASHUP_VARIANCE", codes);
        Assert.DoesNotContain("LARGE_TRANSACTION", codes);
    }

    [Fact]
    public void Cash_up_warning_is_evidence_based_and_not_accusatory()
    {
        var d = new CashUpVarianceRule().Evaluate(With(Signals(cash: [new(Guid.NewGuid(), "Sam", "Main", -6_500, Today)]))).Single();
        Assert.Equal(Severities.Warning, d.Severity);
        Assert.Single(d.Evidence);
        Assert.Contains("does not mean anyone did something wrong", d.Explanation);
        Assert.False(d.Title.Contains("fraud", StringComparison.OrdinalIgnoreCase));
        Assert.Empty(new CashUpVarianceRule().Evaluate(With(Signals(cash: [new(Guid.NewGuid(), "Sam", "Main", -100, Today)]))));
    }

    [Fact]
    public void Large_transaction_needs_enough_history()
    {
        var history = Enumerable.Range(10, 25).Select(i => new LedgerSignal(Guid.NewGuid(), "income", 20_000, Day(-i), "Sale", "staff_recorded")).ToList();
        var big = new LedgerSignal(Guid.NewGuid(), "income", 90_000, Today, "Big order", "staff_recorded");
        Assert.Single(new LargeTransactionRule().Evaluate(With(Signals(ledger: [.. history, big]))));
        Assert.Empty(new LargeTransactionRule().Evaluate(With(Signals(ledger: [.. history.Take(5), big]))));
    }

    [Fact]
    public void Failures_flagged_only_when_rising_or_high_share()
    {
        PaymentSignal P(string status, int day) => new(Guid.NewGuid(), "snapscan", 5_000, Day(day), status, null);
        var bad = Signals(payments: [P("failed", 0), P("failed", -1), P("failed", -2), P("completed", -1)]);
        Assert.Single(new PaymentFailuresRule().Evaluate(With(bad)));
        var normal = Signals(payments: [P("failed", 0), P("failed", -1), P("failed", -2), .. Enumerable.Range(0, 20).Select(i => P("completed", -(i % 7)))
            , .. Enumerable.Range(0, 12).Select(i => P("failed", -(8 + i)))]);
        Assert.Empty(new PaymentFailuresRule().Evaluate(With(normal)));
    }

    [Fact]
    public void Duplicate_events_reported_as_informational()
    {
        var d = new DuplicateEventsRule().Evaluate(With(Signals(dups: [new(Guid.NewGuid(), "sandbox", Today, "repeated 2 time(s)")]))).Single();
        Assert.Equal(Severities.Informational, d.Severity);
        Assert.Contains("only once", d.Explanation);
    }
}
