namespace KasiFlow.Core.Bookings;

public static class StaffStatuses
{
    public const string Available = "available";
    public const string Busy = "busy";
    public const string HouseCall = "house_call";
    public const string OnBreak = "on_break";
    public const string Unavailable = "unavailable";
    public const string OffDuty = "off_duty";

    public static readonly IReadOnlyList<string> All = [Available, Busy, HouseCall, OnBreak, Unavailable, OffDuty];

    public static string Label(string s) => s switch
    {
        Available => "Available",
        Busy => "Busy",
        HouseCall => "On a house call",
        OnBreak => "On break",
        Unavailable => "Unavailable",
        OffDuty => "Off duty",
        _ => s
    };

    /// <summary>Statuses that mean "with a customer or away right now". The app never promises immediate service.</summary>
    public static bool IsTemporarilyAway(string s) => s is Busy or HouseCall or OnBreak;
}

/// <summary>A status as stored, with an optional expiry.</summary>
public sealed record StoredStatus(string Status, DateTimeOffset UpdatedAt, DateTimeOffset? ExpiresAt, string? RevertTo, string? Note = null);

/// <summary>The status that applies now, after expiry and staleness rules.</summary>
public sealed record EffectiveStatus(string Status, bool Expired, bool Stale, string Explanation);

public sealed record WorkingHours(int Weekday, TimeOnly Start, TimeOnly End);

public sealed record TimeOff(DateTimeOffset StartsAt, DateTimeOffset EndsAt);

public sealed record BusyInterval(DateTimeOffset StartsAt, DateTimeOffset EndsAt);

/// <summary>
/// Availability rules (documented in docs/BARBERSHOP.md):
/// <list type="bullet">
/// <item>A temporary status ends at its expiry time and falls back to the chosen status (default: Available during working
/// hours, otherwise Off duty).</item>
/// <item>Busy, On a house call and On break that have not been updated for <see cref="StaleAfter"/> are treated as stale:
/// they are shown with a warning and never used to promise immediate availability.</item>
/// <item>Off duty blocks new booking requests for the rest of the current working day (or until its expiry). Unavailable
/// blocks new requests until it is changed or expires. The owner may confirm an exception when the business allows it.</item>
/// </list>
/// </summary>
public static class StaffAvailability
{
    public static readonly TimeSpan StaleAfter = TimeSpan.FromHours(4);
    public static readonly TimeSpan SaOffset = TimeSpan.FromHours(2);

    public static EffectiveStatus Effective(StoredStatus? stored, DateTimeOffset now, IReadOnlyList<WorkingHours> hours)
    {
        if (stored is null)
            return new EffectiveStatus(InWorkingHours(now, hours) ? StaffStatuses.Unavailable : StaffStatuses.OffDuty, false, false,
                "No status has been set yet.");
        if (stored.ExpiresAt is { } exp && exp <= now)
        {
            var fallback = stored.RevertTo ?? (InWorkingHours(now, hours) ? StaffStatuses.Available : StaffStatuses.OffDuty);
            return new EffectiveStatus(fallback, true, false, $"The temporary status ended at {exp.ToOffset(SaOffset):HH:mm}.");
        }
        if (StaffStatuses.IsTemporarilyAway(stored.Status) && now - stored.UpdatedAt > StaleAfter)
            return new EffectiveStatus(stored.Status, false, true,
                $"Not updated since {stored.UpdatedAt.ToOffset(SaOffset):ddd HH:mm}. It may be out of date.");
        return new EffectiveStatus(stored.Status, false, false, "");
    }

    public static bool InWorkingHours(DateTimeOffset at, IReadOnlyList<WorkingHours> hours)
    {
        var local = at.ToOffset(SaOffset);
        var t = TimeOnly.FromDateTime(local.DateTime);
        return hours.Any(h => h.Weekday == (int)local.DayOfWeek && t >= h.Start && t < h.End);
    }

    /// <summary>Until when the current status blocks new booking requests (null = it does not block).</summary>
    public static DateTimeOffset? BlocksNewBookingsUntil(EffectiveStatus status, StoredStatus? stored, DateTimeOffset now)
    {
        if (status.Expired) return null;
        if (status.Status == StaffStatuses.Unavailable)
            return stored?.ExpiresAt ?? DateTimeOffset.MaxValue;
        if (status.Status == StaffStatuses.OffDuty)
        {
            if (stored?.ExpiresAt is { } e) return e;
            // Finished for the day: blocks until the start of tomorrow (South African time).
            var local = now.ToOffset(SaOffset);
            return new DateTimeOffset(local.Date.AddDays(1), SaOffset);
        }
        return null;
    }

