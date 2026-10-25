using System.Data;
using System.Security.Cryptography;
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

// ============================================================================================ customer accounts

public sealed class CustomerAccountRow
{
    public Guid UserId { get; set; }
    public string? FullName { get; set; }
    public string? ContactPhone { get; set; }
    public string? VerifiedEmail { get; set; }
    public string? VerifiedPhone { get; set; }
    public string? AddressLine { get; set; }
    public string? Suburb { get; set; }
    public string? Town { get; set; }
    public string? AccessNotes { get; set; }
    public string? HouseCallTermsVersion { get; set; }
    public DateTime? HouseCallTermsAcceptedAt { get; set; }
    public DateTime CreatedAt { get; set; }
}

/// <summary>
/// Customers sign in with a one-time code (Supabase email OTP; SMS once an SMS provider is configured in Supabase) — no
/// password and no business access. The verified contact comes only from the validated token. A customer account is
/// separate from business membership: it can never read a business's records, only its own bookings.
/// </summary>
public sealed class CustomerAccountService(IDbConnectionFactory db, ICurrentUser user, PublicBookingService publicBookings)
{
    private const string Cols = "user_id, full_name, contact_phone, verified_email, verified_phone, address_line, suburb, town, access_notes, " +
                                "house_call_terms_version, house_call_terms_accepted_at, created_at";

    /// <summary>The email or phone Supabase verified for this session, or null.</summary>
    public static string? VerifiedContact(ICurrentUser u) =>
        !string.IsNullOrWhiteSpace(u.Email) ? u.Email.Trim().ToLowerInvariant() : string.IsNullOrWhiteSpace(u.Phone) ? null : u.Phone.Trim();

    internal static async Task<CustomerAccountRow> EnsureAsync(IDbConnection conn, ICurrentUser u, IDbTransaction? tx = null) =>
        await conn.QuerySingleAsync<CustomerAccountRow>(
            $"""
            INSERT INTO customer_accounts (user_id, verified_email, verified_phone) VALUES (@U, @E, @P)
            ON CONFLICT (user_id) DO UPDATE SET verified_email = EXCLUDED.verified_email, verified_phone = EXCLUDED.verified_phone
            RETURNING {Cols}
            """, new { U = u.UserId, E = string.IsNullOrWhiteSpace(u.Email) ? null : u.Email.Trim().ToLowerInvariant(), P = string.IsNullOrWhiteSpace(u.Phone) ? null : u.Phone.Trim() }, tx);

    internal static CustomerHouseCallProfile Profile(CustomerAccountRow a, string? verified) =>
        new(a.FullName, a.ContactPhone, verified, a.AddressLine, a.Suburb, a.Town,
            a.HouseCallTermsAcceptedAt is { } t ? new DateTimeOffset(DateTime.SpecifyKind(t, DateTimeKind.Utc)) : null, a.HouseCallTermsVersion);

    private string RequireVerified() =>
        VerifiedContact(user) ?? throw new ForbiddenException("Sign in with a one-time code sent to your email or phone first.");

    private CustomerAccountDto ToDto(CustomerAccountRow a)
    {
        var verified = VerifiedContact(user)!;
        var missing = CustomerReadiness.MissingForHouseCall(Profile(a, verified));
        return new CustomerAccountDto(verified, string.IsNullOrWhiteSpace(user.Email) ? "phone" : "email", a.FullName, a.ContactPhone, a.AddressLine, a.Suburb,
            a.Town, a.AccessNotes, a.HouseCallTermsVersion == CustomerReadiness.TermsVersion && a.HouseCallTermsAcceptedAt is not null,
            CustomerReadiness.Terms, missing.Count == 0, missing, TeamRepository.Utc(a.CreatedAt), Mappers.ToDto(CustomerExperience.Instance));
    }

    public async Task<CustomerAccountDto> MeAsync(CancellationToken ct)
    {
        RequireVerified();
        await using var conn = await db.OpenAsync(ct);
        return ToDto(await EnsureAsync(conn, user));
    }

    public async Task<CustomerAccountDto> UpdateAsync(CustomerAccountInput input, CancellationToken ct)
    {
        RequireVerified();
        var e = new ValidationErrors();
        if (!string.IsNullOrWhiteSpace(input.FullName)) e.Required("fullName", input.FullName, 2, 100);
        e.Phone("contactPhone", input.ContactPhone);
        if (!string.IsNullOrWhiteSpace(input.AddressLine)) e.Required("addressLine", input.AddressLine, 3, 200);
        e.Optional("suburb", input.Suburb, 80);
        e.Optional("town", input.Town, 80);
        e.Optional("accessNotes", input.AccessNotes, 300);
        RequestValidationException.ThrowIfInvalid(e);
        await using var conn = await db.OpenAsync(ct);
        await EnsureAsync(conn, user);
        var row = await conn.QuerySingleAsync<CustomerAccountRow>(
            $"""
            UPDATE customer_accounts SET full_name = @Name, contact_phone = @Phone, address_line = @Addr, suburb = @Sub, town = @Town, access_notes = @Notes,
                house_call_terms_version = CASE WHEN @Accept IS NULL THEN house_call_terms_version WHEN @Accept THEN @Ver ELSE NULL END,
                house_call_terms_accepted_at = CASE WHEN @Accept IS NULL THEN house_call_terms_accepted_at WHEN @Accept THEN now() ELSE NULL END,
                updated_at = now()
            WHERE user_id = @U RETURNING {Cols}
            """, new { U = user.UserId, Name = TeamService.Clean(input.FullName), Phone = TeamService.Clean(input.ContactPhone), Addr = TeamService.Clean(input.AddressLine),
                Sub = TeamService.Clean(input.Suburb), Town = TeamService.Clean(input.Town), Notes = TeamService.Clean(input.AccessNotes), Accept = input.AcceptHouseCallTerms,
                Ver = CustomerReadiness.TermsVersion });
        return ToDto(row);
    }

