using KasiFlow.Core.Bookings;

namespace KasiFlow.Api.Tests.Core;

public class QueueAndPayTests
{
    [Fact]
    public void Free_chair_means_no_wait()
    {
        var e = QueueEstimator.ForNext([], [10], 2);
        Assert.Equal(0, e.Minutes);
        Assert.Contains("free now", e.Label);
    }

    [Fact]
    public void Work_ahead_is_shared_across_working_barbers()
    {
        // 2 people waiting (30 + 40 min) + 20 min left in the chair, 2 barbers -> about 45 minutes.
        var e = QueueEstimator.ForNext([30, 40], [20, 0], 2);
        Assert.Equal(45, e.Minutes);
        Assert.True(e.LowMinutes < e.Minutes && e.HighMinutes > e.Minutes);
        Assert.Contains("About", e.Label);
    }

    [Fact]
    public void No_barbers_working_is_treated_as_one()
    {
        var e = QueueEstimator.ForNext([30], [15], 0);
        Assert.Equal(45, e.Minutes);
    }

    [Fact]
    public void Long_waits_are_shown_in_hours()
    {
        var e = QueueEstimator.ForNext([60, 60, 60], [30], 1);
        Assert.Contains("hours", e.Label);
    }

    [Theory]
    [InlineData("waiting", "call", "called")]
    [InlineData("waiting", "start", "in_chair")]
    [InlineData("called", "requeue", "waiting")]
    [InlineData("in_chair", "done", "done")]
    [InlineData("called", "no_show", "no_show")]
    [InlineData("in_chair", "left", null)]
    [InlineData("done", "start", null)]
    public void Queue_moves(string from, string action, string? to) => Assert.Equal(to, QueueStatuses.Next(from, action));

    [Fact]
    public void Commission_is_a_share_of_services_not_travel_fees()
    {
        var s = PayCalculator.Statement(new PayTerms(PayModes.Commission, 40, null, null), 10, 100_000, 20_000, new DateOnly(2026, 10, 19), new DateOnly(2026, 10, 25), 0);
        Assert.Equal(40_000, s.CommissionCents);
        Assert.Equal(40_000, s.BalanceCents);
        Assert.Contains("Travel fees stay with the shop", s.Explanation);
    }

    [Fact]
    public void Chair_rent_is_owed_to_the_shop_and_pro_rated()
    {
        var s = PayCalculator.Statement(new PayTerms(PayModes.ChairRent, null, 60_000, null), 5, 50_000, 0, new DateOnly(2026, 10, 12), new DateOnly(2026, 10, 25), 0);
        Assert.Equal(120_000, s.ChairRentCents);
        Assert.Equal(-120_000, s.BalanceCents);
        var half = PayCalculator.Statement(new PayTerms(PayModes.ChairRent, null, 70_000, null), 0, 0, 0, new DateOnly(2026, 10, 1), new DateOnly(2026, 10, 3), 0);
        Assert.Equal(30_000, half.ChairRentCents);
    }

    [Fact]
    public void Wage_minus_payouts_gives_the_balance()
    {
        var s = PayCalculator.Statement(new PayTerms(PayModes.Wage, null, null, 90_000), 3, 30_000, 0, new DateOnly(2026, 10, 19), new DateOnly(2026, 10, 25), 50_000);
        Assert.Equal(90_000, s.WageCents);
        Assert.Equal(40_000, s.BalanceCents);
    }

    [Fact]
    public void No_terms_means_nothing_is_calculated()
    {
        var s = PayCalculator.Statement(null, 4, 40_000, 0, new DateOnly(2026, 10, 19), new DateOnly(2026, 10, 25), 0);
        Assert.Equal(0, s.EarnedCents);
        Assert.Contains("No pay terms", s.Explanation);
    }
}
