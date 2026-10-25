namespace KasiFlow.Core.Bookings;

public static class BookingStatuses
{
    public const string Requested = "requested";
    public const string Confirmed = "confirmed";
    public const string RescheduleProposed = "reschedule_proposed";
    public const string Completed = "completed";
    public const string Cancelled = "cancelled";
    public const string NoShow = "no_show";

    public static readonly IReadOnlyList<string> All = [Requested, Confirmed, RescheduleProposed, Completed, Cancelled, NoShow];
    public static bool IsFinal(string s) => s is Completed or Cancelled or NoShow;

    public static string Label(string s) => s switch
    {
        Requested => "Requested",
        Confirmed => "Confirmed",
        RescheduleProposed => "Reschedule proposed",
        Completed => "Completed",
        Cancelled => "Cancelled",
        NoShow => "No-show",
        _ => s
    };
}

public static class BookingActions
{
    public const string Confirm = "confirm";
    public const string ProposeReschedule = "propose_reschedule";
    public const string AcceptProposal = "accept_proposal";
    public const string RejectProposal = "reject_proposal";
    public const string Complete = "complete";
    public const string NoShow = "no_show";
    public const string Cancel = "cancel";
}

/// <summary>Booking lifecycle. Final states (completed, cancelled, no-show) never change.</summary>
public static class BookingStateMachine
{
    public static string? Next(string current, string action, string? proposedBy = null) => (current, action) switch
    {
        (BookingStatuses.Requested, BookingActions.Confirm) => BookingStatuses.Confirmed,
        (BookingStatuses.Requested, BookingActions.ProposeReschedule) => BookingStatuses.RescheduleProposed,
        (BookingStatuses.Requested, BookingActions.Cancel) => BookingStatuses.Cancelled,
        (BookingStatuses.Confirmed, BookingActions.ProposeReschedule) => BookingStatuses.RescheduleProposed,
        (BookingStatuses.Confirmed, BookingActions.Complete) => BookingStatuses.Completed,
        (BookingStatuses.Confirmed, BookingActions.NoShow) => BookingStatuses.NoShow,
        (BookingStatuses.Confirmed, BookingActions.Cancel) => BookingStatuses.Cancelled,
        (BookingStatuses.RescheduleProposed, BookingActions.AcceptProposal) => BookingStatuses.Confirmed,
        (BookingStatuses.RescheduleProposed, BookingActions.ProposeReschedule) => BookingStatuses.RescheduleProposed,
        (BookingStatuses.RescheduleProposed, BookingActions.Cancel) => BookingStatuses.Cancelled,
        // Rejecting a proposal: a customer's request on a confirmed booking falls back to the confirmed time;
        // a business proposal the customer rejects returns the booking to "requested" for another proposal.
        (BookingStatuses.RescheduleProposed, BookingActions.RejectProposal) => proposedBy == "customer" ? BookingStatuses.Confirmed : BookingStatuses.Requested,
        _ => null
    };
}

public sealed record PricedItem(string ServiceName, string PersonLabel, long UnitPriceCents, int DurationMinutes);

public sealed record TravelFeePolicy(string Mode, long FlatCents, long PerKmCents, long MinimumCents, decimal? MaxKm);

public sealed record TravelFeeQuote(long FeeCents, bool IsFinal, bool OutsideServiceArea, string Explanation);

public sealed record BookingQuote(long ServicesTotalCents, long TravelFeeCents, long DiscountCents, long TotalCents, int DurationMinutes,
    TravelFeeQuote? Travel);

/// <summary>Prices come only from the configured catalogue and disclosed fees.</summary>
public static class BookingPricing
{
    public static TravelFeeQuote TravelFee(TravelFeePolicy p, decimal? distanceKm)
    {
        if (p.MaxKm is { } max && distanceKm is { } d && d > max)
            return new TravelFeeQuote(0, false, true, $"The address is about {d:0.#} km away, beyond this business's {max:0.#} km service area.");
        switch (p.Mode)
        {
            case "none":
                return new TravelFeeQuote(0, true, false, "No travel fee.");
            case "flat":
                var flat = Math.Max(p.FlatCents, p.MinimumCents);
                return new TravelFeeQuote(flat, true, false, $"Flat travel fee of {Common.Money.FormatZar(flat)}.");
            case "per_km" when distanceKm is { } km:
                var fee = Math.Max(p.MinimumCents, (long)Math.Ceiling(km * p.PerKmCents));
                return new TravelFeeQuote(fee, true, false,
                    $"{Common.Money.FormatZar(p.PerKmCents)} per km × {km:0.#} km (minimum {Common.Money.FormatZar(p.MinimumCents)}).");
            case "per_km":
                return new TravelFeeQuote(p.MinimumCents, false, false,
                    $"Distance not calculated yet. The minimum travel fee of {Common.Money.FormatZar(p.MinimumCents)} applies; if the business needs to charge more it must propose the new fee for you to accept first.");
            default:
                throw new ArgumentException($"Unknown travel fee mode '{p.Mode}'.");
        }
    }

    public static BookingQuote Quote(IReadOnlyList<PricedItem> items, long discountCents, TravelFeeQuote? travel)
    {
        if (items.Count == 0) throw new ArgumentException("A booking needs at least one service.");
        if (discountCents < 0) throw new ArgumentOutOfRangeException(nameof(discountCents));
        var services = items.Sum(i => i.UnitPriceCents);
        var fee = travel?.FeeCents ?? 0;
        if (discountCents > services + fee) throw new ArgumentOutOfRangeException(nameof(discountCents), "Discount is larger than the total.");
        // Several people are served one after another by the same barber, so durations add up.
        var duration = items.Sum(i => i.DurationMinutes);
        return new BookingQuote(services, fee, discountCents, services + fee - discountCents, duration, travel);
    }
}

public sealed record HouseCallEconomics(long RevenueCents, long? EstimatedCostsCents, long ActualCostsCents, long? EstimatedContributionCents,
    long ActualContributionCents, bool HasActualCosts, string Caveat);

public static class HouseCalls
{
    public const string Caveat =
        "Contribution = revenue from this visit minus the direct costs recorded for it. It is before overheads, wages not recorded against the visit, and tax.";

    public static HouseCallEconomics Economics(long revenueCents, long? estimatedTravelCents, long? estimatedOtherCents, long actualCostsCents, bool hasActual)
    {
        long? estimated = estimatedTravelCents is null && estimatedOtherCents is null ? null : (estimatedTravelCents ?? 0) + (estimatedOtherCents ?? 0);
        return new HouseCallEconomics(revenueCents, estimated, actualCostsCents, estimated is null ? null : revenueCents - estimated,
            revenueCents - actualCostsCents, hasActual, Caveat);
    }
}