    /// <summary>Removes the customer's saved profile. Past bookings keep the name and contact they were made with, because the
    /// businesses need them for their own records; full sign-in account deletion is done in Supabase Auth.</summary>
    public async Task DeleteAsync(CancellationToken ct)
    {
        RequireVerified();
        await using var conn = await db.OpenAsync(ct);
        await conn.ExecuteAsync("DELETE FROM customer_accounts WHERE user_id = @U", new { U = user.UserId });
    }

    private sealed class BookingListRow
    {
        public string Reference { get; set; } = "";
        public string BusinessName { get; set; } = "";
        public string? Slug { get; set; }
        public string Status { get; set; } = "";
        public DateTime StartsAt { get; set; }
        public DateTime EndsAt { get; set; }
        public string? StaffName { get; set; }
        public string LocationType { get; set; } = "";
        public string ServicesSummary { get; set; } = "";
        public long TotalCents { get; set; }
        public string? ProposedBy { get; set; }
    }

    public async Task<IReadOnlyList<CustomerBookingDto>> BookingsAsync(CancellationToken ct)
    {
        RequireVerified();
        await using var conn = await db.OpenAsync(ct);
        var rows = await conn.QueryAsync<BookingListRow>(
            """
            SELECT b.reference, bz.name AS business_name, p.slug, b.status, b.starts_at, b.ends_at, sp.display_name AS staff_name, b.location_type,
                   COALESCE((SELECT string_agg(i.service_name, ', ' ORDER BY i.person_label, i.service_name) FROM booking_items i WHERE i.booking_id = b.id), '') AS services_summary,
                   b.total_cents, b.proposed_by
            FROM bookings b JOIN businesses bz ON bz.id = b.business_id
            LEFT JOIN public_profiles p ON p.business_id = b.business_id
            LEFT JOIN staff_profiles sp ON sp.id = b.staff_id
            WHERE b.customer_user_id = @U
            ORDER BY b.starts_at DESC LIMIT 100
            """, new { U = user.UserId });
        return rows.Select(r => new CustomerBookingDto(r.Reference, r.BusinessName, r.Slug, r.Status, BookingStatuses.Label(r.Status), TeamRepository.Utc(r.StartsAt),
            TeamRepository.Utc(r.EndsAt), r.StaffName, r.LocationType, r.ServicesSummary, r.TotalCents,
            r.Status == BookingStatuses.RescheduleProposed && r.ProposedBy == "business")).ToList();
    }

    public Task<PublicBookingStatusDto> BookingAsync(string reference, CancellationToken ct)
    {
        RequireVerified();
        return publicBookings.StatusAsync(reference, null, ct, user.UserId);
    }

    public Task<PublicBookingStatusDto> ActAsync(string reference, string op, PublicActionInput input, CancellationToken ct)
    {
        RequireVerified();
        return publicBookings.ActAsync(reference, op, input with { Token = null }, ct, user.UserId);
    }
}

// ============================================================================================ portfolio

/// <summary>Photos of a barber's work for the public catalogue. Every upload needs the uploader to confirm that the
/// customer in the photo agreed to it being shown publicly (POPIA). Barbers manage their own; owners/managers manage all.</summary>
public sealed class PortfolioService(IDbConnectionFactory db, IBusinessContext business)
{
    public const int MaxBytes = 3 * 1024 * 1024;
    public const int MaxPerBarber = 24;

    public static string? Sniff(ReadOnlySpan<byte> b) =>
        b.Length >= 8 && b[0] == 0x89 && b[1] == 0x50 && b[2] == 0x4E && b[3] == 0x47 ? "image/png"
        : b.Length >= 3 && b[0] == 0xFF && b[1] == 0xD8 && b[2] == 0xFF ? "image/jpeg"
        : b.Length >= 12 && b[0] == 0x52 && b[1] == 0x49 && b[2] == 0x46 && b[3] == 0x46 && b[8] == 0x57 && b[9] == 0x45 && b[10] == 0x42 && b[11] == 0x50 ? "image/webp"
        : null;

