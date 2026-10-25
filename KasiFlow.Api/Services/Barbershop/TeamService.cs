using System.Data;
using System.Text.Json;
using Dapper;
using KasiFlow.Api.Data;
using KasiFlow.Api.DTOs;
using KasiFlow.Api.Middleware;
using KasiFlow.Api.Repositories;
using KasiFlow.Core.Access;
using KasiFlow.Core.Bookings;
using KasiFlow.Core.Common;
using KasiFlow.Core.Validation;

namespace KasiFlow.Api.Services.Barbershop;

public sealed class StaffRow
{
    public Guid Id { get; set; }
    public Guid BusinessId { get; set; }
    public Guid? UserId { get; set; }
    public string DisplayName { get; set; } = "";
    public string RoleTitle { get; set; } = "";
    public Guid? BranchId { get; set; }
    public bool IsBookable { get; set; }
    public bool AcceptsHouseCalls { get; set; }
    public bool IsActive { get; set; }
    public string? Bio { get; set; }
    public string? Specialties { get; set; }
    public string? ContactPhone { get; set; }
    public string? EmergencyContactName { get; set; }
    public string? EmergencyContactPhone { get; set; }
}

public sealed class StatusRow
{
    public Guid StaffId { get; set; }
    public string Status { get; set; } = "";
    public string? Note { get; set; }
    public DateTime? ExpiresAt { get; set; }
    public string? RevertTo { get; set; }
    public DateTime UpdatedAt { get; set; }
}

public sealed class HoursRow
{
    public Guid StaffId { get; set; }
    public int Weekday { get; set; }
    public string StartTime { get; set; } = "";
    public string EndTime { get; set; } = "";
}

public sealed class TimeOffRow
{
    public Guid Id { get; set; }
    public Guid StaffId { get; set; }
    public DateTime StartsAt { get; set; }
    public DateTime EndsAt { get; set; }
    public string Kind { get; set; } = "";
    public string? Note { get; set; }
}

/// <summary>Everything needed to decide one barber's availability.</summary>
public sealed record StaffSchedule(StaffRow Staff, StoredStatus? Stored, IReadOnlyList<WorkingHours> Hours, IReadOnlyList<TimeOff> TimeOff)
{
    public EffectiveStatus Effective(DateTimeOffset now) => StaffAvailability.Effective(Stored, now, Hours);
    public DateTimeOffset? BlockedUntil(DateTimeOffset now) => StaffAvailability.BlocksNewBookingsUntil(Effective(now), Stored, now);
}

public static class TeamRepository
{
    public static DateTimeOffset Utc(DateTime d) => new(DateTime.SpecifyKind(d, DateTimeKind.Utc));
    public static DateTimeOffset? Utc(DateTime? d) => d is { } v ? Utc(v) : null;

    private const string StaffCols = "id, business_id, user_id, display_name, role_title, branch_id, is_bookable, accepts_house_calls, is_active, bio, specialties, contact_phone, emergency_contact_name, emergency_contact_phone";

    public static async Task<IReadOnlyList<StaffRow>> ListAsync(IDbConnection conn, Guid businessId, IDbTransaction? tx = null) =>
        (await conn.QueryAsync<StaffRow>($"SELECT {StaffCols} FROM staff_profiles WHERE business_id = @B ORDER BY is_active DESC, display_name", new { B = businessId }, tx)).ToList();

    public static Task<StaffRow?> GetAsync(IDbConnection conn, Guid businessId, Guid id, IDbTransaction? tx = null) =>
        conn.QueryFirstOrDefaultAsync<StaffRow>($"SELECT {StaffCols} FROM staff_profiles WHERE business_id = @B AND id = @Id", new { B = businessId, Id = id }, tx);

    public static Task<StaffRow?> ForUserAsync(IDbConnection conn, Guid businessId, Guid userId) =>
        conn.QueryFirstOrDefaultAsync<StaffRow>($"SELECT {StaffCols} FROM staff_profiles WHERE business_id = @B AND user_id = @U AND is_active", new { B = businessId, U = userId });

    public static async Task<Dictionary<Guid, StaffSchedule>> SchedulesAsync(IDbConnection conn, Guid businessId, IReadOnlyCollection<StaffRow> staff,
        DateTimeOffset from, DateTimeOffset to, IDbTransaction? tx = null)
    {
        var ids = staff.Select(s => s.Id).ToArray();
        var status = (await conn.QueryAsync<StatusRow>(
            "SELECT staff_id, status, note, expires_at, revert_to, updated_at FROM staff_status WHERE business_id = @B AND staff_id = ANY(@Ids)",
            new { B = businessId, Ids = ids }, tx)).ToDictionary(s => s.StaffId);
        var hours = (await conn.QueryAsync<HoursRow>(
            "SELECT staff_id, weekday, to_char(start_time, 'HH24:MI') AS start_time, to_char(end_time, 'HH24:MI') AS end_time FROM staff_working_hours WHERE business_id = @B AND staff_id = ANY(@Ids)",
            new { B = businessId, Ids = ids }, tx)).ToLookup(h => h.StaffId);
        var off = (await conn.QueryAsync<TimeOffRow>(
            "SELECT id, staff_id, starts_at, ends_at, kind, note FROM staff_time_off WHERE business_id = @B AND staff_id = ANY(@Ids) AND ends_at > @From AND starts_at < @To",
            new { B = businessId, Ids = ids, From = from.UtcDateTime, To = to.UtcDateTime }, tx)).ToLookup(t => t.StaffId);
        return staff.ToDictionary(s => s.Id, s => new StaffSchedule(s,
            status.TryGetValue(s.Id, out var st) ? new StoredStatus(st.Status, Utc(st.UpdatedAt), Utc(st.ExpiresAt), st.RevertTo, st.Note) : null,
            hours[s.Id].Select(h => new WorkingHours(h.Weekday, TimeOnly.Parse(h.StartTime), TimeOnly.Parse(h.EndTime))).ToList(),
            off[s.Id].Select(t => new TimeOff(Utc(t.StartsAt), Utc(t.EndsAt))).ToList()));
    }

