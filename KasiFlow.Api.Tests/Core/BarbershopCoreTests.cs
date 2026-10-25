using KasiFlow.Core.Domain;
using KasiFlow.Api.Services;
using KasiFlow.Core.Bookings;
using KasiFlow.Core.Finance;
using KasiFlow.Core.Growth;
using static KasiFlow.Api.Tests.Core.TestData;

namespace KasiFlow.Api.Tests.Core;

public class StaffAvailabilityTests
{
    private static readonly TimeSpan Sa = TimeSpan.FromHours(2);
    // Friday 16 Oct 2026, 10:00 South African time.
    private static readonly DateTimeOffset Now = new(2026, 10, 16, 10, 0, 0, Sa);
    private static readonly IReadOnlyList<WorkingHours> Hours =
        Enumerable.Range(1, 6).Select(d => new WorkingHours(d, new TimeOnly(8, 0), new TimeOnly(18, 0))).ToList();

    [Fact]
    public void Expired_temporary_status_falls_back()
    {
        var s = new StoredStatus(StaffStatuses.OnBreak, Now.AddMinutes(-40), Now.AddMinutes(-10), StaffStatuses.Available);
        var e = StaffAvailability.Effective(s, Now, Hours);
        Assert.True(e.Expired);
        Assert.Equal(StaffStatuses.Available, e.Status);
    }

    [Fact]
    public void Expired_status_without_choice_uses_working_hours()
    {
        var s = new StoredStatus(StaffStatuses.Busy, Now.AddHours(-1), Now.AddMinutes(-1), null);
        Assert.Equal(StaffStatuses.Available, StaffAvailability.Effective(s, Now, Hours).Status);
        Assert.Equal(StaffStatuses.OffDuty, StaffAvailability.Effective(s, Now.AddHours(10), Hours).Status);
    }

    [Fact]
    public void Old_busy_status_is_stale_and_never_promises_availability()
    {
        var s = new StoredStatus(StaffStatuses.Busy, Now.AddHours(-5), null, null);
        var e = StaffAvailability.Effective(s, Now, Hours);
        Assert.True(e.Stale);
        Assert.False(StaffAvailability.AvailableNow(e, Now, Hours));
    }

    [Theory]
    [InlineData(StaffStatuses.Busy)]
    [InlineData(StaffStatuses.HouseCall)]
    [InlineData(StaffStatuses.OnBreak)]
    public void Away_statuses_are_not_available_now(string status) =>
        Assert.False(StaffAvailability.AvailableNow(StaffAvailability.Effective(new StoredStatus(status, Now, null, null), Now, Hours), Now, Hours));

    [Fact]
    public void Off_duty_blocks_new_bookings_until_tomorrow()
    {
        var s = new StoredStatus(StaffStatuses.OffDuty, Now, null, null);
        var until = StaffAvailability.BlocksNewBookingsUntil(StaffAvailability.Effective(s, Now, Hours), s, Now);
        Assert.Equal(new DateTimeOffset(2026, 10, 17, 0, 0, 0, Sa), until);
    }

    [Fact]
    public void Unavailable_blocks_until_changed_and_available_does_not_block()
    {
        var u = new StoredStatus(StaffStatuses.Unavailable, Now, null, null);
        Assert.Equal(DateTimeOffset.MaxValue, StaffAvailability.BlocksNewBookingsUntil(StaffAvailability.Effective(u, Now, Hours), u, Now));
        var a = new StoredStatus(StaffStatuses.Available, Now, null, null);
        Assert.Null(StaffAvailability.BlocksNewBookingsUntil(StaffAvailability.Effective(a, Now, Hours), a, Now));
    }

    [Fact]
    public void Slots_respect_hours_time_off_confirmed_bookings_lead_time_and_blocks()
    {
        var date = new DateOnly(2026, 10, 17); // Saturday
        var off = new TimeOff(new DateTimeOffset(2026, 10, 17, 12, 0, 0, Sa), new DateTimeOffset(2026, 10, 17, 14, 0, 0, Sa));
        var busy = new BusyInterval(new DateTimeOffset(2026, 10, 17, 9, 0, 0, Sa), new DateTimeOffset(2026, 10, 17, 10, 0, 0, Sa));
        var slots = SlotFinder.FreeSlots(new SlotQuery(date, 30, 30, Now, 30), Hours, [off], [busy], null);
        Assert.Contains(slots, s => s.StartsAt.ToOffset(Sa).Hour == 8);
        Assert.DoesNotContain(slots, s => s.StartsAt.ToOffset(Sa).Hour == 9);
        Assert.DoesNotContain(slots, s => s.StartsAt.ToOffset(Sa).Hour is 12 or 13);
        Assert.Equal(new TimeOnly(17, 30), TimeOnly.FromDateTime(slots[^1].StartsAt.ToOffset(Sa).DateTime));
        Assert.Empty(SlotFinder.FreeSlots(new SlotQuery(date, 30, 30, Now, 30), Hours, [], [], DateTimeOffset.MaxValue));
        Assert.Empty(SlotFinder.FreeSlots(new SlotQuery(new DateOnly(2026, 10, 18), 30, 30, Now, 30), Hours, [], [], null)); // Sunday: no hours
    }