    private sealed class Row
    {
        public Guid Id { get; set; }
        public Guid StaffId { get; set; }
        public Guid? ServiceId { get; set; }
        public string? ServiceName { get; set; }
        public string? Caption { get; set; }
        public string ContentType { get; set; } = "";
        public int SizeBytes { get; set; }
        public bool IsPublic { get; set; }
        public DateTime CreatedAt { get; set; }
    }

    private const string Select = """
        SELECT p.id, p.staff_id, p.service_id, s.name AS service_name, p.caption, p.content_type, p.size_bytes, p.is_public, p.created_at
        FROM staff_portfolio_photos p LEFT JOIN services s ON s.id = p.service_id
        """;

    private static PortfolioPhotoDto ToDto(Row r) => new(r.Id, r.StaffId, r.ServiceId, r.ServiceName, r.Caption, r.ContentType, r.SizeBytes, r.IsPublic,
        TeamRepository.Utc(r.CreatedAt), $"/api/team/{r.StaffId}/portfolio/{r.Id}/file");

    private async Task<(AccessContext Access, StaffRow Staff)> AccessAsync(IDbConnection conn, Guid staffId, bool write)
    {
        var access = await business.RequireAsync(Permission.ViewTeamStatus, Permission.ManageStaff, Permission.UpdateOwnStatus);
        var s = await TeamRepository.GetAsync(conn, access.BusinessId, staffId) ?? throw new NotFoundException();
        if (write && !(access.Can(Permission.ManageStaff) || (s.UserId == access.UserId && access.Can(Permission.UpdateOwnStatus))))
            throw new ForbiddenException("You can only manage your own portfolio.");
        return (access, s);
    }

    public async Task<IReadOnlyList<PortfolioPhotoDto>> ListAsync(Guid staffId, CancellationToken ct)
    {
        await using var conn = await db.OpenAsync(ct);
        var (access, _) = await AccessAsync(conn, staffId, false);
        return (await conn.QueryAsync<Row>($"{Select} WHERE p.business_id = @B AND p.staff_id = @S ORDER BY p.sort_order, p.created_at DESC",
            new { B = access.BusinessId, S = staffId })).Select(ToDto).ToList();
    }

