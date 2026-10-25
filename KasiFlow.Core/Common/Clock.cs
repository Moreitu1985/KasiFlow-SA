using System.Globalization;

namespace KasiFlow.Core.Common;

/// <summary>Abstraction over "now" so date-dependent calculations are deterministic in tests.</summary>
public interface IClock
{
    DateTimeOffset UtcNow { get; }

    /// <summary>Today's calendar date in South Africa (Africa/Johannesburg, UTC+2, no DST).</summary>
    DateOnly Today { get; }
}

public sealed class SouthAfricaClock : IClock
{
    // South Africa Standard Time is a fixed UTC+02:00 offset with no daylight saving.
    private static readonly TimeSpan Offset = TimeSpan.FromHours(2);

    public DateTimeOffset UtcNow => DateTimeOffset.UtcNow;

    public DateOnly Today => DateOnly.FromDateTime(UtcNow.ToOffset(Offset).DateTime);
}

public sealed class FixedClock(DateOnly today) : IClock
{
    public DateTimeOffset UtcNow => new(today.ToDateTime(new TimeOnly(10, 0)), TimeSpan.Zero);
    public DateOnly Today => today;
}

public static class Money
{
    private static readonly NumberFormatInfo Format = new()
    {
        NumberGroupSeparator = ",",
        NumberDecimalSeparator = ".",
        NumberGroupSizes = new[] { 3 }
    };

    /// <summary>Formats cents as South African rand, e.g. 150000 → "R1,500.00", -25000 → "-R250.00".
    /// Uses integer arithmetic only.</summary>
    public static string FormatZar(long cents)
    {
        var negative = cents < 0;
        // Avoid overflow on long.MinValue by working with decimal for the absolute value.
        var abs = Math.Abs((decimal)cents);
        var rands = decimal.Truncate(abs / 100m);
        var remainder = abs - rands * 100m;
        var text = $"R{rands.ToString("#,0", Format)}.{remainder:00}";
        return negative ? "-" + text : text;
    }

    /// <summary>Plain decimal rand string for CSV exports, e.g. 150000 → "1500.00".</summary>
    public static string ToRandString(long cents)
    {
        var negative = cents < 0;
        var abs = Math.Abs((decimal)cents);
        var rands = decimal.Truncate(abs / 100m);
        var remainder = abs - rands * 100m;
        var text = $"{rands.ToString("0", CultureInfo.InvariantCulture)}.{remainder:00}";
        return negative ? "-" + text : text;
    }
}

public sealed record DateRange(DateOnly From, DateOnly To, string Label)
{
    public bool Contains(DateOnly date) => date >= From && date <= To;
    public int Days => To.DayNumber - From.DayNumber + 1;
}

public static class Periods
{
    public const string ThisWeek = "this_week";
    public const string ThisMonth = "this_month";
    public const string LastMonth = "last_month";
    public const string Last30Days = "last_30_days";
    public const string Custom = "custom";

    public static readonly IReadOnlySet<string> All =
        new HashSet<string> { ThisWeek, ThisMonth, LastMonth, Last30Days, Custom };

    /// <summary>Maximum span of a custom reporting period, to keep queries bounded.</summary>
    public const int MaxCustomDays = 3 * 366;

    /// <summary>Resolves a named period relative to <paramref name="today"/>. Weeks start on Monday.</summary>
    public static DateRange Resolve(string? period, DateOnly today, DateOnly? from = null, DateOnly? to = null)
    {
        switch (period ?? ThisMonth)
        {
            case ThisWeek:
            {
                var offset = ((int)today.DayOfWeek + 6) % 7; // Monday = 0
                return new DateRange(today.AddDays(-offset), today, "This week");
            }
            case ThisMonth:
                return new DateRange(new DateOnly(today.Year, today.Month, 1), today, "This month");
            case LastMonth:
            {
                var firstThis = new DateOnly(today.Year, today.Month, 1);
                var firstLast = firstThis.AddMonths(-1);
                return new DateRange(firstLast, firstThis.AddDays(-1), "Last month");
            }
            case Last30Days:
                return new DateRange(today.AddDays(-29), today, "Last 30 days");
            case Custom:
                if (from is null || to is null)
                    throw new ArgumentException("A custom period needs both 'from' and 'to'.");
                if (to < from)
                    throw new ArgumentException("'to' must be on or after 'from'.");
                if (to.Value.DayNumber - from.Value.DayNumber + 1 > MaxCustomDays)
                    throw new ArgumentException($"A custom period may span at most {MaxCustomDays} days.");
                return new DateRange(from.Value, to.Value,
                    $"{from.Value.ToString("d MMM yyyy", CultureInfo.InvariantCulture)} – {to.Value.ToString("d MMM yyyy", CultureInfo.InvariantCulture)}");
            default:
                throw new ArgumentException($"Unknown period '{period}'.");
        }
    }

    public static string MonthKey(DateOnly date) => $"{date.Year:0000}-{date.Month:00}";

    public static string MonthLabel(DateOnly date) =>
        date.ToString("MMM yyyy", CultureInfo.InvariantCulture);
}