    [Fact]
    public void Why_not_explains_conflicts()
    {
        var s = new DateTimeOffset(2026, 10, 17, 9, 0, 0, Sa);
        var busy = new BusyInterval(s.AddMinutes(15), s.AddMinutes(45));
        Assert.Contains("confirmed appointment", SlotFinder.WhyNot(s, s.AddMinutes(30), Now, 30, Hours, [], [busy], null));
        Assert.Contains("outside", SlotFinder.WhyNot(s.AddHours(-3), s.AddHours(-2), Now.AddDays(-1), 0, Hours, [], [], null));
        Assert.Null(SlotFinder.WhyNot(s, s.AddMinutes(30), Now, 30, Hours, [], [], null));
    }
}

public class BookingRuleTests
{
    [Theory]
    [InlineData("requested", "confirm", "confirmed")]
    [InlineData("requested", "propose_reschedule", "reschedule_proposed")]
    [InlineData("confirmed", "complete", "completed")]
    [InlineData("confirmed", "no_show", "no_show")]
    [InlineData("reschedule_proposed", "accept_proposal", "confirmed")]
    [InlineData("completed", "cancel", null)]
    [InlineData("cancelled", "confirm", null)]
    [InlineData("requested", "complete", null)]
    public void Lifecycle(string from, string action, string? to) => Assert.Equal(to, BookingStateMachine.Next(from, action));

    [Fact]
    public void Rejecting_a_proposal_depends_on_who_proposed()
    {
        Assert.Equal("confirmed", BookingStateMachine.Next("reschedule_proposed", "reject_proposal", "customer"));
        Assert.Equal("requested", BookingStateMachine.Next("reschedule_proposed", "reject_proposal", "business"));
    }

    [Fact]
    public void Several_services_total_correctly()
    {
        var q = BookingPricing.Quote([new("Fade", "Me", 10_000, 40), new("Beard trim", "Me", 5_000, 20), new("Kids cut", "Son", 6_000, 25)], 0, null);
        Assert.Equal(21_000, q.TotalCents);
        Assert.Equal(85, q.DurationMinutes);
    }

    [Fact]
    public void House_call_total_includes_disclosed_travel_fee_and_discount()
    {
        var fee = BookingPricing.TravelFee(new TravelFeePolicy("flat", 10_000, 0, 0, null), null);
        var q = BookingPricing.Quote([new("Haircut", "P1", 8_000, 30)], 1_000, fee);
        Assert.Equal(8_000 + 10_000 - 1_000, q.TotalCents);
        Assert.True(fee.IsFinal);
    }

    [Fact]
    public void Per_km_fee_needs_a_distance_and_never_invents_one()
    {
        var p = new TravelFeePolicy("per_km", 0, 800, 5_000, 25m);
        var unknown = BookingPricing.TravelFee(p, null);
        Assert.False(unknown.IsFinal);
        Assert.Equal(5_000, unknown.FeeCents);
        Assert.Contains("not calculated", unknown.Explanation);
        Assert.Equal(8_000, BookingPricing.TravelFee(p, 10m).FeeCents);
        Assert.Equal(5_000, BookingPricing.TravelFee(p, 2m).FeeCents);
        Assert.True(BookingPricing.TravelFee(p, 30m).OutsideServiceArea);
    }

    [Fact]
    public void Discount_cannot_exceed_total() =>
        Assert.Throws<ArgumentOutOfRangeException>(() => BookingPricing.Quote([new("Haircut", "P1", 8_000, 30)], 9_000, null));

    [Fact]
    public void House_call_contribution_separates_estimated_and_actual()
    {
        var e = HouseCalls.Economics(20_000, 5_000, 2_000, 10_000, true);
        Assert.Equal(13_000, e.EstimatedContributionCents);
        Assert.Equal(10_000, e.ActualContributionCents);
        Assert.Contains("before overheads", e.Caveat);
        Assert.Null(HouseCalls.Economics(20_000, null, null, 0, false).EstimatedContributionCents);
    }
}

