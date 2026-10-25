using KasiFlow.Core.Domain;
using KasiFlow.Core.Forecasting;
using static KasiFlow.Api.Tests.Core.TestData;

namespace KasiFlow.Api.Tests.Core;

public class ForecastTests
{
    [Fact]
    public void Empty_business_forecast_is_flat_and_has_no_shortage()
    {
        var f = CashFlowForecaster.Build(Input(0, openingConfigured: false));
        Assert.Equal(30, f.Days.Count);
        Assert.All(f.Days, d => Assert.Equal(0, d.ExpectedClosingCents));
        Assert.Null(f.FirstShortageDate);
        Assert.Contains(f.Assumptions, a => a.Contains("No opening cash balance"));
    }

    [Fact]
    public void Day_zero_is_today_and_opens_with_current_cash()
    {
        var f = CashFlowForecaster.Build(Input(150_000));
        Assert.Equal(Today, f.Days[0].Date);
        Assert.Equal(150_000, f.Days[0].OpeningBalanceCents);
        Assert.Equal(Today.AddDays(29), f.EndDate);
    }

    [Fact]
    public void Expenses_due_before_expected_income_cause_a_shortage_on_the_right_day()
    {
        var f = CashFlowForecaster.Build(BarberScenario(out _, out _, out _));
        // 1,500 - 1,500 (day 3) = 0 ; - 500 (day 5) = -500 ; +1,200 (day 7) = 700
        Assert.Equal(0, f.Days[3].ExpectedClosingCents);
        Assert.Equal(-50_000, f.Days[5].ExpectedClosingCents);
        Assert.Equal(70_000, f.Days[7].ExpectedClosingCents);
        Assert.Equal(Day(5), f.FirstShortageDate);
        Assert.Equal(Day(3), f.FirstBelowBufferDate);
        Assert.Equal(new BalancePoint(Day(5), -50_000), f.LowestExpected);
        // Conservative line never receives the expected payment.
        Assert.Equal(-50_000, f.Days[29].ConservativeClosingCents);
        Assert.Equal(70_000, f.ClosingExpectedCents);
    }

    [Fact]
    public void Income_received_before_expenses_avoids_shortage()
    {
        var input = Input(10_000,
            scheduled: [Scheduled(TransactionTypes.Income, 50_000, 1)],
            payables: [Payable(40_000, 2)]);
        var f = CashFlowForecaster.Build(input);
        Assert.Null(f.FirstShortageDate);
        Assert.Equal(20_000, f.Days[2].ExpectedClosingCents);
        Assert.Equal(20_000, f.Days[2].ConservativeClosingCents); // scheduled income is in both lines
    }

    [Fact]
    public void Expected_inflows_are_labelled_and_separated_from_scheduled_and_actual()
    {
        var r = Receivable(30_000, 4);
        var f = CashFlowForecaster.Build(Input(5_000, receivables: [r], scheduled: [Scheduled(TransactionTypes.Income, 1_000, 4)]));
        var day = f.Days[4];
        Assert.Equal(30_000, day.ExpectedInflowsCents);
        Assert.Equal(1_000, day.ScheduledInflowsCents);
        var e = Assert.Single(day.Events, x => x.Kind == EventKinds.ExpectedCollection);
        Assert.True(e.IsExpected);
        Assert.Equal(r.Id, e.SourceId);
        Assert.Equal(36_000, day.ExpectedClosingCents);
        Assert.Equal(6_000, day.ConservativeClosingCents);
    }

    [Fact]
    public void Overdue_and_undated_receivables_are_excluded_with_reasons()
    {
        var overdue = Receivable(40_000, -10);
        var undated = Receivable(25_000, null);
        var f = CashFlowForecaster.Build(Input(0, receivables: [overdue, undated]));
        Assert.Equal(0, f.TotalExpectedInflowsCents);
        Assert.Contains(f.Excluded, x => x.SourceId == overdue.Id && x.Reason.StartsWith("Overdue"));
        Assert.Contains(f.Excluded, x => x.SourceId == undated.Id && x.Reason.StartsWith("No due date"));
    }

    [Fact]
    public void Overdue_bills_are_carried_forward_to_today()
    {
        var bill = Payable(20_000, -4);
        var f = CashFlowForecaster.Build(Input(10_000, payables: [bill]));
        var e = Assert.Single(f.Days[0].Events);
        Assert.True(e.IsOverdueCarryForward);
        Assert.Equal(-10_000, f.Days[0].ExpectedClosingCents);
        Assert.Equal(Today, f.FirstShortageDate);
    }

    [Fact]
    public void Partially_paid_items_contribute_only_their_remaining_balance()
    {
        // Remaining balances are computed upstream (original − payments); the forecast must use them as-is,
        // because the payments themselves are already inside the current cash balance.
        var f = CashFlowForecaster.Build(Input(100_000, payables: [Payable(15_000, 2)], receivables: [Receivable(5_000, 2)]));
        Assert.Equal(90_000, f.Days[2].ExpectedClosingCents);
    }

    [Fact]
    public void Fully_settled_items_are_ignored()
    {
        var f = CashFlowForecaster.Build(Input(100_000, payables: [Payable(0, 2)], receivables: [Receivable(0, 2)]));
        Assert.All(f.Days, d => Assert.Empty(d.Events));
        Assert.Equal(100_000, f.ClosingExpectedCents);
    }

    [Fact]
    public void Unconfirmed_payments_and_stale_or_failed_schedules_are_not_counted()
    {
        var unconfirmed = new UnconfirmedItem(Guid.NewGuid(), TransactionTypes.Income, "EFT proof by WhatsApp", 30_000, Day(-1));
        var stale = Scheduled(TransactionTypes.Expense, 9_000, -2);
        var failed = Scheduled(TransactionTypes.Income, 8_000, 3, PaymentStatuses.Failed);
        var f = CashFlowForecaster.Build(Input(10_000, scheduled: [stale, failed], unconfirmed: [unconfirmed]));
        Assert.Equal(10_000, f.ClosingExpectedCents);
        Assert.Equal(3, f.Excluded.Count);
    }

    [Fact]
    public void Items_beyond_horizon_are_ignored()
    {
        var f = CashFlowForecaster.Build(Input(10_000, horizon: 7, payables: [Payable(50_000, 7)]));
        Assert.Null(f.FirstShortageDate);
    }

    [Theory]
    [InlineData(6)]
    [InlineData(91)]
    public void Horizon_is_bounded(int days) =>
        Assert.Throws<ArgumentOutOfRangeException>(() => CashFlowForecaster.Build(Input(0, horizon: days)));

    [Fact]
    public void Forecast_is_deterministic()
    {
        var input = BarberScenario(out _, out _, out _);
        var a = CashFlowForecaster.Build(input);
        var b = CashFlowForecaster.Build(input);
        Assert.Equal(a.Days.Select(d => d.ExpectedClosingCents).ToList().Sum(), b.Days.Select(d => d.ExpectedClosingCents).ToList().Sum());
        Assert.Equal(a.FirstShortageDate, b.FirstShortageDate);
    }
}