    public async Task<PortfolioPhotoDto> UploadAsync(Guid staffId, IFormFile? file, string? caption, Guid? serviceId, bool consentConfirmed, bool? isPublic, CancellationToken ct)
    {
        var e = new ValidationErrors();
        if (file is null || file.Length == 0) e.Add("file", "Choose a photo.");
        else if (file.Length > MaxBytes) e.Add("file", "The photo must be 3 MB or smaller.");
        if (!consentConfirmed) e.Add("consentConfirmed", "Confirm that the customer in the photo agreed to it being shown publicly.");
        e.Optional("caption", caption, 120);
        RequestValidationException.ThrowIfInvalid(e);
        using var ms = new MemoryStream();
        await file!.CopyToAsync(ms, ct);
        var bytes = ms.ToArray();
        var type = Sniff(bytes) ?? throw new RequestValidationException(new ValidationErrors().Add("file", "Only JPEG, PNG or WebP photos are accepted."));
        await using var conn = await db.OpenAsync(ct);
        var (access, _) = await AccessAsync(conn, staffId, true);
        if (serviceId is { } sv && await conn.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM services WHERE id = @Id AND business_id = @B", new { Id = sv, B = access.BusinessId }) == 0)
            throw new RequestValidationException(new ValidationErrors().Add("serviceId", "Choose one of your services."));
        if (await conn.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM staff_portfolio_photos WHERE business_id = @B AND staff_id = @S", new { B = access.BusinessId, S = staffId }) >= MaxPerBarber)
            throw new ConflictException($"A barber can show up to {MaxPerBarber} photos. Remove one first.");
        var sha = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
        var id = await conn.QuerySingleAsync<Guid>(
            """
            INSERT INTO staff_portfolio_photos (business_id, staff_id, service_id, caption, content_type, size_bytes, sha256, data, consent_confirmed, is_public, uploaded_by)
            VALUES (@B, @S, @Svc, @Cap, @Type, @Size, @Sha, @Data, TRUE, @Pub, @U) RETURNING id
            """, new { B = access.BusinessId, S = staffId, Svc = serviceId, Cap = TeamService.Clean(caption), Type = type, Size = bytes.Length, Sha = sha, Data = bytes,
                Pub = isPublic ?? true, U = access.UserId });
        await AuditRepository.WriteAsync(conn, null, access.BusinessId, access.UserId, "portfolio_photo_added", "staff_profile", staffId,
            JsonSerializer.Serialize(new { photoId = id, consentConfirmed = true }));
        return ToDto(await conn.QuerySingleAsync<Row>($"{Select} WHERE p.id = @Id", new { Id = id }));
    }

    public async Task<PortfolioPhotoDto> UpdateAsync(Guid staffId, Guid photoId, PortfolioUpdateInput input, CancellationToken ct)
    {
        var e = new ValidationErrors();
        e.Optional("caption", input.Caption, 120);
        RequestValidationException.ThrowIfInvalid(e);
        await using var conn = await db.OpenAsync(ct);
        var (access, _) = await AccessAsync(conn, staffId, true);
        if (input.ServiceId is { } sv && await conn.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM services WHERE id = @Id AND business_id = @B", new { Id = sv, B = access.BusinessId }) == 0)
            throw new RequestValidationException(new ValidationErrors().Add("serviceId", "Choose one of your services."));
        if (await conn.ExecuteAsync(
                "UPDATE staff_portfolio_photos SET caption = @Cap, is_public = COALESCE(@Pub, is_public), service_id = @Svc WHERE id = @Id AND business_id = @B AND staff_id = @S",
                new { Cap = TeamService.Clean(input.Caption), Pub = input.IsPublic, Svc = input.ServiceId, Id = photoId, B = access.BusinessId, S = staffId }) == 0)
            throw new NotFoundException();
        return ToDto(await conn.QuerySingleAsync<Row>($"{Select} WHERE p.id = @Id", new { Id = photoId }));
    }

    public async Task DeleteAsync(Guid staffId, Guid photoId, CancellationToken ct)
    {
        await using var conn = await db.OpenAsync(ct);
        var (access, _) = await AccessAsync(conn, staffId, true);
        if (await conn.ExecuteAsync("DELETE FROM staff_portfolio_photos WHERE id = @Id AND business_id = @B AND staff_id = @S", new { Id = photoId, B = access.BusinessId, S = staffId }) == 0)
            throw new NotFoundException();
        await AuditRepository.WriteAsync(conn, null, access.BusinessId, access.UserId, "portfolio_photo_removed", "staff_profile", staffId, JsonSerializer.Serialize(new { photoId }));
    }

    public async Task<(byte[] Content, string ContentType)> FileAsync(Guid staffId, Guid photoId, CancellationToken ct)
    {
        await using var conn = await db.OpenAsync(ct);
        var (access, _) = await AccessAsync(conn, staffId, false);
        var row = await conn.QueryFirstOrDefaultAsync<PublicBookingService.PhotoBlob>(
            "SELECT data, content_type FROM staff_portfolio_photos WHERE id = @Id AND business_id = @B AND staff_id = @S", new { Id = photoId, B = access.BusinessId, S = staffId });
        return row is null ? throw new NotFoundException() : (row.Data, row.ContentType);
    }
}

// ============================================================================================ house-call safety

public static class SafetyAlertCodes
{
    public const string Help = "HOUSE_CALL_HELP";
    public const string Overdue = "HOUSE_CALL_OVERDUE";
    /// <summary>Raised by the safety monitor/check-ins, not by growth rules — the growth engine must not auto-close them.</summary>
    public static readonly string[] All = [Help, Overdue];
}

/// <summary>
/// House-call safety: the assigned barber taps "Left", "Arrived", "Finished", "Back safely" or "I need help". Location is
/// attached only when the barber chooses to share it with that one check-in. Late check-ins and help requests raise
/// critical in-app alerts for owners and managers. KasiFlow cannot call or SMS anyone, and says so.
/// </summary>
public sealed class HouseCallSafetyService(IDbConnectionFactory db, BookingService bookings, IClock clock)
{
    public const string EmergencyAdvice =
        "If anyone is in danger, phone for help now: SAPS 10111, or 112 from a cell phone. KasiFlow only sends in-app alerts to the owner and managers — it cannot call or SMS anyone.";

    private sealed class CheckinRow
    {
        public Guid Id { get; set; }
        public string Kind { get; set; } = "";
        public string? Note { get; set; }
        public decimal? Latitude { get; set; }
        public decimal? Longitude { get; set; }
        public int? AccuracyM { get; set; }
        public DateTime CreatedAt { get; set; }
        public string? ByName { get; set; }
    }

    private static async Task<List<CheckinRow>> CheckinsAsync(IDbConnection conn, Guid businessId, Guid bookingId, IDbTransaction? tx = null) =>
        (await conn.QueryAsync<CheckinRow>(
            """
            SELECT c.id, c.kind, c.note, c.latitude, c.longitude, c.accuracy_m, c.created_at, m.display_name AS by_name
            FROM house_call_checkins c LEFT JOIN business_members m ON m.business_id = c.business_id AND m.user_id = c.created_by
            WHERE c.business_id = @B AND c.booking_id = @Id ORDER BY c.created_at, c.id
            """, new { B = businessId, Id = bookingId }, tx)).ToList();

    internal static async Task<int> GraceAsync(IDbConnection conn, Guid businessId, IDbTransaction? tx = null) =>
        await conn.ExecuteScalarAsync<int?>("SELECT house_call_checkin_grace_minutes FROM business_settings WHERE business_id = @B", new { B = businessId }, tx)
        ?? HouseCallSafety.DefaultGraceMinutes;

    internal static SafetyState State(BookingRow b, IEnumerable<(string Kind, DateTime At)> checkins, int grace, DateTimeOffset now) =>
        HouseCallSafety.Evaluate(checkins.Select(c => new SafetyCheckin(c.Kind, TeamRepository.Utc(c.At))).ToList(), TeamRepository.Utc(b.StartsAt),
            TeamRepository.Utc(b.EndsAt), grace, now, b.Status == BookingStatuses.Confirmed);

    public async Task<HouseCallSafetyDto> GetAsync(Guid bookingId, CancellationToken ct)
    {
        await using var conn = await db.OpenAsync(ct);
        var (access, _, b, canManage) = await bookings.LoadVisibleAsync(conn, bookingId);
        if (b.LocationType != "house_call") throw new NotFoundException("Safety check-ins are for house calls.");
        return await DtoAsync(conn, access, b, canManage);
    }

    private async Task<HouseCallSafetyDto> DtoAsync(IDbConnection conn, AccessContext access, BookingRow b, bool canManage)
    {
        var rows = await CheckinsAsync(conn, b.BusinessId, b.Id);
        var grace = await GraceAsync(conn, b.BusinessId);
        var state = State(b, rows.Select(r => (r.Kind, r.CreatedAt)), grace, clock.UtcNow);
        var staff = b.StaffId is { } sid ? await TeamRepository.GetAsync(conn, b.BusinessId, sid) : null;
        var managers = access.Can(Permission.ManageBookings) || access.Can(Permission.ManageStaff);
        var timeline = rows.Select(r => new SafetyCheckinDto(r.Id, r.Kind, SafetyCheckinKinds.Label(r.Kind), TeamRepository.Utc(r.CreatedAt), r.Note, r.Latitude,
            r.Longitude, r.AccuracyM, r.Latitude is { } la && r.Longitude is { } lo ? $"https://www.openstreetmap.org/?mlat={la}&mlon={lo}#map=17/{la}/{lo}" : null,
            r.ByName ?? "Team member")).ToList();
        CustomerAccountSummaryDto? customer = b.CustomerUserId is { } cu ? await CustomerSafetyService.SummaryAsync(conn, access, b.BusinessId, cu) : null;
        return new HouseCallSafetyDto(b.Id, b.Reference, state.Stage, state.StageLabel, state.HelpActive, state.Overdue, state.OverdueReason, state.CheckBy,
            canManage ? state.NextActions : [], canManage, staff?.UserId == access.UserId, timeline, staff?.DisplayName,
            managers ? staff?.ContactPhone : null,
            managers && staff?.EmergencyContactName is { } en ? $"{en}{(staff.EmergencyContactPhone is { } ep ? $" ({ep})" : "")}" : null,
            customer, EmergencyAdvice, grace);
    }

    public async Task<HouseCallSafetyDto> CheckInAsync(Guid bookingId, SafetyCheckinInput input, CancellationToken ct)
    {
        var e = new ValidationErrors();
        if (input.Kind is null || !SafetyCheckinKinds.All.Contains(input.Kind)) e.Add("kind", "Choose a check-in.");
        e.Optional("note", input.Note, 300);
        if ((input.Latitude is null) != (input.Longitude is null) || input.Latitude is < -90 or > 90 || input.Longitude is < -180 or > 180)
            e.Add("latitude", "The location is not valid.");
        if (input.AccuracyM is < 0 or > 100000) e.Add("accuracyM", "The location accuracy is not valid.");
        RequestValidationException.ThrowIfInvalid(e);
        await using var conn = await db.OpenAsync(ct);
        using var tx = conn.BeginTransaction();
        var (access, _, b, canManage) = await bookings.LoadVisibleAsync(conn, bookingId, tx, forUpdate: true);
        if (b.LocationType != "house_call") throw new NotFoundException("Safety check-ins are for house calls.");
        if (!canManage) throw new ForbiddenException("Only the barber on this visit or a manager can check in.");
        var assigned = b.StaffUserId == access.UserId;
        if (!assigned && string.IsNullOrWhiteSpace(input.Note) && input.Kind is not SafetyCheckinKinds.AllClear)
            throw new RequestValidationException(new ValidationErrors().Add("note", "Say how you know (for example: \"Phoned the barber, they arrived at 10:05\")."));
        if (b.Status is not (BookingStatuses.Confirmed or BookingStatuses.Completed) && input.Kind is not (SafetyCheckinKinds.Help or SafetyCheckinKinds.AllClear))
            throw new ConflictException("Check-ins are for confirmed visits.");
        var grace = await GraceAsync(conn, b.BusinessId, tx);
        var before = State(b, (await CheckinsAsync(conn, b.BusinessId, b.Id, tx)).Select(r => (r.Kind, r.CreatedAt)), grace, clock.UtcNow);
        if (!HouseCallSafety.Allowed(before, input.Kind!))
            throw new ConflictException($"\"{SafetyCheckinKinds.Label(input.Kind!)}\" does not follow \"{before.StageLabel}\". Next: {string.Join(", ", before.NextActions.Select(SafetyCheckinKinds.Label))}.");

        var checkinId = await conn.QuerySingleAsync<Guid>(
            """
            INSERT INTO house_call_checkins (business_id, booking_id, staff_id, kind, note, latitude, longitude, accuracy_m, created_by)
            VALUES (@B, @Bk, @S, @K, @N, @Lat, @Lng, @Acc, @U) RETURNING id
            """, new { B = b.BusinessId, Bk = b.Id, S = b.StaffId, K = input.Kind, N = TeamService.Clean(input.Note), Lat = input.Latitude, Lng = input.Longitude,
                Acc = input.AccuracyM, U = access.UserId }, tx);
        await AuditRepository.WriteAsync(conn, tx, b.BusinessId, access.UserId, "house_call_checkin", "booking", b.Id,
            JsonSerializer.Serialize(new { kind = input.Kind, locationShared = input.Latitude is not null, onBehalf = !assigned }));

        var when = clock.UtcNow.ToOffset(StaffAvailability.SaOffset).ToString("HH:mm");
        switch (input.Kind)
        {
            case SafetyCheckinKinds.Departed when b.StaffId is { } sid:
                await TeamRepository.SetStatusAsync(conn, tx, b.BusinessId, sid, StaffStatuses.HouseCall, $"House call {b.Reference}", null, null, access.UserId, "booking");
                break;
            case SafetyCheckinKinds.Returned when b.StaffId is { } sid:
                await TeamRepository.SetStatusAsync(conn, tx, b.BusinessId, sid, StaffStatuses.Available, null, null, null, access.UserId, "booking");
                break;
            case SafetyCheckinKinds.Help:
                var where = input.Latitude is not null ? " Their location at that moment is in the check-in." : " No location was shared.";
                await RaiseAsync(conn, tx, b, SafetyAlertCodes.Help, $"help:{b.Id}:{checkinId}", "critical",
                    $"{b.StaffName ?? "A barber"} asked for help on house call {b.Reference}",
                    $"Tapped \"I need help\" at {when}.{where} {(input.Note is { Length: > 0 } n ? $"Note: \"{n.Trim()}\"." : "")}".Trim(),
                    "Phone the barber now. If you cannot reach them or they are in danger, phone SAPS on 10111 (112 from a cell phone) and give the visit address from the booking.");
                break;
            case SafetyCheckinKinds.AllClear:
                await ResolveAsync(conn, tx, b, SafetyAlertCodes.Help, $"All clear recorded at {when}.", access.UserId);
                break;
        }
        if (input.Kind is SafetyCheckinKinds.Arrived or SafetyCheckinKinds.Finished or SafetyCheckinKinds.Returned)
            await ResolveAsync(conn, tx, b, SafetyAlertCodes.Overdue, $"{SafetyCheckinKinds.Label(input.Kind!)} recorded at {when}.", access.UserId);
        tx.Commit();
        return await DtoAsync(conn, access, (await BookingEngine.GetAsync(conn, b.BusinessId, b.Id))!, canManage);
    }

    internal static async Task RaiseAsync(IDbConnection conn, IDbTransaction? tx, BookingRow b, string code, string fingerprint, string severity, string title,
        string reason, string action)
    {
        var inserted = await conn.QueryFirstOrDefaultAsync<Guid?>(
            """
            INSERT INTO alerts (business_id, rule_code, fingerprint, severity, title, reason, evidence, affected_type, affected_id, recommended_action)
            VALUES (@B, @Code, @Fp, @Sev, @Title, @Reason, '[]'::jsonb, 'booking', @Bk, @Action)
            ON CONFLICT (business_id, fingerprint) DO UPDATE SET last_detected_at = now(), updated_at = now()
            RETURNING CASE WHEN xmax = 0 THEN id END
            """, new { B = b.BusinessId, Code = code, Fp = fingerprint, Sev = severity, Title = title, Reason = reason, Bk = b.Id, Action = action }, tx);
        if (inserted is null) return;
        // Owners/admins/managers (ManageBookings) and anyone who can see alerts get it; branch-scoped managers only for their branch.
        await NotificationRepository.NotifyAsync(conn, tx, b.BusinessId, Permission.ManageBookings, "safety", severity, title, reason + " " + action,
            $"/bookings/{b.Id}", $"safety:{fingerprint}", b.BranchId);
        await NotificationRepository.NotifyAsync(conn, tx, b.BusinessId, Permission.ManageStaff, "safety", severity, title, reason + " " + action,
            $"/bookings/{b.Id}", $"safety:{fingerprint}", b.BranchId);
    }

    private static Task ResolveAsync(IDbConnection conn, IDbTransaction tx, BookingRow b, string code, string note, Guid userId) =>
        conn.ExecuteAsync(
            """
            UPDATE alerts SET status = 'resolved', review_note = @N, reviewer_id = @U, reviewed_at = now(), updated_at = now()
            WHERE business_id = @B AND rule_code = @Code AND affected_id = @Bk AND status IN ('open','under_review')
            """, new { N = note, U = userId, B = b.BusinessId, Code = code, Bk = b.Id }, tx);

    /// <summary>Background check (every ~30 s): confirmed house calls whose expected check-in is late raise one critical
    /// alert per missed step. A late check-in usually means a busy barber or a flat phone — the alert asks for a call.</summary>
    public static async Task<int> MonitorAsync(IDbConnection conn, DateTimeOffset now)
    {
        var due = (await conn.QueryAsync<BookingRow>(
            $"""
            {BookingEngine.Select}
            WHERE b.location_type = 'house_call' AND b.status = 'confirmed' AND b.starts_at < @Now AND b.ends_at > @Since
            """, new { Now = now.UtcDateTime, Since = now.UtcDateTime.AddHours(-12) })).ToList();
        var raised = 0;
        foreach (var b in due)
        {
            var grace = await GraceAsync(conn, b.BusinessId);
            var rows = await conn.QueryAsync<(string Kind, DateTime At)>(
                "SELECT kind, created_at FROM house_call_checkins WHERE booking_id = @Id ORDER BY created_at", new { Id = b.Id });
            var state = State(b, rows, grace, now);
            if (!state.Overdue) continue;
            var by = state.CheckBy!.Value.ToOffset(StaffAvailability.SaOffset).ToString("HH:mm");
            await RaiseAsync(conn, null, b, SafetyAlertCodes.Overdue, $"overdue:{b.Id}:{state.Stage}", "critical",
                $"House call {b.Reference}: check-in is late",
                $"{b.StaffName ?? "The barber"} — {state.OverdueReason} (expected by {by}). This is often a busy barber or a flat phone, but please check.",
                "Phone the barber. If you cannot reach them, phone the customer, and if you are worried about their safety phone SAPS on 10111 (112 from a cell phone).");
            raised++;
        }
        return raised;
    }
}

// ============================================================================================ customer safety notes and blocks

public sealed class CustomerSafetyService(IDbConnectionFactory db, IBusinessContext business, BookingService bookings)
{
    public static readonly string[] Categories = ["access", "pets", "conduct", "safety_concern", "other"];

