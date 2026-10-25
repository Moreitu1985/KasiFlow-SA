namespace KasiFlow.Core.Bookings;

/// <summary>Check-ins a barber records during a house call. Each is a deliberate tap by the barber (or a manager on
/// their behalf after speaking to them) — there is no background tracking.</summary>
public static class SafetyCheckinKinds
{
    public const string Departed = "departed";
    public const string Arrived = "arrived";
    public const string Finished = "finished";
    public const string Returned = "returned";
    public const string Help = "help";
    public const string AllClear = "all_clear";

    public static readonly IReadOnlyList<string> All = [Departed, Arrived, Finished, Returned, Help, AllClear];

    public static string Label(string kind) => kind switch
    {
        Departed => "Left for the visit",
        Arrived => "Arrived",
        Finished => "Finished the visit",
        Returned => "Back safely",
        Help => "Asked for help",
        AllClear => "All clear",
        _ => kind
    };
}

public sealed record SafetyCheckin(string Kind, DateTimeOffset At);

/// <param name="Stage">not_started, departed, arrived, finished or returned.</param>
/// <param name="Overdue">An expected check-in is late. This is a prompt to phone the barber, not proof that something is wrong.</param>
public sealed record SafetyState(string Stage, string StageLabel, bool HelpActive, bool Overdue, string? OverdueReason, DateTimeOffset? CheckBy,
    IReadOnlyList<string> NextActions);

public static class HouseCallSafety
{
    public const int DefaultGraceMinutes = 30;

    private static readonly string[] Stages = [SafetyCheckinKinds.Departed, SafetyCheckinKinds.Arrived, SafetyCheckinKinds.Finished, SafetyCheckinKinds.Returned];

    /// <param name="active">False for cancelled, completed-and-returned or no-show visits: nothing is overdue then.</param>
    public static SafetyState Evaluate(IReadOnlyList<SafetyCheckin> checkins, DateTimeOffset startsAt, DateTimeOffset endsAt, int graceMinutes,
        DateTimeOffset now, bool active)
    {
        var ordered = checkins.OrderBy(c => c.At).ToList();
        var lastHelp = ordered.LastOrDefault(c => c.Kind == SafetyCheckinKinds.Help);
        var lastClear = ordered.LastOrDefault(c => c.Kind == SafetyCheckinKinds.AllClear);
        var helpActive = lastHelp is not null && (lastClear is null || lastClear.At < lastHelp.At);
        var stage = ordered.LastOrDefault(c => Stages.Contains(c.Kind))?.Kind ?? "not_started";
        var grace = TimeSpan.FromMinutes(Math.Clamp(graceMinutes, 10, 240));

        DateTimeOffset? checkBy = null;
        string? reason = null;
        if (active)
        {
            switch (stage)
            {
                case "not_started":
                    checkBy = startsAt + grace;
                    reason = "No check-in yet, and the visit was due to start";
                    break;
                case SafetyCheckinKinds.Departed:
                    checkBy = startsAt + grace;
                    reason = "Left for the visit but has not checked in as arrived";
                    break;
                case SafetyCheckinKinds.Arrived:
                    checkBy = endsAt + grace;
                    reason = "Arrived but has not checked in as finished";
                    break;
            }
        }
        var overdue = checkBy is { } by && now > by;

        var next = stage switch
        {
            "not_started" => new List<string> { SafetyCheckinKinds.Departed, SafetyCheckinKinds.Arrived },
            SafetyCheckinKinds.Departed => [SafetyCheckinKinds.Arrived],
            SafetyCheckinKinds.Arrived => [SafetyCheckinKinds.Finished],
            SafetyCheckinKinds.Finished => [SafetyCheckinKinds.Returned],
            _ => []
        };
        next.Add(helpActive ? SafetyCheckinKinds.AllClear : SafetyCheckinKinds.Help);

        var label = stage == "not_started" ? "No check-in yet" : SafetyCheckinKinds.Label(stage);
        return new SafetyState(stage, label, helpActive, overdue, overdue ? reason : null, checkBy, next);
    }

    /// <summary>Whether a check-in of this kind is allowed now (keeps the timeline in a sensible order).</summary>
    public static bool Allowed(SafetyState state, string kind) => state.NextActions.Contains(kind);
}

/// <summary>What a customer account must have before it can be used to book a house call.</summary>
public sealed record CustomerHouseCallProfile(string? FullName, string? ContactPhone, string? VerifiedContact, string? AddressLine, string? Suburb,
    string? Town, DateTimeOffset? TermsAcceptedAt, string? TermsVersion);

public static class CustomerReadiness
{
    public const string TermsVersion = "house-call-safety-v1";

    public const string Terms =
        "For house calls: (1) the business keeps your name, contact details and the visit address for its booking records and the barber's safety; " +
        "(2) the barber checks in with the business when leaving, arriving and finishing; (3) an adult must be present if the haircut is for a child; " +
        "(4) the barber may end the visit if they feel unsafe; (5) the travel fee shown before you book is part of the price.";

    public static IReadOnlyList<string> MissingForHouseCall(CustomerHouseCallProfile p)
    {
        var missing = new List<string>();
        if (string.IsNullOrWhiteSpace(p.VerifiedContact)) missing.Add("Verify your email or phone with a one-time code");
        if (string.IsNullOrWhiteSpace(p.FullName) || p.FullName.Trim().Length < 2) missing.Add("Your full name");
        if (string.IsNullOrWhiteSpace(p.ContactPhone)) missing.Add("A phone number the barber can call");
        if (string.IsNullOrWhiteSpace(p.AddressLine)) missing.Add("Your street address");
        if (string.IsNullOrWhiteSpace(p.Suburb) && string.IsNullOrWhiteSpace(p.Town)) missing.Add("Your suburb or town");
        if (p.TermsAcceptedAt is null || p.TermsVersion != TermsVersion) missing.Add("Agree to the house-call safety terms");
        return missing;
    }
}