    public static async Task<IReadOnlyList<BusyInterval>> ConfirmedAsync(IDbConnection conn, Guid businessId, Guid staffId, DateTimeOffset from,
        DateTimeOffset to, Guid? exceptBooking = null, IDbTransaction? tx = null) =>
        (await conn.QueryAsync<(DateTime S, DateTime E)>(
            "SELECT starts_at, ends_at FROM bookings WHERE business_id = @B AND staff_id = @S AND status = 'confirmed' AND ends_at > @From AND starts_at < @To AND (@Except::uuid IS NULL OR id <> @Except::uuid)",
            new { B = businessId, S = staffId, From = from.UtcDateTime, To = to.UtcDateTime, Except = exceptBooking }, tx))
        .Select(x => new BusyInterval(Utc(x.S), Utc(x.E))).ToList();

    /// <summary>Writes a status and its history row. Used by people, booking automation and the expiry job.</summary>
    public static async Task SetStatusAsync(IDbConnection conn, IDbTransaction? tx, Guid businessId, Guid staffId, string status, string? note,
        DateTimeOffset? expiresAt, string? revertTo, Guid? userId, string source)
    {
        await conn.ExecuteAsync(
            """
            INSERT INTO staff_status (staff_id, business_id, status, note, expires_at, revert_to, updated_by, updated_at)
            VALUES (@S, @B, @Status, @Note, @Exp, @Revert, @U, now())
            ON CONFLICT (staff_id) DO UPDATE SET status = EXCLUDED.status, note = EXCLUDED.note, expires_at = EXCLUDED.expires_at,
                revert_to = EXCLUDED.revert_to, updated_by = EXCLUDED.updated_by, updated_at = now()
            """, new { S = staffId, B = businessId, Status = status, Note = note, Exp = expiresAt?.UtcDateTime, Revert = revertTo, U = userId }, tx);
        await conn.ExecuteAsync(
            "INSERT INTO staff_status_history (business_id, staff_id, status, note, expires_at, source, changed_by) VALUES (@B, @S, @Status, @Note, @Exp, @Source, @U)",
            new { B = businessId, S = staffId, Status = status, Note = note, Exp = expiresAt?.UtcDateTime, Source = source, U = userId }, tx);
    }

    /// <summary>Background job: temporary statuses whose time is up fall back to their chosen status (history kept).</summary>
    public static async Task<int> ExpireStatusesAsync(IDbConnection conn)
    {
        var due = (await conn.QueryAsync<(Guid StaffId, Guid BusinessId, string? RevertTo)>(
            "SELECT staff_id, business_id, revert_to FROM staff_status WHERE expires_at IS NOT NULL AND expires_at <= now() LIMIT 200")).ToList();
        foreach (var d in due)
        {
            using var tx = conn.BeginTransaction();
            var hours = (await conn.QueryAsync<HoursRow>(
                "SELECT staff_id, weekday, to_char(start_time, 'HH24:MI') AS start_time, to_char(end_time, 'HH24:MI') AS end_time FROM staff_working_hours WHERE staff_id = @S",
                new { S = d.StaffId }, tx)).Select(h => new WorkingHours(h.Weekday, TimeOnly.Parse(h.StartTime), TimeOnly.Parse(h.EndTime))).ToList();
            var next = d.RevertTo ?? (StaffAvailability.InWorkingHours(DateTimeOffset.UtcNow, hours) ? StaffStatuses.Available : StaffStatuses.OffDuty);
            var n = await conn.ExecuteAsync("UPDATE staff_status SET status = @Next, note = NULL, expires_at = NULL, revert_to = NULL, updated_at = now() WHERE staff_id = @S AND expires_at <= now()",
                new { Next = next, S = d.StaffId }, tx);
            if (n > 0)
                await conn.ExecuteAsync("INSERT INTO staff_status_history (business_id, staff_id, status, note, source) VALUES (@B, @S, @Next, 'Temporary status ended', 'expiry')",
                    new { B = d.BusinessId, S = d.StaffId, Next = next }, tx);
            tx.Commit();
        }
        return due.Count;
    }

    public static StaffStatusDto StatusDto(StaffSchedule sch, DateTimeOffset now)
    {
        var eff = sch.Effective(now);
        var stored = sch.Stored;
        return new StaffStatusDto(eff.Status, StaffStatuses.Label(eff.Status), eff.Expired ? null : stored?.Note,
            stored?.UpdatedAt ?? DateTimeOffset.MinValue, eff.Expired ? null : stored?.ExpiresAt, eff.Expired, eff.Stale,
            string.IsNullOrEmpty(eff.Explanation) ? null : eff.Explanation, StaffAvailability.AvailableNow(eff, now, sch.Hours),
            sch.BlockedUntil(now) is not null);
    }

    /// <summary>Sends an in-app notification to one person (respecting their in-app preference).</summary>
    public static Task NotifyUserAsync(IDbConnection conn, IDbTransaction? tx, Guid businessId, Guid userId, string kind, string severity,
        string title, string body, string? link, string? dedupeKey) =>
        conn.ExecuteAsync(
            """
            INSERT INTO notifications (business_id, user_id, kind, severity, title, body, link, dedupe_key)
            SELECT @B, @U, @Kind, @Severity, @Title, @Body, @Link, @Key
            WHERE EXISTS (SELECT 1 FROM business_members m WHERE m.business_id = @B AND m.user_id = @U AND m.is_active)
              AND COALESCE((SELECT in_app FROM notification_preferences WHERE business_id = @B AND user_id = @U), TRUE)
            ON CONFLICT (business_id, user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
            """, new { B = businessId, U = userId, Kind = kind, Severity = severity, Title = title, Body = body, Link = link, Key = dedupeKey }, tx);
}