public class DebtRuleTests
{
    private static readonly DateOnly Due = Today.AddDays(-10);

    [Fact]
    public void R200_debt_with_R50_paid_leaves_R150_principal()
    {
        var b = DebtMath.Balance(20_000, 5_000, 0, [], Due, Today, false);
        Assert.Equal(15_000, b.PrincipalOutstandingCents);
        Assert.Equal(15_000, b.TotalOutstandingCents);
        Assert.Equal(DebtStatuses.Overdue, b.Status);
    }

    [Fact]
    public void Valid_applied_R5_charge_gives_R155_and_proposed_one_does_not_count()
    {
        Assert.Equal(15_500, DebtMath.Balance(20_000, 5_000, 0, [new(500, "applied")], Due, Today, false).TotalOutstandingCents);
        var proposed = DebtMath.Balance(20_000, 5_000, 0, [new(500, "proposed")], Due, Today, false);
        Assert.Equal(15_000, proposed.TotalOutstandingCents);
        Assert.Equal(500, proposed.ProposedChargesCents);
        Assert.Equal(15_000, DebtMath.Balance(20_000, 5_000, 0, [new(500, "waived")], Due, Today, false).TotalOutstandingCents);
    }

    [Fact]
    public void Payments_settle_principal_before_charges()
    {
        var b = DebtMath.Balance(20_000, 20_200, 0, [new(500, "applied")], Due, Today, false);
        Assert.Equal(0, b.PrincipalOutstandingCents);
        Assert.Equal(300, b.ChargesOutstandingCents);
        Assert.Equal(DebtStatuses.Settled, DebtMath.Balance(20_000, 20_500, 0, [new(500, "applied")], Due, Today, false).Status);
    }

    [Fact]
    public void Disputed_status_wins_over_overdue() =>
        Assert.Equal(DebtStatuses.Disputed, DebtMath.Balance(20_000, 0, 0, [], Due, Today, true).Status);

    private static readonly DebtChargePolicy Valid = new(true, true, 500, 7, "Once-off R5", 3);
    private static readonly DebtDisclosure Disclosed = new(DateTimeOffset.UtcNow, 500, 7, 3);
    private static DebtBalance Owing(bool disputed = false) => DebtMath.Balance(20_000, 5_000, 0, [], Due, Today, disputed);

    [Fact]
    public void Charge_applied_only_when_enabled_reviewed_and_disclosed()
    {
        var d = DebtChargeRules.Evaluate(Valid, Disclosed, Owing(), Due, Today);
        Assert.True(d.Apply);
        Assert.Equal("overdue", d.EventKey);
        Assert.Equal(500, d.AmountCents);
    }

    [Theory]
    [InlineData(false, true, true, "not enabled")]
    [InlineData(true, false, true, "legally reviewed")]
    [InlineData(true, true, false, "not disclosed")]
    public void Otherwise_only_proposed(bool enabled, bool reviewed, bool disclosed, string reason)
    {
        var d = DebtChargeRules.Evaluate(Valid with { Enabled = enabled, LegallyReviewed = reviewed },
            disclosed ? Disclosed : new DebtDisclosure(null, null, null, null), Owing(), Due, Today);
        Assert.True(d.Qualifies);
        Assert.False(d.Apply);
        Assert.Contains(reason, d.Basis);
    }

    [Fact]
    public void One_event_key_means_one_charge_never_per_day()
    {
        var a = DebtChargeRules.Evaluate(Valid, Disclosed, Owing(), Due, Today);
        var b = DebtChargeRules.Evaluate(Valid, Disclosed, Owing(), Due, Today.AddDays(30));
        Assert.Equal(a.EventKey, b.EventKey);
    }

    [Fact]
    public void Not_charged_before_the_overdue_period_or_when_disputed_or_settled()
    {
        Assert.False(DebtChargeRules.Evaluate(Valid, Disclosed, DebtMath.Balance(20_000, 0, 0, [], Today.AddDays(-3), Today, false), Today.AddDays(-3), Today).Qualifies);
        Assert.False(DebtChargeRules.Evaluate(Valid, Disclosed, Owing(disputed: true), Due, Today).Qualifies);
        Assert.False(DebtChargeRules.Evaluate(Valid, Disclosed, DebtMath.Balance(20_000, 20_000, 0, [], Due, Today, false), Due, Today).Qualifies);
    }

    [Fact]
    public void Disclosed_terms_are_used_even_if_the_policy_changed()
    {
        var d = DebtChargeRules.Evaluate(Valid with { AmountCents = 2_000, Version = 9 }, Disclosed, Owing(), Due, Today);
        Assert.Equal(500, d.AmountCents);
    }
}