    private sealed class NoteRow
    {
        public Guid Id { get; set; }
        public string Category { get; set; } = "";
        public string Note { get; set; } = "";
        public string? AuthorName { get; set; }
        public DateTime CreatedAt { get; set; }
        public string? BookingReference { get; set; }
    }

    private sealed class StatsRow
    {
        public string? FullName { get; set; }
        public string? ContactPhone { get; set; }
        public string? VerifiedEmail { get; set; }
        public string? VerifiedPhone { get; set; }
        public DateTime? CreatedAt { get; set; }
        public int Visits { get; set; }
        public int NoShows { get; set; }
        public int Cancelled { get; set; }
        public int TotalBookings { get; set; }
        public string? BlockReason { get; set; }
        public bool Blocked { get; set; }
    }

    /// <summary>What the business knows about a customer account — only from bookings with this business.</summary>
    internal static async Task<CustomerAccountSummaryDto?> SummaryAsync(IDbConnection conn, AccessContext access, Guid businessId, Guid customerUserId)
    {
        var s = await conn.QuerySingleAsync<StatsRow>(
            """
            SELECT a.full_name, a.contact_phone, a.verified_email, a.verified_phone, a.created_at,
                   (SELECT COUNT(*) FROM bookings WHERE business_id = @B AND customer_user_id = @U AND status = 'completed')::int AS visits,
                   (SELECT COUNT(*) FROM bookings WHERE business_id = @B AND customer_user_id = @U AND status = 'no_show')::int AS no_shows,
                   (SELECT COUNT(*) FROM booking_events e JOIN bookings bb ON bb.id = e.booking_id
                     WHERE bb.business_id = @B AND bb.customer_user_id = @U AND e.event = 'cancelled' AND e.actor_kind = 'customer')::int AS cancelled,
                   (SELECT COUNT(*) FROM bookings WHERE business_id = @B AND customer_user_id = @U)::int AS total_bookings,
                   (SELECT reason FROM customer_house_call_blocks WHERE business_id = @B AND customer_user_id = @U AND lifted_at IS NULL) AS block_reason,
                   EXISTS (SELECT 1 FROM customer_house_call_blocks WHERE business_id = @B AND customer_user_id = @U AND lifted_at IS NULL) AS blocked
            FROM (SELECT 1) one LEFT JOIN customer_accounts a ON a.user_id = @U
            """, new { B = businessId, U = customerUserId });
        if (s.TotalBookings == 0) return null;
        var notes = (await conn.QueryAsync<NoteRow>(
            """
            SELECT n.id, n.category, n.note, m.display_name AS author_name, n.created_at, b.reference AS booking_reference
            FROM customer_safety_notes n
            LEFT JOIN business_members m ON m.business_id = n.business_id AND m.user_id = n.created_by
            LEFT JOIN bookings b ON b.id = n.booking_id
            WHERE n.business_id = @B AND n.customer_user_id = @U ORDER BY n.created_at DESC LIMIT 50
            """, new { B = businessId, U = customerUserId }))
            .Select(n => new SafetyNoteDto(n.Id, n.Category, n.Note, n.AuthorName ?? "Team member", TeamRepository.Utc(n.CreatedAt), n.BookingReference)).ToList();
        return new CustomerAccountSummaryDto(customerUserId, s.FullName, s.ContactPhone, s.VerifiedEmail ?? s.VerifiedPhone,
            s.CreatedAt is { } c ? TeamRepository.Utc(c) : null, s.Visits, s.NoShows, s.Cancelled, s.Blocked, s.BlockReason, notes,
            access.Can(Permission.ManageStaff));
    }