/// <summary>Team profiles, live status, working hours, time off and which services each person offers.</summary>
public sealed class TeamService(IDbConnectionFactory db, IBusinessContext business, IClock clock)
{
    public static readonly string[] TimeOffKinds = ["leave", "class", "exam", "personal", "other"];

    internal async Task<IReadOnlyList<StaffProfileDto>> TeamAsync(IDbConnection conn, AccessContext access)
    {
        var now = clock.UtcNow;
        var staff = (await TeamRepository.ListAsync(conn, access.BusinessId)).Where(s => s.IsActive && (access.AllBranches || s.BranchId is null || access.CanSeeBranch(s.BranchId))).ToList();
        var sched = await TeamRepository.SchedulesAsync(conn, access.BusinessId, staff, now.AddDays(-1), now.AddDays(1));
        var services = (await conn.QueryAsync<(Guid StaffId, Guid ServiceId, string Name, long Price, bool Own)>(
            """
            SELECT ss.staff_id, s.id, s.name, COALESCE(ss.price_cents, s.price_cents), ss.price_cents IS NOT NULL
            FROM staff_services ss JOIN services s ON s.id = ss.service_id WHERE ss.business_id = @B AND s.is_active ORDER BY s.sort_order, s.name
            """, new { B = access.BusinessId })).ToLookup(x => x.StaffId);
        var today = (await conn.QueryAsync<(Guid StaffId, int N)>(
            """
            SELECT staff_id, COUNT(*)::int FROM bookings WHERE business_id = @B AND staff_id IS NOT NULL AND status IN ('confirmed','requested','reschedule_proposed','completed')
              AND (starts_at AT TIME ZONE 'Africa/Johannesburg')::date = (now() AT TIME ZONE 'Africa/Johannesburg')::date GROUP BY staff_id
            """, new { B = access.BusinessId })).ToDictionary(x => x.StaffId, x => x.N);
        var photos = (await conn.QueryAsync<(Guid StaffId, int N)>(
            "SELECT staff_id, COUNT(*)::int FROM staff_portfolio_photos WHERE business_id = @B GROUP BY staff_id", new { B = access.BusinessId })).ToDictionary(x => x.StaffId, x => x.N);
        var pending = (await conn.QueryAsync<(Guid StaffId, string Email, DateTime Exp)>(
            "SELECT staff_profile_id, email, expires_at FROM staff_invitations WHERE business_id = @B AND status = 'pending' AND expires_at > now() AND staff_profile_id IS NOT NULL",
            new { B = access.BusinessId })).GroupBy(x => x.StaffId).ToDictionary(g => g.Key, g => g.First());
        var managers = access.Can(Permission.ManageStaff);
        return staff.Select(s => ToDto(s, sched[s.Id], now, access.UserId, services[s.Id].Select(x => new StaffServiceDto(x.ServiceId, x.Name, x.Price, x.Own)).ToList(),
            today.GetValueOrDefault(s.Id), managers || s.UserId == access.UserId, photos.GetValueOrDefault(s.Id),
            pending.TryGetValue(s.Id, out var inv) ? new PendingLoginDto(inv.Email, Utc(inv.Exp)) : null)).ToList();
    }

    private static DateTimeOffset Utc(DateTime d) => new(DateTime.SpecifyKind(d, DateTimeKind.Utc));

    private static StaffProfileDto ToDto(StaffRow s, StaffSchedule sch, DateTimeOffset now, Guid me, IReadOnlyList<StaffServiceDto> services, int today,
        bool showPrivate, int photoCount, PendingLoginDto? pendingLogin) =>
        new(s.Id, s.DisplayName, s.RoleTitle, s.BranchId, s.UserId, s.IsBookable, s.AcceptsHouseCalls, s.IsActive, s.UserId == me,
            TeamRepository.StatusDto(sch, now),
            sch.Hours.OrderBy(h => h.Weekday).ThenBy(h => h.Start).Select(h => new WorkingHoursDto(h.Weekday, h.Start.ToString("HH:mm"), h.End.ToString("HH:mm"))).ToList(),
            services, today, s.Bio, s.Specialties, showPrivate ? s.ContactPhone : null, showPrivate ? s.EmergencyContactName : null,
            showPrivate ? s.EmergencyContactPhone : null, s.UserId is not null, photoCount, showPrivate ? pendingLogin : null);

    public async Task<IReadOnlyList<StaffProfileDto>> ListAsync(CancellationToken ct)
    {
        var access = await business.RequireAsync(Permission.ViewTeamStatus, Permission.ManageStaffSchedules, Permission.ViewStaff, Permission.ManageBookings);
        await using var conn = await db.OpenAsync(ct);
        return await TeamAsync(conn, access);
    }

    private static ValidationErrors Validate(StaffProfileInput i)
    {
        var e = new ValidationErrors();
        e.Required("displayName", i.DisplayName, 1, 80);
        e.Optional("roleTitle", i.RoleTitle, 60);
        e.Optional("bio", i.Bio, 300);
        e.Optional("specialties", i.Specialties, 120);
        e.Phone("contactPhone", i.ContactPhone);
        e.Optional("emergencyContactName", i.EmergencyContactName, 80);
        e.Phone("emergencyContactPhone", i.EmergencyContactPhone);
        return e;
    }

