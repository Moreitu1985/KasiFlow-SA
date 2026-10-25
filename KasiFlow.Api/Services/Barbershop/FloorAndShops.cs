using Dapper;
using KasiFlow.Api.Data;
using KasiFlow.Api.DTOs;
using KasiFlow.Core.Access;
using KasiFlow.Core.Bookings;
using KasiFlow.Core.Common;
using KasiFlow.Core.Validation;
using KasiFlow.Api.Middleware;

namespace KasiFlow.Api.Services.Barbershop;

// ============================================================================================ manager floor

public sealed record FloorBarberDto(Guid Id, string DisplayName, string RoleTitle, string Status, string StatusLabel, bool AvailableNow, bool Stale,
    string? Note, int BookingsToday, string? NextAt);

public sealed record FloorHouseCallDto(Guid BookingId, string Reference, string? StaffName, DateTimeOffset StartsAt, string Stage, string StageLabel,
    bool Overdue, bool HelpActive);

public sealed record FloorAttentionDto(string Kind, string Severity, string Title, string Detail, string Link);

/// <summary>The manager's "today on the floor": who is free, today's chairs, what needs a decision. Deliberately no
/// money totals or trends — those are the owner's business stats.</summary>
public sealed record FloorDto(DateOnly Date, int Requested, int Confirmed, int Completed, int NoShows, int HouseCalls,
    IReadOnlyList<FloorBarberDto> Team, IReadOnlyList<BookingSummaryDto> Today, IReadOnlyList<FloorHouseCallDto> HouseCallSafety,
    IReadOnlyList<FloorAttentionDto> NeedsAttention);

public sealed class FloorService(IDbConnectionFactory db, IBusinessContext business, BookingService bookings, TeamService team, IClock clock)
{
    public async Task<FloorDto> TodayAsync(CancellationToken ct)
    {
        var access = await business.RequireAsync(Permission.ManageBookings, Permission.ViewBookings, Permission.ManageStaffSchedules);
        var today = clock.Today;
        var now = clock.UtcNow;
        var list = await bookings.ListAsync(today, today, null, null, null, ct);
        await using var conn = await db.OpenAsync(ct);
        var people = await team.TeamAsync(conn, access);

        var teamDtos = people.Where(p => p.IsBookable).Select(p =>
        {
            var next = list.Where(b => b.StaffId == p.Id && b.Status == BookingStatuses.Confirmed && b.StartsAt > now).OrderBy(b => b.StartsAt).FirstOrDefault();
            return new FloorBarberDto(p.Id, p.DisplayName, p.RoleTitle, p.Status.Status, p.Status.Label, p.Status.AvailableNow, p.Status.Stale, p.Status.Note,
                p.BookingsToday, next?.StartsAt.ToOffset(StaffAvailability.SaOffset).ToString("HH:mm"));
        }).OrderByDescending(p => p.AvailableNow).ThenBy(p => p.DisplayName).ToList();

        var grace = await HouseCallSafetyService.GraceAsync(conn, access.BusinessId);
        var safety = new List<FloorHouseCallDto>();
        foreach (var hc in list.Where(b => b.LocationType == "house_call" && b.Status is BookingStatuses.Confirmed or BookingStatuses.Completed))
        {
            var row = await BookingEngine.GetAsync(conn, access.BusinessId, hc.Id);
            if (row is null) continue;
            var checkins = await conn.QueryAsync<(string Kind, DateTime At)>(
                "SELECT kind, created_at FROM house_call_checkins WHERE booking_id = @Id ORDER BY created_at", new { Id = hc.Id });
            var st = HouseCallSafetyService.State(row, checkins, grace, now);
            safety.Add(new FloorHouseCallDto(hc.Id, hc.Reference, hc.StaffName, hc.StartsAt, st.Stage, st.StageLabel, st.Overdue, st.HelpActive));
        }

        var attention = new List<FloorAttentionDto>();
        foreach (var s in safety.Where(s => s.HelpActive))
            attention.Add(new("safety", "critical", $"{s.StaffName ?? "A barber"} asked for help", $"House call {s.Reference}. Phone them now.", $"/bookings/{s.BookingId}"));
        foreach (var s in safety.Where(s => s.Overdue && !s.HelpActive))
            attention.Add(new("safety", "critical", $"Late check-in: {s.StaffName ?? "house call"}", $"{s.StageLabel} — {s.Reference}. Give them a call.", $"/bookings/{s.BookingId}"));
        var waiting = await conn.ExecuteScalarAsync<int>(
            """
            SELECT COUNT(*) FROM bookings WHERE business_id = @B AND starts_at > now()
              AND (status = 'requested' OR (status = 'reschedule_proposed' AND proposed_by = 'customer'))
              AND (@Branches::uuid[] IS NULL OR branch_id IS NULL OR branch_id = ANY(@Branches))
            """, new { B = access.BusinessId, Branches = access.BranchFilter });
        if (waiting > 0)
            attention.Add(new("bookings", "warning", $"{waiting} booking request{(waiting == 1 ? "" : "s")} waiting", "Confirm them or propose another time.", "/bookings?status=requested"));
        if (access.Can(Permission.ViewAlerts))
        {
            var alerts = await conn.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM alerts WHERE business_id = @B AND status = 'open' AND severity IN ('critical','warning') AND rule_code NOT LIKE 'HOUSE_CALL_%'",
                new { B = access.BusinessId });
            if (alerts > 0) attention.Add(new("alerts", "warning", $"{alerts} alert{(alerts == 1 ? "" : "s")} to check", "Warnings to verify — not proof of wrongdoing.", "/alerts"));
        }
        if (access.Can(Permission.ReviewShifts))
        {
            var cashups = await conn.ExecuteScalarAsync<int>(
                "SELECT COUNT(*) FROM shifts WHERE business_id = @B AND needs_review AND status = 'closed' AND (@Branches::uuid[] IS NULL OR branch_id = ANY(@Branches))",
                new { B = access.BusinessId, Branches = access.BranchFilter });
            if (cashups > 0) attention.Add(new("shifts", "warning", $"{cashups} cash-up{(cashups == 1 ? "" : "s")} to review", "A counted drawer differed from what was expected.", "/shifts"));
        }
        var stale = teamDtos.Count(t => t.Stale);
        if (stale > 0) attention.Add(new("team", "informational", $"{stale} status{(stale == 1 ? "" : "es")} not updated", "Ask the barber to update it so customers see the right times.", "/workspace"));