    public async Task<CustomerAccountSummaryDto> ForBookingAsync(Guid bookingId, CancellationToken ct)
    {
        await using var conn = await db.OpenAsync(ct);
        var (access, _, b, _) = await bookings.LoadVisibleAsync(conn, bookingId);
        if (b.CustomerUserId is not { } cu) throw new NotFoundException("This booking was not made with a customer account.");
        return await SummaryAsync(conn, access, b.BusinessId, cu) ?? throw new NotFoundException();
    }

    public async Task<CustomerAccountSummaryDto> AddNoteAsync(Guid bookingId, SafetyNoteInput input, CancellationToken ct)
    {
        var e = new ValidationErrors();
        if (input.Category is null || !Categories.Contains(input.Category)) e.Add("category", "Choose what the note is about.");
        e.Required("note", input.Note, 3, 500);
        RequestValidationException.ThrowIfInvalid(e);
        await using var conn = await db.OpenAsync(ct);
        var (access, _, b, canManage) = await bookings.LoadVisibleAsync(conn, bookingId);
        if (!canManage) throw new ForbiddenException("Only the barber on this booking or a manager can add a note.");
        if (b.CustomerUserId is not { } cu) throw new ConflictException("This booking was not made with a customer account, so there is no account to attach the note to.");
        var id = await conn.QuerySingleAsync<Guid>(
            "INSERT INTO customer_safety_notes (business_id, customer_user_id, booking_id, category, note, created_by) VALUES (@B, @U, @Bk, @C, @N, @By) RETURNING id",
            new { B = b.BusinessId, U = cu, Bk = b.Id, C = input.Category, N = input.Note!.Trim(), By = access.UserId });
        await AuditRepository.WriteAsync(conn, null, b.BusinessId, access.UserId, "customer_safety_note_added", "booking", b.Id, JsonSerializer.Serialize(new { noteId = id, input.Category }));
        if (input.Category == "safety_concern")
            await NotificationRepository.NotifyAsync(conn, null, b.BusinessId, Permission.ManageStaff, "safety", "warning", "Safety concern noted about a customer",
                $"A team member noted a safety concern after booking {b.Reference}. Review it before accepting more house calls from this customer.", $"/bookings/{b.Id}",
                $"safetynote:{id}", b.BranchId);
        return (await SummaryAsync(conn, access, b.BusinessId, cu))!;
    }