    public async Task<StaffProfileDto> CreateAsync(StaffProfileInput input, CancellationToken ct)
    {
        RequestValidationException.ThrowIfInvalid(Validate(input));
        var access = await business.RequireAsync(Permission.ManageStaff);
        await using var conn = await db.OpenAsync(ct);
        await CheckLinksAsync(conn, access, input, null);
        var id = await conn.QuerySingleAsync<Guid>(
            """
            INSERT INTO staff_profiles (business_id, user_id, display_name, role_title, branch_id, is_bookable, accepts_house_calls, bio, specialties,
                contact_phone, emergency_contact_name, emergency_contact_phone)
            VALUES (@B, @U, @Name, @Title, @Branch, @Bookable, @House, @Bio, @Spec, @Phone, @EName, @EPhone) RETURNING id
            """, new { B = access.BusinessId, U = input.UserId, Name = input.DisplayName!.Trim(), Title = string.IsNullOrWhiteSpace(input.RoleTitle) ? "Barber" : input.RoleTitle.Trim(),
                Branch = input.BranchId, Bookable = input.IsBookable ?? true, House = input.AcceptsHouseCalls ?? false, Bio = Clean(input.Bio), Spec = Clean(input.Specialties),
                Phone = Clean(input.ContactPhone), EName = Clean(input.EmergencyContactName), EPhone = Clean(input.EmergencyContactPhone) });
        await TeamRepository.SetStatusAsync(conn, null, access.BusinessId, id, StaffStatuses.OffDuty, null, null, null, access.UserId, "system");
        await AuditRepository.WriteAsync(conn, null, access.BusinessId, access.UserId, "staff_profile_created", "staff_profile", id);
        return (await TeamAsync(conn, access)).First(s => s.Id == id);
    }

    public async Task<StaffProfileDto> UpdateAsync(Guid id, StaffProfileInput input, CancellationToken ct)
    {
        RequestValidationException.ThrowIfInvalid(Validate(input));
        var access = await business.RequireAsync(Permission.ManageStaff);
        await using var conn = await db.OpenAsync(ct);
        _ = await TeamRepository.GetAsync(conn, access.BusinessId, id) ?? throw new NotFoundException();
        await CheckLinksAsync(conn, access, input, id);
        await conn.ExecuteAsync(
            """
            UPDATE staff_profiles SET display_name = @Name, role_title = COALESCE(@Title, role_title), branch_id = @Branch, user_id = @U,
                is_bookable = COALESCE(@Bookable, is_bookable), accepts_house_calls = COALESCE(@House, accepts_house_calls),
                is_active = COALESCE(@Active, is_active), bio = @Bio, specialties = @Spec, contact_phone = @Phone, emergency_contact_name = @EName,
                emergency_contact_phone = @EPhone, updated_at = now()
            WHERE id = @Id AND business_id = @B
            """, new { Id = id, B = access.BusinessId, Name = input.DisplayName!.Trim(), Title = string.IsNullOrWhiteSpace(input.RoleTitle) ? null : input.RoleTitle.Trim(),
                Branch = input.BranchId, U = input.UserId, Bookable = input.IsBookable, House = input.AcceptsHouseCalls, Active = input.IsActive, Bio = Clean(input.Bio),
                Spec = Clean(input.Specialties), Phone = Clean(input.ContactPhone), EName = Clean(input.EmergencyContactName), EPhone = Clean(input.EmergencyContactPhone) });
        await AuditRepository.WriteAsync(conn, null, access.BusinessId, access.UserId, "staff_profile_updated", "staff_profile", id);
        var list = await TeamAsync(conn, access);
        return list.FirstOrDefault(s => s.Id == id) ?? throw new NotFoundException("The profile is inactive.");
    }

    internal static string? Clean(string? v) => string.IsNullOrWhiteSpace(v) ? null : v.Trim();

