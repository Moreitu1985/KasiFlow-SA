using KasiFlow.Api.Services.Barbershop;
using KasiFlow.Core.Bookings;

namespace KasiFlow.Api.Tests.Core;

public class HouseCallSafetyTests
{
    private static readonly TimeSpan Sa = TimeSpan.FromHours(2);
    private static readonly DateTimeOffset Start = new(2026, 10, 16, 14, 0, 0, Sa);
    private static readonly DateTimeOffset End = Start.AddMinutes(85);

    private static SafetyState Eval(DateTimeOffset now, bool active = true, params (string Kind, int MinutesFromStart)[] checkins) =>
        HouseCallSafety.Evaluate(checkins.Select(c => new SafetyCheckin(c.Kind, Start.AddMinutes(c.MinutesFromStart))).ToList(), Start, End, 30, now, active);

    [Fact]
    public void Before_the_visit_nothing_is_overdue_and_the_barber_can_leave_or_arrive()
    {
        var s = Eval(Start.AddMinutes(-30));
        Assert.Equal("not_started", s.Stage);
        Assert.False(s.Overdue);
        Assert.Contains(SafetyCheckinKinds.Departed, s.NextActions);
        Assert.Contains(SafetyCheckinKinds.Arrived, s.NextActions);
        Assert.Contains(SafetyCheckinKinds.Help, s.NextActions);
    }

    [Fact]
    public void No_check_in_after_start_plus_grace_is_overdue()
    {
        Assert.False(Eval(Start.AddMinutes(29)).Overdue);
        var s = Eval(Start.AddMinutes(31));
        Assert.True(s.Overdue);
        Assert.Contains("No check-in", s.OverdueReason);
    }

    [Fact]
    public void Departed_but_not_arrived_is_overdue_after_grace()
    {
        var s = Eval(Start.AddMinutes(40), true, (SafetyCheckinKinds.Departed, -20));
        Assert.Equal(SafetyCheckinKinds.Departed, s.Stage);
        Assert.True(s.Overdue);
        Assert.Equal("arrived,help", string.Join(",", s.NextActions));
    }

    [Fact]
    public void Arrived_is_only_overdue_after_the_planned_end_plus_grace()
    {
        var arrived = new[] { (SafetyCheckinKinds.Departed, -20), (SafetyCheckinKinds.Arrived, 2) };
        Assert.False(Eval(End.AddMinutes(29), true, arrived).Overdue);
        var late = Eval(End.AddMinutes(31), true, arrived);
        Assert.True(late.Overdue);
        Assert.Equal(End.AddMinutes(30), late.CheckBy);
    }

    [Fact]
    public void Finished_and_returned_are_never_overdue()
    {
        Assert.False(Eval(End.AddHours(5), true, (SafetyCheckinKinds.Arrived, 0), (SafetyCheckinKinds.Finished, 80)).Overdue);
        var back = Eval(End.AddHours(5), true, (SafetyCheckinKinds.Arrived, 0), (SafetyCheckinKinds.Finished, 80), (SafetyCheckinKinds.Returned, 110));
        Assert.Equal(SafetyCheckinKinds.Returned, back.Stage);
        Assert.Equal("help", string.Join(",", back.NextActions));
    }

    [Fact]
    public void Inactive_bookings_are_never_overdue() =>
        Assert.False(Eval(End.AddHours(3), active: false).Overdue);

    [Fact]
    public void Help_stays_active_until_all_clear()
    {
        var help = Eval(Start.AddMinutes(20), true, (SafetyCheckinKinds.Arrived, 0), (SafetyCheckinKinds.Help, 15));
        Assert.True(help.HelpActive);
        Assert.Contains(SafetyCheckinKinds.AllClear, help.NextActions);
        Assert.DoesNotContain(SafetyCheckinKinds.Help, help.NextActions);
        var clear = Eval(Start.AddMinutes(30), true, (SafetyCheckinKinds.Arrived, 0), (SafetyCheckinKinds.Help, 15), (SafetyCheckinKinds.AllClear, 25));
        Assert.False(clear.HelpActive);
        Assert.Equal(SafetyCheckinKinds.Arrived, clear.Stage);
    }

    [Fact]
    public void Out_of_order_check_ins_are_not_allowed()
    {
        var s = Eval(Start, true);
        Assert.False(HouseCallSafety.Allowed(s, SafetyCheckinKinds.Finished));
        Assert.False(HouseCallSafety.Allowed(s, SafetyCheckinKinds.Returned));
        Assert.False(HouseCallSafety.Allowed(s, SafetyCheckinKinds.AllClear));
        Assert.True(HouseCallSafety.Allowed(s, SafetyCheckinKinds.Help));
    }

    [Fact]
    public void House_call_needs_a_complete_verified_account()
    {
        var empty = new CustomerHouseCallProfile(null, null, null, null, null, null, null, null);
        Assert.Equal(6, CustomerReadiness.MissingForHouseCall(empty).Count);
        var ready = new CustomerHouseCallProfile("Lindiwe M.", "+27 82 555 0101", "lindiwe@example.com", "4 Test Avenue", "Dobsonville", null,
            DateTimeOffset.UtcNow, CustomerReadiness.TermsVersion);
        Assert.Empty(CustomerReadiness.MissingForHouseCall(ready));
        Assert.Single(CustomerReadiness.MissingForHouseCall(ready with { TermsVersion = "old-terms" }));
        Assert.Single(CustomerReadiness.MissingForHouseCall(ready with { VerifiedContact = null }));
    }

    [Fact]
    public void Portfolio_accepts_only_real_images()
    {
        Assert.Equal("image/png", PortfolioService.Sniff(new byte[] { 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A }));
        Assert.Equal("image/jpeg", PortfolioService.Sniff(new byte[] { 0xFF, 0xD8, 0xFF, 0xE0 }));
        Assert.Equal("image/webp", PortfolioService.Sniff("RIFF\0\0\0\0WEBPVP8 "u8));
        Assert.Null(PortfolioService.Sniff("<svg onload=alert(1)>"u8));
        Assert.Null(PortfolioService.Sniff("%PDF-1.7"u8));
    }
}