        return new FloorDto(today, list.Count(b => b.Status == BookingStatuses.Requested), list.Count(b => b.Status == BookingStatuses.Confirmed),
            list.Count(b => b.Status == BookingStatuses.Completed), list.Count(b => b.Status == BookingStatuses.NoShow),
            list.Count(b => b.LocationType == "house_call" && b.Status is not (BookingStatuses.Cancelled or BookingStatuses.NoShow)),
            teamDtos, list.OrderBy(b => b.StartsAt).ToList(), safety, attention);
    }
}

// ============================================================================================ customer shop catalogue

public sealed record ShopCardDto(string Slug, string Name, string? Town, string? Description, string? Category, int ServiceCount, long? PriceFromCents,
    int BarberCount, int AvailableNow, bool HouseCalls, int PhotoCount, string? CoverPhotoUrl, string BookPath);

/// <summary>Published shops customers can browse. Only what each owner chose to publish — never internal data.</summary>
public sealed class ShopDirectoryService(IDbConnectionFactory db)
{
    private sealed class Row
    {
        public Guid BusinessId { get; set; }
        public string Slug { get; set; } = "";
        public string Name { get; set; } = "";
        public string? Town { get; set; }
        public bool ShowTown { get; set; }
        public string? Description { get; set; }
        public string? Category { get; set; }
        public int ServiceCount { get; set; }
        public long? PriceFrom { get; set; }
        public int BarberCount { get; set; }
        public bool HouseCalls { get; set; }
        public int PhotoCount { get; set; }
        public Guid? CoverPhoto { get; set; }
    }

    public async Task<IReadOnlyList<ShopCardDto>> ListAsync(string? q, CancellationToken ct)
    {
        var term = string.IsNullOrWhiteSpace(q) ? null : q.Trim();
        if (term is { Length: > 60 }) throw new RequestValidationException(new ValidationErrors().Add("q", "Use 60 characters or fewer."));
        await using var conn = await db.OpenAsync(ct);
        var rows = await conn.QueryAsync<Row>(
            """
            SELECT p.business_id, p.slug, b.name, b.town, p.show_town, p.description, p.category,
                   (SELECT COUNT(*) FROM services s WHERE s.business_id = p.business_id AND s.is_active AND s.is_public)::int AS service_count,
                   (SELECT MIN(s.price_cents) FROM services s WHERE s.business_id = p.business_id AND s.is_active AND s.is_public) AS price_from,
                   (SELECT COUNT(*) FROM staff_profiles sp WHERE sp.business_id = p.business_id AND sp.is_active AND sp.is_bookable)::int AS barber_count,
                   COALESCE(st.house_calls_enabled, FALSE) AS house_calls,
                   (SELECT COUNT(*) FROM staff_portfolio_photos ph JOIN staff_profiles sp ON sp.id = ph.staff_id
                     WHERE ph.business_id = p.business_id AND ph.is_public AND sp.is_active AND sp.is_bookable)::int AS photo_count,
                   (SELECT ph.id FROM staff_portfolio_photos ph JOIN staff_profiles sp ON sp.id = ph.staff_id
                     WHERE ph.business_id = p.business_id AND ph.is_public AND sp.is_active AND sp.is_bookable ORDER BY ph.sort_order, ph.created_at DESC LIMIT 1) AS cover_photo
            FROM public_profiles p JOIN businesses b ON b.id = p.business_id
            LEFT JOIN business_settings st ON st.business_id = p.business_id
            WHERE p.is_published
              AND (@Q::text IS NULL OR b.name ILIKE '%' || @Q || '%' OR (p.show_town AND b.town ILIKE '%' || @Q || '%') OR p.category ILIKE '%' || @Q || '%')
            ORDER BY b.name LIMIT 50
            """, new { Q = term });
        var list = rows.ToList();
        var available = new Dictionary<Guid, int>();
        var now = DateTimeOffset.UtcNow;
        foreach (var r in list)
        {
            var staff = (await TeamRepository.ListAsync(conn, r.BusinessId)).Where(s => s.IsActive && s.IsBookable).ToList();
            var sched = await TeamRepository.SchedulesAsync(conn, r.BusinessId, staff, now.AddDays(-1), now.AddDays(1));
            available[r.BusinessId] = staff.Count(s => StaffAvailability.AvailableNow(sched[s.Id].Effective(now), now, sched[s.Id].Hours));
        }
        return list.Select(r => new ShopCardDto(r.Slug, r.Name, r.ShowTown ? r.Town : null, r.Description, r.Category, r.ServiceCount, r.PriceFrom, r.BarberCount,
            available.GetValueOrDefault(r.BusinessId), r.HouseCalls, r.PhotoCount, r.CoverPhoto is { } c ? $"/api/public/profiles/{r.Slug}/photos/{c}" : null,
            $"/p/{r.Slug}/book")).ToList();
    }
}