    public async Task<CustomerAccountSummaryDto> BlockAsync(Guid customerUserId, bool block, ReasonInput input, CancellationToken ct)
    {
        var access = await business.RequireAsync(Permission.ManageStaff);
        var e = new ValidationErrors();
        e.Required("reason", input.Reason, 3, 300);
        RequestValidationException.ThrowIfInvalid(e);
        await using var conn = await db.OpenAsync(ct);
        if (await conn.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM bookings WHERE business_id = @B AND customer_user_id = @U", new { B = access.BusinessId, U = customerUserId }) == 0)
            throw new NotFoundException();
        if (block)
        {
            if (await conn.ExecuteAsync(
                    """
                    INSERT INTO customer_house_call_blocks (business_id, customer_user_id, reason, blocked_by) VALUES (@B, @U, @R, @By)
                    ON CONFLICT (business_id, customer_user_id) WHERE lifted_at IS NULL DO NOTHING
                    """, new { B = access.BusinessId, U = customerUserId, R = input.Reason!.Trim(), By = access.UserId }) == 0)
                throw new ConflictException("House calls are already blocked for this customer.");
        }
        else if (await conn.ExecuteAsync(
                     "UPDATE customer_house_call_blocks SET lifted_at = now(), lifted_by = @By, lift_reason = @R WHERE business_id = @B AND customer_user_id = @U AND lifted_at IS NULL",
                     new { B = access.BusinessId, U = customerUserId, R = input.Reason!.Trim(), By = access.UserId }) == 0)
            throw new ConflictException("House calls are not blocked for this customer.");
        await AuditRepository.WriteAsync(conn, null, access.BusinessId, access.UserId, block ? "house_calls_blocked" : "house_calls_unblocked", "customer_account", customerUserId,
            JsonSerializer.Serialize(new { reason = input.Reason!.Trim() }));
        return (await SummaryAsync(conn, access, access.BusinessId, customerUserId))!;
    }
}