    /// <summary>Whether this barber could be offered as "available right now".</summary>
    public static bool AvailableNow(EffectiveStatus s, DateTimeOffset now, IReadOnlyList<WorkingHours> hours) =>
        s.Status == StaffStatuses.Available && !s.Stale && InWorkingHours(now, hours);
}

public sealed record SlotQuery(DateOnly Date, int DurationMinutes, int IntervalMinutes, DateTimeOffset Now, int LeadMinutes);

public sealed record Slot(DateTimeOffset StartsAt, DateTimeOffset EndsAt);

/// <summary>Free appointment slots for one barber on one day: inside working hours, outside time off, not overlapping
/// confirmed appointments, after the lead time, and not while a blocking status applies.</summary>
public static class SlotFinder
{
    public static IReadOnlyList<Slot> FreeSlots(SlotQuery q, IReadOnlyList<WorkingHours> hours, IReadOnlyList<TimeOff> timeOff,
        IReadOnlyList<BusyInterval> busy, DateTimeOffset? blockedUntil)
    {
        if (q.DurationMinutes <= 0 || q.IntervalMinutes <= 0) throw new ArgumentOutOfRangeException(nameof(q));
        var earliest = q.Now.AddMinutes(q.LeadMinutes);
        if (blockedUntil is { } b && b > earliest) earliest = b;
        var weekday = (int)q.Date.DayOfWeek;
        var result = new List<Slot>();
        foreach (var h in hours.Where(h => h.Weekday == weekday).OrderBy(h => h.Start))
        {
            var dayStart = new DateTimeOffset(q.Date.ToDateTime(h.Start), StaffAvailability.SaOffset);
            var dayEnd = new DateTimeOffset(q.Date.ToDateTime(h.End), StaffAvailability.SaOffset);
            for (var s = dayStart; s.AddMinutes(q.DurationMinutes) <= dayEnd; s = s.AddMinutes(q.IntervalMinutes))
            {
                var e = s.AddMinutes(q.DurationMinutes);
                if (s < earliest) continue;
                if (timeOff.Any(t => Overlaps(s, e, t.StartsAt, t.EndsAt))) continue;
                if (busy.Any(x => Overlaps(s, e, x.StartsAt, x.EndsAt))) continue;
                result.Add(new Slot(s, e));
            }
        }
        return result;
    }

    public static bool Overlaps(DateTimeOffset aStart, DateTimeOffset aEnd, DateTimeOffset bStart, DateTimeOffset bEnd) =>
        aStart < bEnd && bStart < aEnd;

    /// <summary>Why a specific requested time is not possible, or null when it is.</summary>
    public static string? WhyNot(DateTimeOffset start, DateTimeOffset end, DateTimeOffset now, int leadMinutes, IReadOnlyList<WorkingHours> hours,
        IReadOnlyList<TimeOff> timeOff, IReadOnlyList<BusyInterval> busy, DateTimeOffset? blockedUntil)
    {
        if (start < now.AddMinutes(leadMinutes)) return "That time is too soon. Choose a later time.";
        if (blockedUntil is { } b && start < b) return "This barber is not taking new bookings for that time.";
        var local = start.ToOffset(StaffAvailability.SaOffset);
        var localEnd = end.ToOffset(StaffAvailability.SaOffset);
        var inHours = hours.Any(h => h.Weekday == (int)local.DayOfWeek && local.Date == localEnd.Date
                                     && TimeOnly.FromDateTime(local.DateTime) >= h.Start && TimeOnly.FromDateTime(localEnd.DateTime) <= h.End);
        if (!inHours) return "That time is outside this barber's working hours.";
        if (timeOff.Any(t => Overlaps(start, end, t.StartsAt, t.EndsAt))) return "This barber is away at that time.";
        if (busy.Any(x => Overlaps(start, end, x.StartsAt, x.EndsAt))) return "This barber already has a confirmed appointment at that time.";
        return null;
    }
}