    private static async Task CheckLinksAsync(IDbConnection conn, AccessContext access, StaffProfileInput input, Guid? id)
    {
        if (input.BranchId is { } b && await conn.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM branches WHERE id = @Id AND business_id = @B", new { Id = b, B = access.BusinessId }) == 0)
            throw new RequestValidationException(new ValidationErrors().Add("branchId", "Choose one of your branches."));
        if (input.UserId is { } u)
        {
            if (await conn.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM business_members WHERE business_id = @B AND user_id = @U AND is_active", new { B = access.BusinessId, U = u }) == 0)
                throw new RequestValidationException(new ValidationErrors().Add("userId", "Link only to an active team member's login."));
            if (await conn.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM staff_profiles WHERE business_id = @B AND user_id = @U AND (@Id::uuid IS NULL OR id <> @Id::uuid)", new { B = access.BusinessId, U = u, Id = id }) > 0)
                throw new ConflictException("That login is already linked to another profile.");
        }
    }

    /// <summary>People update their own status; managers may update anyone's (recorded in history either way).</summary>
    private async Task<(AccessContext Access, StaffRow Staff)> OwnOrManagedAsync(IDbConnection conn, Guid staffId)
    {
        var access = await business.RequireAsync(Permission.UpdateOwnStatus, Permission.ManageStaffSchedules);
        var s = await TeamRepository.GetAsync(conn, access.BusinessId, staffId) ?? throw new NotFoundException();
        var own = s.UserId == access.UserId && access.Can(Permission.UpdateOwnStatus);
        var managed = access.Can(Permission.ManageStaffSchedules) && (access.AllBranches || s.BranchId is null || access.CanSeeBranch(s.BranchId));
        if (!own && !managed) throw new ForbiddenException("You can only change your own status and schedule.");
        return (access, s);
    }

    public async Task<StaffStatusDto> SetStatusAsync(Guid staffId, StatusInput input, CancellationToken ct)
    {
        var e = new ValidationErrors();
        if (input.Status is null || !StaffStatuses.All.Contains(input.Status)) e.Add("status", "Choose a status.");
        if (input.RevertTo is not null && !StaffStatuses.All.Contains(input.RevertTo)) e.Add("revertTo", "Choose a status to return to.");
        if (input.ForMinutes is < 5 or > 24 * 60 * 14) e.Add("forMinutes", "Choose between 5 minutes and 14 days.");
        e.Optional("note", input.Note, 120);
        RequestValidationException.ThrowIfInvalid(e);
        await using var conn = await db.OpenAsync(ct);
        var (access, s) = await OwnOrManagedAsync(conn, staffId);
        var now = clock.UtcNow;
        DateTimeOffset? expires = input.ForMinutes is { } m ? now.AddMinutes(m) : null;
        using var tx = conn.BeginTransaction();
        await TeamRepository.SetStatusAsync(conn, tx, access.BusinessId, staffId, input.Status!, string.IsNullOrWhiteSpace(input.Note) ? null : input.Note.Trim(),
            expires, expires is null ? null : input.RevertTo, access.UserId, "manual");
        if (s.UserId != access.UserId)
            await AuditRepository.WriteAsync(conn, tx, access.BusinessId, access.UserId, "staff_status_set_by_manager", "staff_profile", staffId,
                JsonSerializer.Serialize(new { status = input.Status }));
        tx.Commit();
        var sch = (await TeamRepository.SchedulesAsync(conn, access.BusinessId, [s], now.AddDays(-1), now.AddDays(1)))[s.Id];
        return TeamRepository.StatusDto(sch, now);
    }

    public async Task<IReadOnlyList<StatusHistoryDto>> HistoryAsync(Guid staffId, CancellationToken ct)
    {
        await using var conn = await db.OpenAsync(ct);
        var (access, _) = await OwnOrManagedAsync(conn, staffId);
        return (await conn.QueryAsync<(string Status, string? Note, string Source, DateTime At, DateTime? Exp)>(
            "SELECT status, note, source, created_at, expires_at FROM staff_status_history WHERE business_id = @B AND staff_id = @S ORDER BY created_at DESC LIMIT 100",
            new { B = access.BusinessId, S = staffId }))
            .Select(h => new StatusHistoryDto(h.Status, StaffStatuses.Label(h.Status), h.Note, h.Source, TeamRepository.Utc(h.At), TeamRepository.Utc(h.Exp))).ToList();
    }

    public async Task<IReadOnlyList<WorkingHoursDto>> SetHoursAsync(Guid staffId, IReadOnlyList<WorkingHoursDto> input, CancellationToken ct)
    {
        var e = new ValidationErrors();
        var parsed = new List<(int Day, TimeOnly Start, TimeOnly End)>();
        if (input.Count > 21) e.Add("hours", "Use at most 3 time blocks per day.");
        foreach (var (h, i) in input.Select((h, i) => (h, i)))
        {
            if (h.Weekday is < 0 or > 6 || !TimeOnly.TryParse(h.Start, out var st) || !TimeOnly.TryParse(h.End, out var en) || en <= st)
            { e.Add($"hours[{i}]", "Use a weekday 0–6 (Sunday = 0) and a start time before the end time."); continue; }
            parsed.Add((h.Weekday, st, en));
        }
        foreach (var g in parsed.GroupBy(p => p.Day))
        {
            var o = g.OrderBy(p => p.Start).ToList();
            for (var i = 1; i < o.Count; i++) if (o[i].Start < o[i - 1].End) e.Add("hours", "Time blocks on the same day must not overlap.");
        }
        RequestValidationException.ThrowIfInvalid(e);
        await using var conn = await db.OpenAsync(ct);
        var (access, _) = await OwnOrManagedAsync(conn, staffId);
        using var tx = conn.BeginTransaction();
        await conn.ExecuteAsync("DELETE FROM staff_working_hours WHERE business_id = @B AND staff_id = @S", new { B = access.BusinessId, S = staffId }, tx);
        foreach (var p in parsed)
            await conn.ExecuteAsync("INSERT INTO staff_working_hours (business_id, staff_id, weekday, start_time, end_time) VALUES (@B, @S, @D, @St::time, @En::time)",
                new { B = access.BusinessId, S = staffId, D = (short)p.Day, St = p.Start.ToString("HH:mm"), En = p.End.ToString("HH:mm") }, tx);
        await AuditRepository.WriteAsync(conn, tx, access.BusinessId, access.UserId, "staff_hours_changed", "staff_profile", staffId);
        tx.Commit();
        return parsed.OrderBy(p => p.Day).ThenBy(p => p.Start).Select(p => new WorkingHoursDto(p.Day, p.Start.ToString("HH:mm"), p.End.ToString("HH:mm"))).ToList();
    }

    public async Task<IReadOnlyList<TimeOffDto>> TimeOffAsync(Guid staffId, CancellationToken ct)
    {
        await using var conn = await db.OpenAsync(ct);
        var (access, s) = await OwnOrManagedAsync(conn, staffId);
        var own = s.UserId == access.UserId;
        return (await conn.QueryAsync<TimeOffRow>(
            "SELECT id, staff_id, starts_at, ends_at, kind, note FROM staff_time_off WHERE business_id = @B AND staff_id = @S AND ends_at > now() - interval '30 days' ORDER BY starts_at",
            new { B = access.BusinessId, S = staffId }))
            // Personal notes stay private to the person; managers see only that the time is blocked and why in broad terms.
            .Select(t => new TimeOffDto(t.Id, TeamRepository.Utc(t.StartsAt), TeamRepository.Utc(t.EndsAt), t.Kind, own ? t.Note : null)).ToList();
    }

    public async Task<TimeOffDto> AddTimeOffAsync(Guid staffId, TimeOffInput input, CancellationToken ct)
    {
        var e = new ValidationErrors();
        if (input.StartsAt is null || input.EndsAt is null || input.EndsAt <= input.StartsAt) e.Add("endsAt", "Choose a start before the end.");
        else if (input.EndsAt.Value - input.StartsAt.Value > TimeSpan.FromDays(60)) e.Add("endsAt", "Block at most 60 days at a time.");
        if (input.Kind is not null && !TimeOffKinds.Contains(input.Kind)) e.Add("kind", "Choose leave, class, exam, personal or other.");
        e.Optional("note", input.Note, 200);
        RequestValidationException.ThrowIfInvalid(e);
        await using var conn = await db.OpenAsync(ct);
        var (access, _) = await OwnOrManagedAsync(conn, staffId);
        var clashes = await conn.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM bookings WHERE business_id = @B AND staff_id = @S AND status = 'confirmed' AND starts_at < @E AND ends_at > @St",
            new { B = access.BusinessId, S = staffId, St = input.StartsAt!.Value.UtcDateTime, E = input.EndsAt!.Value.UtcDateTime });
        var id = await conn.QuerySingleAsync<Guid>(
            "INSERT INTO staff_time_off (business_id, staff_id, starts_at, ends_at, kind, note, created_by) VALUES (@B, @S, @St, @E, @K, @N, @U) RETURNING id",
            new { B = access.BusinessId, S = staffId, St = input.StartsAt.Value.UtcDateTime, E = input.EndsAt.Value.UtcDateTime, K = input.Kind ?? "personal",
                N = string.IsNullOrWhiteSpace(input.Note) ? null : input.Note.Trim(), U = access.UserId });
        if (clashes > 0)
            await NotificationRepository.NotifyAsync(conn, null, access.BusinessId, Permission.ManageBookings, "booking", "warning",
                "Time off overlaps confirmed bookings", $"{clashes} confirmed booking(s) fall inside newly blocked time. Reschedule or reassign them.", "/bookings", $"timeoff:{id}");
        return new TimeOffDto(id, input.StartsAt.Value, input.EndsAt.Value, input.Kind ?? "personal", input.Note);
    }

    public async Task DeleteTimeOffAsync(Guid staffId, Guid id, CancellationToken ct)
    {
        await using var conn = await db.OpenAsync(ct);
        var (access, _) = await OwnOrManagedAsync(conn, staffId);
        if (await conn.ExecuteAsync("DELETE FROM staff_time_off WHERE id = @Id AND business_id = @B AND staff_id = @S", new { Id = id, B = access.BusinessId, S = staffId }) == 0)
            throw new NotFoundException();
    }

    /// <summary>Owner side "Register a barber": creates the profile, the services they offer (with their own prices),
    /// their weekly hours and — when an email is given — a one-time login invitation bound to this profile.</summary>
    public async Task<RegisterBarberResultDto> RegisterBarberAsync(RegisterBarberInput input, CancellationToken ct)
    {
        var access = await business.RequireAsync(Permission.ManageStaff);
        var profileInput = new StaffProfileInput(input.DisplayName, input.RoleTitle, input.BranchId, null, true, input.AcceptsHouseCalls, true,
            input.Bio, input.Specialties, input.ContactPhone, input.EmergencyContactName, input.EmergencyContactPhone);
        var e = Validate(profileInput);
        var email = input.LoginEmail?.Trim().ToLowerInvariant();
        if (!string.IsNullOrEmpty(email)) e.Email("loginEmail", email, false);
        if (input.Services?.Any(i => i.PriceCents is < 0 or > 10_000_000) == true) e.Add("services", "Enter valid prices.");
        var hours = ParseHours(input.Hours ?? [], e);
        RequestValidationException.ThrowIfInvalid(e);
        await using var conn = await db.OpenAsync(ct);
        await CheckLinksAsync(conn, access, profileInput, null);
        var serviceIds = (input.Services ?? []).Select(x => x.ServiceId).Distinct().ToArray();
        if (serviceIds.Length > 0 && await conn.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM services WHERE business_id = @B AND id = ANY(@Ids)", new { B = access.BusinessId, Ids = serviceIds }) != serviceIds.Length)
            throw new RequestValidationException(new ValidationErrors().Add("services", "Choose services from your catalogue."));
        if (!string.IsNullOrEmpty(email) && await conn.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM business_members WHERE business_id = @B AND lower(email) = @E AND is_active", new { B = access.BusinessId, E = email }) > 0)
            throw new ConflictException("That email already belongs to a team member. Link their login to the profile instead.");
        var branch = input.BranchId ?? await conn.QueryFirstOrDefaultAsync<Guid?>("SELECT id FROM branches WHERE business_id = @B AND is_active ORDER BY created_at LIMIT 1", new { B = access.BusinessId });

        using var tx = conn.BeginTransaction();
        var id = await conn.QuerySingleAsync<Guid>(
            """
            INSERT INTO staff_profiles (business_id, display_name, role_title, branch_id, is_bookable, accepts_house_calls, bio, specialties,
                contact_phone, emergency_contact_name, emergency_contact_phone)
            VALUES (@B, @Name, @Title, @Branch, TRUE, @House, @Bio, @Spec, @Phone, @EName, @EPhone) RETURNING id
            """, new { B = access.BusinessId, Name = input.DisplayName!.Trim(), Title = Clean(input.RoleTitle) ?? "Barber", Branch = branch,
                House = input.AcceptsHouseCalls ?? false, Bio = Clean(input.Bio), Spec = Clean(input.Specialties), Phone = Clean(input.ContactPhone),
                EName = Clean(input.EmergencyContactName), EPhone = Clean(input.EmergencyContactPhone) }, tx);
        foreach (var i in (input.Services ?? []).DistinctBy(i => i.ServiceId))
            await conn.ExecuteAsync("INSERT INTO staff_services (business_id, staff_id, service_id, price_cents) VALUES (@B, @S, @Svc, @P)",
                new { B = access.BusinessId, S = id, Svc = i.ServiceId, P = i.PriceCents }, tx);
        foreach (var h in hours)
            await conn.ExecuteAsync("INSERT INTO staff_working_hours (business_id, staff_id, weekday, start_time, end_time) VALUES (@B, @S, @D, @St::time, @En::time)",
                new { B = access.BusinessId, S = id, D = (short)h.Day, St = h.Start.ToString("HH:mm"), En = h.End.ToString("HH:mm") }, tx);
        await TeamRepository.SetStatusAsync(conn, tx, access.BusinessId, id, StaffStatuses.OffDuty, null, null, null, access.UserId, "system");
        await AuditRepository.WriteAsync(conn, tx, access.BusinessId, access.UserId, "barber_registered", "staff_profile", id);
        string? token = null;
        if (!string.IsNullOrEmpty(email))
            (_, token) = await Automation.StaffService.CreateInviteAsync(conn, tx, access.BusinessId, email, Roles.Staff, branch is { } br ? [br] : [], access.UserId, id, clock);
        tx.Commit();
        var profile = (await TeamAsync(conn, access)).First(x => x.Id == id);
        return new RegisterBarberResultDto(profile, token, token is null ? null : $"/join?token={token}",
            token is null ? "Profile created. You can send a login invitation later." : Automation.StaffService.InviteMessage);
    }

    /// <summary>Creates (or replaces) a login invitation for an existing barber profile that has no login yet.</summary>
    public async Task<RegisterBarberResultDto> InviteLoginAsync(Guid staffId, LoginInviteInput input, CancellationToken ct)
    {
        var access = await business.RequireAsync(Permission.ManageStaff);
        var email = input.Email?.Trim().ToLowerInvariant();
        var e = new ValidationErrors();
        e.Email("email", email, true);
        RequestValidationException.ThrowIfInvalid(e);
        await using var conn = await db.OpenAsync(ct);
        var s = await TeamRepository.GetAsync(conn, access.BusinessId, staffId) ?? throw new NotFoundException();
        if (s.UserId is not null) throw new ConflictException("This barber already has a login.");
        if (await conn.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM business_members WHERE business_id = @B AND lower(email) = @E AND is_active", new { B = access.BusinessId, E = email }) > 0)
            throw new ConflictException("That email already belongs to a team member.");
        var branch = s.BranchId ?? await conn.QueryFirstOrDefaultAsync<Guid?>("SELECT id FROM branches WHERE business_id = @B AND is_active ORDER BY created_at LIMIT 1", new { B = access.BusinessId });
        using var tx = conn.BeginTransaction();
        var (_, token) = await Automation.StaffService.CreateInviteAsync(conn, tx, access.BusinessId, email!, Roles.Staff, branch is { } br ? [br] : [], access.UserId, staffId, clock);
        tx.Commit();
        var profile = (await TeamAsync(conn, access)).First(x => x.Id == staffId);
        return new RegisterBarberResultDto(profile, token, $"/join?token={token}", Automation.StaffService.InviteMessage);
    }

    private static List<(int Day, TimeOnly Start, TimeOnly End)> ParseHours(IReadOnlyList<WorkingHoursDto> input, ValidationErrors e)
    {
        var parsed = new List<(int Day, TimeOnly Start, TimeOnly End)>();
        if (input.Count > 21) e.Add("hours", "Use at most 3 time blocks per day.");
        foreach (var (h, i) in input.Select((h, i) => (h, i)))
        {
            if (h.Weekday is < 0 or > 6 || !TimeOnly.TryParse(h.Start, out var st) || !TimeOnly.TryParse(h.End, out var en) || en <= st)
            { e.Add($"hours[{i}]", "Use a weekday 0–6 (Sunday = 0) and a start time before the end time."); continue; }
            parsed.Add((h.Weekday, st, en));
        }
        foreach (var g in parsed.GroupBy(p => p.Day))
        {
            var o = g.OrderBy(p => p.Start).ToList();
            for (var i = 1; i < o.Count; i++) if (o[i].Start < o[i - 1].End) e.Add("hours", "Time blocks on the same day must not overlap.");
        }
        return parsed;
    }

    public async Task<IReadOnlyList<StaffServiceDto>> SetServicesAsync(Guid staffId, IReadOnlyList<StaffServiceInput> input, CancellationToken ct)
    {
        var access = await business.RequireAsync(Permission.ManageServices);
        if (input.Any(i => i.PriceCents is < 0 or > 10_000_000)) throw new RequestValidationException(new ValidationErrors().Add("priceCents", "Enter a valid price."));
        await using var conn = await db.OpenAsync(ct);
        _ = await TeamRepository.GetAsync(conn, access.BusinessId, staffId) ?? throw new NotFoundException();
        var ids = input.Select(i => i.ServiceId).Distinct().ToArray();
        if (await conn.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM services WHERE business_id = @B AND id = ANY(@Ids)", new { B = access.BusinessId, Ids = ids }) != ids.Length)
            throw new RequestValidationException(new ValidationErrors().Add("serviceId", "Choose services from your catalogue."));
        using var tx = conn.BeginTransaction();
        await conn.ExecuteAsync("DELETE FROM staff_services WHERE business_id = @B AND staff_id = @S", new { B = access.BusinessId, S = staffId }, tx);
        foreach (var i in input.DistinctBy(i => i.ServiceId))
            await conn.ExecuteAsync("INSERT INTO staff_services (business_id, staff_id, service_id, price_cents) VALUES (@B, @S, @Svc, @P)",
                new { B = access.BusinessId, S = staffId, Svc = i.ServiceId, P = i.PriceCents }, tx);
        await AuditRepository.WriteAsync(conn, tx, access.BusinessId, access.UserId, "staff_services_changed", "staff_profile", staffId);
        tx.Commit();
        return (await TeamAsync(conn, access)).FirstOrDefault(s => s.Id == staffId)?.Services ?? [];
    }
}

/// <summary>Service catalogue: configurable services and prices (seeded examples are not hard-coded).</summary>
public sealed class ServiceCatalogService(IDbConnectionFactory db, IBusinessContext business)
{
    private sealed class Row
    {
        public Guid Id { get; set; }
        public string Name { get; set; } = "";
        public string? Description { get; set; }
        public string? Category { get; set; }
        public long PriceCents { get; set; }
        public int DurationMinutes { get; set; }
        public bool IsActive { get; set; }
        public bool IsPublic { get; set; }
        public bool AllowsHouseCall { get; set; }
        public int SortOrder { get; set; }
    }

    private static ServiceDto ToDto(Row r) => new(r.Id, r.Name, r.Description, r.Category, r.PriceCents, r.DurationMinutes, r.IsActive, r.IsPublic, r.AllowsHouseCall, r.SortOrder);
    private const string Cols = "id, name, description, category, price_cents, duration_minutes, is_active, is_public, allows_house_call, sort_order";

    public async Task<IReadOnlyList<ServiceDto>> ListAsync(bool includeInactive, CancellationToken ct)
    {
        var access = await business.GetAccessAsync(ct);
        await using var conn = await db.OpenAsync(ct);
        return (await conn.QueryAsync<Row>($"SELECT {Cols} FROM services WHERE business_id = @B AND (@All OR is_active) ORDER BY sort_order, name",
            new { B = access.BusinessId, All = includeInactive })).Select(ToDto).ToList();
    }

    private static ValidationErrors Validate(ServiceInput i)
    {
        var e = new ValidationErrors();
        e.Required("name", i.Name, 1, 80);
        e.Optional("description", i.Description, 300);
        e.Optional("category", i.Category, 40);
        if (i.PriceCents is not (>= 0 and <= 10_000_000)) e.Add("priceCents", "Enter a price from R0 to R100 000.");
        if (i.DurationMinutes is not (>= 5 and <= 480)) e.Add("durationMinutes", "Duration must be between 5 and 480 minutes.");
        return e;
    }

    public async Task<ServiceDto> CreateAsync(ServiceInput input, CancellationToken ct)
    {
        RequestValidationException.ThrowIfInvalid(Validate(input));
        var access = await business.RequireAsync(Permission.ManageServices);
        await using var conn = await db.OpenAsync(ct);
        if (await conn.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM services WHERE business_id = @B AND lower(name) = lower(@N)", new { B = access.BusinessId, N = input.Name!.Trim() }) > 0)
            throw new ConflictException("A service with that name already exists.");
        var row = await conn.QuerySingleAsync<Row>(
            $"""
            INSERT INTO services (business_id, name, description, category, price_cents, duration_minutes, is_public, allows_house_call, sort_order)
            VALUES (@B, @Name, @Desc, @Cat, @Price, @Dur, @Public, @House, @Sort) RETURNING {Cols}
            """, new { B = access.BusinessId, Name = input.Name!.Trim(), Desc = Clean(input.Description), Cat = Clean(input.Category), Price = input.PriceCents,
                Dur = input.DurationMinutes, Public = input.IsPublic ?? true, House = input.AllowsHouseCall ?? true, Sort = input.SortOrder ?? 0 });
        await AuditRepository.WriteAsync(conn, null, access.BusinessId, access.UserId, "service_created", "service", row.Id);
        return ToDto(row);
    }

    public async Task<ServiceDto> UpdateAsync(Guid id, ServiceInput input, CancellationToken ct)
    {
        RequestValidationException.ThrowIfInvalid(Validate(input));
        var access = await business.RequireAsync(Permission.ManageServices);
        await using var conn = await db.OpenAsync(ct);
        if (await conn.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM services WHERE business_id = @B AND lower(name) = lower(@N) AND id <> @Id", new { B = access.BusinessId, N = input.Name!.Trim(), Id = id }) > 0)
            throw new ConflictException("A service with that name already exists.");
        var old = await conn.QueryFirstOrDefaultAsync<long?>("SELECT price_cents FROM services WHERE id = @Id AND business_id = @B", new { Id = id, B = access.BusinessId })
                  ?? throw new NotFoundException();
        var row = await conn.QuerySingleAsync<Row>(
            $"""
            UPDATE services SET name = @Name, description = @Desc, category = @Cat, price_cents = @Price, duration_minutes = @Dur,
                is_active = COALESCE(@Active, is_active), is_public = COALESCE(@Public, is_public), allows_house_call = COALESCE(@House, allows_house_call),
                sort_order = COALESCE(@Sort, sort_order), updated_at = now()
            WHERE id = @Id AND business_id = @B RETURNING {Cols}
            """, new { Id = id, B = access.BusinessId, Name = input.Name!.Trim(), Desc = Clean(input.Description), Cat = Clean(input.Category), Price = input.PriceCents,
                Dur = input.DurationMinutes, Active = input.IsActive, Public = input.IsPublic, House = input.AllowsHouseCall, Sort = input.SortOrder });
        // Existing bookings keep the price they were quoted (stored per booking item); only new bookings use the new price.
        await AuditRepository.WriteAsync(conn, null, access.BusinessId, access.UserId, "service_updated", "service", id,
            JsonSerializer.Serialize(new { priceChanged = old != input.PriceCents }));
        return ToDto(row);
    }

    private static string? Clean(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();
}
