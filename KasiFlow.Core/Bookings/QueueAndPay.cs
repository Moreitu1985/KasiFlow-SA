namespace KasiFlow.Core.Bookings;

/// <summary>Walk-in queue statuses. A ticket moves waiting → called → in_chair → done, or ends as left / no_show.</summary>
public static class QueueStatuses
{
    public const string Waiting = "waiting";
    public const string Called = "called";
    public const string InChair = "in_chair";
    public const string Done = "done";
    public const string Left = "left";
    public const string NoShow = "no_show";

    public static readonly IReadOnlySet<string> Open = new HashSet<string> { Waiting, Called, InChair };

    public static string Label(string s) => s switch
    {
        Waiting => "Waiting",
        Called => "Called to the chair",
        InChair => "In the chair",
        Done => "Done",
        Left => "Left the queue",
        NoShow => "Didn't come up",
        _ => s
    };

    /// <summary>Allowed moves. Returns null when the move is not allowed.</summary>
    public static string? Next(string from, string action) => (from, action) switch
    {
        (Waiting, "call") => Called,
        (Waiting, "start") => InChair,
        (Called, "start") => InChair,
        (Called, "requeue") => Waiting,
        (InChair, "done") => Done,
        (Waiting or Called, "left") => Left,
        (Called, "no_show") => NoShow,
        _ => null
    };
}

/// <summary>
/// An honest wait estimate: the minutes of work ahead of you (people waiting in front, plus what is left of the cuts in
/// progress) shared across the barbers working now. It is an estimate, shown as a range, never a promise.
/// </summary>
public static class QueueEstimator
{
    public sealed record Estimate(int Minutes, int LowMinutes, int HighMinutes, string Label);

    /// <param name="aheadMinutes">Estimated minutes for each person waiting in front.</param>
    /// <param name="inChairRemaining">Minutes still left for each cut in progress (never below zero).</param>
    /// <param name="barbersWorking">Barbers currently cutting or free in the shop (at least 1 is assumed).</param>
    public static Estimate ForNext(IReadOnlyList<int> aheadMinutes, IReadOnlyList<int> inChairRemaining, int barbersWorking)
    {
        var barbers = Math.Max(1, barbersWorking);
        var work = aheadMinutes.Sum() + inChairRemaining.Sum(m => Math.Max(0, m));
        // Free chairs right now mean no wait for the first people.
        var freeChairs = Math.Max(0, barbers - inChairRemaining.Count);
        var minutes = aheadMinutes.Count < freeChairs ? 0 : (int)Math.Ceiling(work / (double)barbers);
        var low = (int)Math.Floor(minutes * 0.75);
        var high = (int)Math.Ceiling(minutes * 1.35) + (minutes > 0 ? 5 : 0);
        var label = minutes == 0 ? "A chair should be free now" : minutes < 60 ? $"About {Round5(low)}–{Round5(high)} min" : $"About {low / 60.0:0.#}–{high / 60.0:0.#} hours";
        return new Estimate(minutes, low, high, label);
    }

    private static int Round5(int m) => Math.Max(5, (int)Math.Round(m / 5.0) * 5);
}

public static class PayModes
{
    public const string Commission = "commission";
    public const string ChairRent = "chair_rent";
    public const string Wage = "wage";
    public static readonly IReadOnlySet<string> All = new HashSet<string> { Commission, ChairRent, Wage };

    public static string Label(string m) => m switch
    {
        Commission => "Commission on services",
        ChairRent => "Chair rent (keeps own takings)",
        Wage => "Weekly wage",
        _ => m
    };
}

public sealed record PayTerms(string Mode, decimal? CommissionPercent, long? ChairRentWeeklyCents, long? WageWeeklyCents);

/// <summary>A barber's statement for a period. "Shop owes barber" is positive; "barber owes shop" (chair rent) is negative.</summary>
public sealed record PayStatement(int Visits, long ServicesCents, long TravelFeesCents, long CommissionCents, long WageCents, long ChairRentCents,
    long EarnedCents, long PaidOutCents, long BalanceCents, string Explanation);

public static class PayCalculator
{
    /// <summary>Weeks in an inclusive date range (7 days = 1 week; partial weeks are pro-rated by day).</summary>
    public static decimal Weeks(DateOnly from, DateOnly to) => (to.DayNumber - from.DayNumber + 1) / 7m;

    /// <param name="servicesCents">Value of services the barber completed (after discounts), excluding travel fees.</param>
    /// <param name="paidOutCents">Payouts already recorded for this period (to the barber minus from the barber).</param>
    public static PayStatement Statement(PayTerms? terms, int visits, long servicesCents, long travelFeesCents, DateOnly from, DateOnly to, long paidOutCents)
    {
        if (terms is null)
            return new PayStatement(visits, servicesCents, travelFeesCents, 0, 0, 0, 0, paidOutCents, -paidOutCents,
                "No pay terms are set for this person yet, so nothing is calculated. The owner can set commission, chair rent or a wage.");
        var weeks = Weeks(from, to);
        long commission = 0, wage = 0, rent = 0;
        string why;
        switch (terms.Mode)
        {
            case PayModes.Commission:
                var pct = terms.CommissionPercent ?? 0;
                commission = (long)Math.Round(servicesCents * pct / 100m, MidpointRounding.AwayFromZero);
                why = $"{pct:0.##}% of services done ({Common.Money.FormatZar(servicesCents)}). Travel fees stay with the shop.";
                break;
            case PayModes.ChairRent:
                rent = (long)Math.Round((terms.ChairRentWeeklyCents ?? 0) * weeks, MidpointRounding.AwayFromZero);
                why = $"Chair rent of {Common.Money.FormatZar(terms.ChairRentWeeklyCents ?? 0)} a week for {weeks:0.#} week(s). The barber keeps their own takings.";
                break;
            default:
                wage = (long)Math.Round((terms.WageWeeklyCents ?? 0) * weeks, MidpointRounding.AwayFromZero);
                why = $"Wage of {Common.Money.FormatZar(terms.WageWeeklyCents ?? 0)} a week for {weeks:0.#} week(s).";
                break;
        }
        var earned = commission + wage - rent;
        return new PayStatement(visits, servicesCents, travelFeesCents, commission, wage, rent, earned, paidOutCents, earned - paidOutCents, why);
    }
}
