using KasiFlow.Core.Domain;
using KasiFlow.Core.Finance;
using KasiFlow.Core.Forecasting;
using KasiFlow.Core.Growth;

namespace KasiFlow.Api.Tests.Core;

/// <summary>Builders for deterministic test scenarios. Today is fixed so results never depend on the clock.</summary>
internal static class TestData
{
    public static readonly DateOnly Today = new(2026, 10, 16);

    public static DateOnly Day(int offset) => Today.AddDays(offset);

    public static LedgerEntry Income(long cents, int dayOffset, string category = "Sales", string status = TransactionStatuses.Posted, string payment = PaymentStatuses.RecordedManually) =>
        new(Guid.NewGuid(), TransactionTypes.Income, cents, Day(dayOffset), category, status, payment);

    public static LedgerEntry Expense(long cents, int dayOffset, string category = "Stock & supplies", string status = TransactionStatuses.Posted, string payment = PaymentStatuses.RecordedManually) =>
        new(Guid.NewGuid(), TransactionTypes.Expense, cents, Day(dayOffset), category, status, payment);

    public static OpenReceivable Receivable(long remaining, int? dueOffset, string customer = "Customer A", Guid? customerId = null) =>
        new(Guid.NewGuid(), customerId ?? Guid.NewGuid(), customer, "Credit sale", remaining, Day(-5), dueOffset is { } d ? Day(d) : null);

    public static OpenPayable Payable(long remaining, int dueOffset, string supplier = "Supplier A") =>
        new(Guid.NewGuid(), Guid.NewGuid(), supplier, "Stock order", remaining, Day(dueOffset));

    public static ScheduledItem Scheduled(string type, long cents, int dayOffset, string paymentStatus = PaymentStatuses.RecordedManually) =>
        new(Guid.NewGuid(), type, "Planned", cents, Day(dayOffset), paymentStatus);

    public static ForecastInput Input(long cash, long buffer = 0, int horizon = 30,
        IReadOnlyList<ScheduledItem>? scheduled = null, IReadOnlyList<OpenReceivable>? receivables = null,
        IReadOnlyList<OpenPayable>? payables = null, IReadOnlyList<UnconfirmedItem>? unconfirmed = null, bool openingConfigured = true) =>
        new(Today, horizon, cash, openingConfigured, buffer, scheduled ?? [], receivables ?? [], payables ?? [], unconfirmed ?? []);

    /// <summary>The barber example from the brief: R1,500 cash, R2,000 due before R1,200 of expected payments.</summary>
    public static ForecastInput BarberScenario(out OpenReceivable expected, out OpenPayable supplierBill, out OpenPayable otherBill)
    {
        expected = Receivable(120_000, 7, "Lerato K.");
        supplierBill = Payable(150_000, 3, "Barber Supplies");
        otherBill = Payable(50_000, 5, "Landlord");
        return Input(150_000, buffer: 30_000, receivables: [expected], payables: [supplierBill, otherBill]);
    }

    public static GrowthContext Context(ForecastInput input, IReadOnlyList<DailyExpense>? history = null, int postedCount = 10, DateOnly? lastPosted = null)
    {
        var forecast = CashFlowForecaster.Build(input);
        return new GrowthContext(input.Today, forecast, input.CurrentCashBalanceCents, input.CashBufferCents, input.OpeningBalanceConfigured,
            input.Receivables, input.Payables, history ?? [], lastPosted ?? Today, postedCount, input.Unconfirmed);
    }
}