public class AlertRuleTests
{
    private static GrowthContext With(AnomalySignals s) => Context(Input(100_000)) with { Signals = s };

    [Fact]
    public void Duplicate_expense_detected_within_a_day()
    {
        var a = new LedgerSignal(Guid.NewGuid(), "expense", 42_000, Today.AddDays(-2), "Clipper oil", "staff_recorded");
        var b = a with { Id = Guid.NewGuid(), Date = Today.AddDays(-1), Description = " clipper OIL " };
        var d = new DuplicateExpenseRule().Evaluate(With(AnomalySignals.Empty with { LedgerHistory = [a, b] })).Single();
        Assert.Equal(2, d.Evidence.Count);
        Assert.Empty(new DuplicateExpenseRule().Evaluate(With(AnomalySignals.Empty with { LedgerHistory = [a, b with { Date = Today.AddDays(-9) }] })));
    }

    [Fact]
    public void Completed_booking_without_payment_or_debt_is_flagged()
    {
        var s = AnomalySignals.Empty with { BookingPayments = [new(Guid.NewGuid(), "BK-AAAA1111", 16_000, 0, 0, false, Today.AddDays(-1)),
                                                               new(Guid.NewGuid(), "BK-BBBB2222", 16_000, 0, 0, true, Today.AddDays(-1)),
                                                               new(Guid.NewGuid(), "BK-CCCC3333", 16_000, 16_000, 0, false, Today.AddDays(-1))] };
        var d = new BookingPaymentMismatchRule().Evaluate(With(s)).Single();
        Assert.Single(d.Evidence);
        Assert.Contains("without assuming", string.Join(" ", d.Actions));
    }

    [Fact]
    public void Unverified_proof_older_than_a_day_and_duplicates_flagged()
    {
        var p = new ProofSignal(Guid.NewGuid(), 20_000, Today, "unverified", false, 0, "POP-1");
        Assert.Empty(new UnverifiedProofRule().Evaluate(With(AnomalySignals.Empty with { Proofs = [p] })));
        Assert.Equal(Severities.Warning, new UnverifiedProofRule().Evaluate(With(AnomalySignals.Empty with { Proofs = [p with { AgeDays = 2 }] })).Single().Severity);
        Assert.Equal(Severities.Critical, new UnverifiedProofRule().Evaluate(With(AnomalySignals.Empty with { Proofs = [p with { DuplicateFile = true }] })).Single().Severity);
    }

    [Fact]
    public void Failed_collections_need_two_attempts_and_skip_disputes()
    {
        var c = new CollectionSignal(Guid.NewGuid(), "Sipho", 40_000, 10, 2, false);
        Assert.Single(new FailedCollectionsRule().Evaluate(With(AnomalySignals.Empty with { Collections = [c] })));
        Assert.Empty(new FailedCollectionsRule().Evaluate(With(AnomalySignals.Empty with { Collections = [c with { Disputed = true }, c with { FailedAttempts = 1 }] })));
    }

    [Fact]
    public void Alert_codes_are_routed_to_the_alerts_centre()
    {
        Assert.Contains("CASHUP_VARIANCE", AlertCodes.All);
        Assert.Contains("SUPPLIER_BANK_CHANGE", AlertCodes.All);
        Assert.DoesNotContain("CASH_SHORTFALL", AlertCodes.All);
        Assert.DoesNotContain("HOUSE_CALL_FEE_REVIEW", AlertCodes.All);
    }

    [Fact]
    public void House_call_fee_review_when_costs_exceed_fees()
    {
        var v = new HouseCallCostSignal(Guid.NewGuid(), 10_000, 12_000, Today);
        Assert.Single(new HouseCallFeeRule().Evaluate(With(AnomalySignals.Empty with { HouseCallCosts = [v, v with { BookingId = Guid.NewGuid() }] })));
        Assert.Empty(new HouseCallFeeRule().Evaluate(With(AnomalySignals.Empty with { HouseCallCosts = [v] })));
    }
}

public class PaymentProofSniffTests
{
    [Fact]
    public void File_type_is_detected_from_content()
    {
        Assert.Equal("image/png", PaymentProofService.Sniff([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]));
        Assert.Equal("image/jpeg", PaymentProofService.Sniff([0xFF, 0xD8, 0xFF, 0xE0]));
        Assert.Equal("application/pdf", PaymentProofService.Sniff("%PDF-1.7"u8));
        Assert.Null(PaymentProofService.Sniff("MZ\u0090"u8));
    }
}
