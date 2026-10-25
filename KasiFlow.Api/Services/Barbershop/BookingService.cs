using System.Data;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Dapper;
using KasiFlow.Api.Data;
using KasiFlow.Api.DTOs;
using KasiFlow.Api.Middleware;
using KasiFlow.Api.Repositories;
using KasiFlow.Core.Access;
using KasiFlow.Core.Bookings;
using KasiFlow.Core.Common;
using KasiFlow.Core.Domain;
using KasiFlow.Core.Validation;

namespace KasiFlow.Api.Services.Barbershop;

public sealed class BookingRow
{
    public Guid Id { get; set; }
    public Guid BusinessId { get; set; }
    public string Reference { get; set; } = "";
    public Guid? CustomerId { get; set; }
    public string CustomerName { get; set; } = "";
    public string? CustomerPhone { get; set; }
    public string? CustomerEmail { get; set; }
    public Guid? StaffId { get; set; }
    public string? StaffName { get; set; }
    public Guid? StaffUserId { get; set; }
    public Guid? BranchId { get; set; }
    public string LocationType { get; set; } = "";
    public DateTime StartsAt { get; set; }
    public DateTime EndsAt { get; set; }
    public string Status { get; set; } = "";
    public DateTime? ProposedStartsAt { get; set; }
    public DateTime? ProposedEndsAt { get; set; }
    public Guid? ProposedStaffId { get; set; }
    public long? ProposedTravelFeeCents { get; set; }
    public string? ProposedBy { get; set; }
    public string? ProposalNote { get; set; }
    public int PeopleCount { get; set; }
    public long ServicesTotalCents { get; set; }
    public long TravelFeeCents { get; set; }
    public long DiscountCents { get; set; }
    public long TotalCents { get; set; }
    public string Source { get; set; } = "";
    public string? CustomerNote { get; set; }
    public string? InternalNote { get; set; }
    public string? StatusTokenHash { get; set; }
    public bool OffDutyOverride { get; set; }
    public string? OverrideReason { get; set; }
    public string? CancelReason { get; set; }
    public long PaidCents { get; set; }
    public string ServicesSummary { get; set; } = "";
    public DateTime CreatedAt { get; set; }
    public Guid? CustomerUserId { get; set; }
    public string? VerifiedContact { get; set; }
}

/// <summary>Shared booking rules for staff and public requests: pricing from the catalogue, availability, conflict checks,
/// status changes with history, and notifications.</summary>
public sealed class BookingEngine(IClock clock)
{
    public const string Select = """
        SELECT b.id, b.business_id, b.reference, b.customer_id, b.customer_name, b.customer_phone, b.customer_email, b.staff_id,
               sp.display_name AS staff_name, sp.user_id AS staff_user_id, b.branch_id, b.location_type, b.starts_at, b.ends_at, b.status,
               b.proposed_starts_at, b.proposed_ends_at, b.proposed_staff_id, b.proposed_travel_fee_cents, b.proposed_by, b.proposal_note,
               b.people_count, b.services_total_cents, b.travel_fee_cents, b.discount_cents, b.total_cents, b.source, b.customer_note,
               b.internal_note, b.status_token_hash, b.off_duty_override, b.override_reason, b.cancel_reason, b.created_at, b.customer_user_id, b.verified_contact,
               COALESCE((SELECT SUM(t.amount_cents) FROM transactions t WHERE t.booking_id = b.id AND t.type = 'income' AND t.status = 'posted'
                         AND t.payment_status IN ('recorded_manually','confirmed_external')), 0)::bigint AS paid_cents,
               COALESCE((SELECT string_agg(i.service_name, ', ' ORDER BY i.person_label, i.service_name) FROM booking_items i WHERE i.booking_id = b.id), '') AS services_summary
        FROM bookings b LEFT JOIN staff_profiles sp ON sp.id = b.staff_id
        """;

    public static Task<BookingRow?> GetAsync(IDbConnection conn, Guid businessId, Guid id, IDbTransaction? tx = null, bool forUpdate = false) =>
        conn.QueryFirstOrDefaultAsync<BookingRow>($"{Select} WHERE b.business_id = @B AND b.id = @Id{(forUpdate ? " FOR UPDATE OF b" : "")}", new { B = businessId, Id = id }, tx);

    public static BookingSummaryDto Summary(BookingRow b) =>
        new(b.Id, b.Reference, b.Status, BookingStatuses.Label(b.Status), TeamRepository.Utc(b.StartsAt), TeamRepository.Utc(b.EndsAt), b.StaffId, b.StaffName,
            b.CustomerName, b.LocationType, b.PeopleCount, b.TotalCents, b.PaidCents, b.ServicesSummary, TeamRepository.Utc(b.ProposedStartsAt), b.ProposedBy);

    public static string NewReference() => "BK-" + RandomNumberGenerator.GetString("ABCDEFGHJKLMNPQRSTUVWXYZ23456789", 8);
    public static string NewToken() => Convert.ToBase64String(RandomNumberGenerator.GetBytes(24)).TrimEnd('=').Replace('+', '-').Replace('/', '_');
    public static string Hash(string token) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(token))).ToLowerInvariant();

    public static bool TokenMatches(string? storedHash, string? token) =>
        storedHash is not null && !string.IsNullOrEmpty(token) && token.Length <= 100 &&
        CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(storedHash), Encoding.ASCII.GetBytes(Hash(token)));

    public sealed class ServiceRow
    {
        public Guid Id { get; set; }
        public string Name { get; set; } = "";
        public long PriceCents { get; set; }
        public int DurationMinutes { get; set; }
        public bool IsActive { get; set; }
        public bool IsPublic { get; set; }
        public bool AllowsHouseCall { get; set; }
        public long? StaffPriceCents { get; set; }
        public bool OfferedByStaff { get; set; }
    }

    public sealed record Prepared(IReadOnlyList<PricedItem> Items, IReadOnlyList<Guid?> ServiceIds, BookingQuote Quote, int People);

    /// <summary>Validates the requested services and prices them from the catalogue (or the barber's own price).</summary>
    public static async Task<Prepared> PrepareAsync(IDbConnection conn, IDbTransaction? tx, Guid businessId, IReadOnlyList<BookingItemInput>? items,
        Guid? staffId, string locationType, PolicyRow policy, decimal? distanceKm, long discountCents, bool publicRequest)
    {
        var e = new ValidationErrors();
        if (items is null || items.Count == 0) throw new RequestValidationException(e.Add("items", "Choose at least one service."));
        if (items.Count > 20) throw new RequestValidationException(e.Add("items", "Choose at most 20 services."));
        foreach (var (it, i) in items.Select((it, i) => (it, i)))
            if (it.PersonLabel is { Length: > 40 }) e.Add($"items[{i}].personLabel", "Use 40 characters or fewer.");
        RequestValidationException.ThrowIfInvalid(e);
        var ids = items.Select(i => i.ServiceId).Distinct().ToArray();
        var rows = (await conn.QueryAsync<ServiceRow>(
            """
            SELECT s.id, s.name, s.price_cents, s.duration_minutes, s.is_active, s.is_public, s.allows_house_call,
                   ss.price_cents AS staff_price_cents, (ss.service_id IS NOT NULL) AS offered_by_staff
            FROM services s LEFT JOIN staff_services ss ON ss.service_id = s.id AND ss.staff_id = @Staff
            WHERE s.business_id = @B AND s.id = ANY(@Ids)
            """, new { B = businessId, Ids = ids, Staff = staffId }, tx)).ToDictionary(r => r.Id);
        foreach (var id in ids)
        {
            if (!rows.TryGetValue(id, out var r) || !r.IsActive || (publicRequest && !r.IsPublic))
                throw new RequestValidationException(new ValidationErrors().Add("items", "One of the chosen services is not available."));
            if (locationType == "house_call" && !r.AllowsHouseCall)
                throw new RequestValidationException(new ValidationErrors().Add("items", $"{r.Name} is not offered as a house call."));
        }
        var people = items.Select(i => string.IsNullOrWhiteSpace(i.PersonLabel) ? "Person 1" : i.PersonLabel.Trim()).Distinct().Count();
        var priced = items.Select(i =>
        {
            var r = rows[i.ServiceId];
            return new PricedItem(r.Name, string.IsNullOrWhiteSpace(i.PersonLabel) ? "Person 1" : i.PersonLabel.Trim(), r.StaffPriceCents ?? r.PriceCents, r.DurationMinutes);
        }).ToList();
        TravelFeeQuote? travel = null;
        if (locationType == "house_call")
        {
            if (!policy.HouseCallsEnabled) throw new RequestValidationException(new ValidationErrors().Add("locationType", "This business is not taking house calls."));
            travel = BookingPricing.TravelFee(policy.Travel, distanceKm);
            if (travel.OutsideServiceArea) throw new RequestValidationException(new ValidationErrors().Add("houseCall", travel.Explanation));
        }
        var quote = BookingPricing.Quote(priced, discountCents, travel);
        return new Prepared(priced, items.Select(i => (Guid?)i.ServiceId).ToList(), quote, people);
    }

    /// <summary>Picks a bookable barber who offers every chosen service (if the business assigned services) and is free.</summary>
    public async Task<(StaffRow? Staff, string? Why)> ChooseStaffAsync(IDbConnection conn, IDbTransaction? tx, Guid businessId, Guid? requested,
        DateTimeOffset start, DateTimeOffset end, string locationType, IReadOnlyCollection<Guid> serviceIds, PolicyRow policy, Guid? exceptBooking)
    {
        var staff = (await TeamRepository.ListAsync(conn, businessId, tx)).Where(s => s.IsActive && s.IsBookable).ToList();
        if (requested is { } r) staff = staff.Where(s => s.Id == r).ToList();
        if (staff.Count == 0) return (null, requested is null ? "No barbers are taking bookings yet." : "That barber is not taking bookings.");
        if (locationType == "house_call") staff = staff.Where(s => s.AcceptsHouseCalls).ToList();
        if (staff.Count == 0) return (null, "No barber is doing house calls.");
        var offers = (await conn.QueryAsync<(Guid StaffId, Guid ServiceId)>("SELECT staff_id, service_id FROM staff_services WHERE business_id = @B", new { B = businessId }, tx)).ToList();
        var now = clock.UtcNow;
        var schedules = await TeamRepository.SchedulesAsync(conn, businessId, staff, start.AddDays(-1), end.AddDays(1), tx);
        string? lastWhy = null;
        foreach (var s in staff)
        {
            var assigned = offers.Where(o => o.StaffId == s.Id).Select(o => o.ServiceId).ToHashSet();
            if (assigned.Count > 0 && !serviceIds.All(assigned.Contains)) { lastWhy = $"{s.DisplayName} does not offer all of the chosen services."; continue; }
            var sch = schedules[s.Id];
            var busy = await TeamRepository.ConfirmedAsync(conn, businessId, s.Id, start.AddHours(-12), end.AddHours(12), exceptBooking, tx);
            var why = SlotFinder.WhyNot(start, end, now, policy.BookingLeadMinutes, sch.Hours, sch.TimeOff, busy, sch.BlockedUntil(now));
            if (why is null) return (s, null);
            lastWhy = requested is null ? why : why.Replace("This barber", s.DisplayName);
        }
        return (null, lastWhy ?? "No barber is free at that time.");
    }

    public static Task EventAsync(IDbConnection conn, IDbTransaction tx, Guid businessId, Guid bookingId, string evt, string? from, string? to,
        string actorKind, Guid? actorUserId, string? note) =>
        conn.ExecuteAsync(
            "INSERT INTO booking_events (business_id, booking_id, event, from_status, to_status, actor_kind, actor_user_id, note) VALUES (@B, @Id, @E, @F, @T, @K, @U, @N)",
            new { B = businessId, Id = bookingId, E = evt, F = from, T = to, K = actorKind, U = actorUserId, N = note }, tx);

    /// <summary>Tells the people who handle bookings (and the assigned barber) about a change.</summary>
    public static async Task NotifyAsync(IDbConnection conn, IDbTransaction tx, BookingRow b, string title, string body, string key, string severity = "informational")
    {
        await NotificationRepository.NotifyAsync(conn, tx, b.BusinessId, Permission.ManageBookings, "booking", severity, title, body, $"/bookings/{b.Id}", key, b.BranchId);
        if (b.StaffUserId is { } u)
            await TeamRepository.NotifyUserAsync(conn, tx, b.BusinessId, u, "booking", severity, title, body, $"/workspace", key);
    }

    /// <summary>Confirms after re-checking availability on the server under a per-barber lock. The database exclusion
    /// constraint also prevents two overlapping confirmed bookings for the same barber.</summary>
    public async Task ConfirmAsync(IDbConnection conn, IDbTransaction tx, BookingRow b, DateTimeOffset start, DateTimeOffset end, Guid? staffId,
        long travelFeeCents, PolicyRow policy, string actorKind, Guid? actorUserId, bool canOverride, bool requestOverride, string? overrideReason)
    {
        if (staffId is null) throw new ConflictException("Assign a barber before confirming.");
        await conn.ExecuteAsync("SELECT pg_advisory_xact_lock(hashtextextended(@K, 0))", new { K = "staff:" + staffId }, tx);
        var staff = await TeamRepository.GetAsync(conn, b.BusinessId, staffId.Value, tx);
        if (staff is null || !staff.IsActive) throw new ConflictException("That barber is not active.");
        var now = clock.UtcNow;
        var sch = (await TeamRepository.SchedulesAsync(conn, b.BusinessId, [staff], start.AddDays(-1), end.AddDays(1), tx))[staff.Id];
        var busy = await TeamRepository.ConfirmedAsync(conn, b.BusinessId, staff.Id, start.AddHours(-12), end.AddHours(12), b.Id, tx);
        if (busy.Any(x => SlotFinder.Overlaps(start, end, x.StartsAt, x.EndsAt)))
            throw new ConflictException($"{staff.DisplayName} already has a confirmed appointment that overlaps this time.");
        var why = SlotFinder.WhyNot(start, end, now, 0, sch.Hours, sch.TimeOff, [], sch.BlockedUntil(now));
        var overridden = false;
        if (why is not null)
        {
            if (!requestOverride) throw new ConflictException(why.Replace("This barber", staff.DisplayName) + " The owner can confirm an exception if the business allows it.");
            if (!canOverride || !policy.AllowOffDutyOverride)
                throw new ForbiddenException("Exceptions to a barber's availability are switched off, or your role cannot approve them.");
            if (string.IsNullOrWhiteSpace(overrideReason)) throw new RequestValidationException(new ValidationErrors().Add("overrideReason", "Give a reason for the exception."));
            overridden = true;
        }
        try
        {
            await conn.ExecuteAsync(
                """
                UPDATE bookings SET status = 'confirmed', starts_at = @S, ends_at = @E, staff_id = @Staff, branch_id = COALESCE(@Branch, branch_id),
                    travel_fee_cents = @Fee, total_cents = services_total_cents + @Fee - discount_cents,
                    proposed_starts_at = NULL, proposed_ends_at = NULL, proposed_staff_id = NULL, proposed_travel_fee_cents = NULL, proposed_by = NULL, proposal_note = NULL,
                    off_duty_override = @Ov, override_reason = @OvR, confirmed_by = @U, confirmed_at = now(), updated_at = now()
                WHERE id = @Id AND business_id = @B
                """, new { S = start.UtcDateTime, E = end.UtcDateTime, Staff = staff.Id, Branch = staff.BranchId, Fee = travelFeeCents, Ov = overridden,
                    OvR = overridden ? overrideReason!.Trim() : null, U = actorUserId, Id = b.Id, B = b.BusinessId }, tx);
        }
        catch (Exception ex) when (ex.Message.Contains("exclusion", StringComparison.OrdinalIgnoreCase) || ex.Message.Contains("conflicting key", StringComparison.OrdinalIgnoreCase)
                                   || (ex is Npgsql.PostgresException pg && pg.SqlState == "23P01"))
        {
            throw new ConflictException($"{staff.DisplayName} already has a confirmed appointment that overlaps this time.");
        }
        await EventAsync(conn, tx, b.BusinessId, b.Id, "confirmed", b.Status, BookingStatuses.Confirmed, actorKind, actorUserId,
            overridden ? "Confirmed as an approved exception: " + overrideReason!.Trim() : null);
    }
}

/// <summary>Bookings for the business (staff side) and house calls.</summary>
public sealed class BookingService(IDbConnectionFactory db, IBusinessContext business, BookingEngine engine, IClock clock)
{
    private async Task<(AccessContext Access, Guid? MyStaffId)> AccessAsync(IDbConnection conn)
    {
        var access = await business.RequireAsync(Permission.ViewBookings, Permission.ManageBookings, Permission.WorkOwnBookings);
        var mine = await TeamRepository.ForUserAsync(conn, access.BusinessId, access.UserId);
        return (access, mine?.Id);
    }

    private static bool CanSee(AccessContext a, Guid? myStaffId, BookingRow b) =>
        (a.Can(Permission.ViewBookings) || a.Can(Permission.ManageBookings)) && (a.AllBranches || b.BranchId is null || a.CanSeeBranch(b.BranchId))
        || (a.Can(Permission.WorkOwnBookings) && myStaffId is not null && b.StaffId == myStaffId);

    private static bool CanManage(AccessContext a, Guid? myStaffId, BookingRow b) =>
        a.Can(Permission.ManageBookings) && (a.AllBranches || b.BranchId is null || a.CanSeeBranch(b.BranchId))
        || (a.Can(Permission.WorkOwnBookings) && myStaffId is not null && b.StaffId == myStaffId);

    /// <summary>Loads a booking the caller may see (404 otherwise). <c>CanManage</c>: managers in scope, or the barber it is assigned to.</summary>
    internal async Task<(AccessContext Access, Guid? MyStaffId, BookingRow Row, bool CanManage)> LoadVisibleAsync(IDbConnection conn, Guid id, IDbTransaction? tx = null, bool forUpdate = false)
    {
        var (access, mine) = await AccessAsync(conn);
        var b = await BookingEngine.GetAsync(conn, access.BusinessId, id, tx, forUpdate) ?? throw new NotFoundException();
        if (!CanSee(access, mine, b)) throw new NotFoundException();
        return (access, mine, b, CanManage(access, mine, b));
    }

    /// <summary>Visit margins and cost estimates are for people who run the shop, not for barbers.</summary>
    private static bool ShowsShopEconomics(AccessContext a) =>
        a.Can(Permission.ViewFinancials) || a.Can(Permission.ManageBookings) || a.Can(Permission.ViewBookings);

    private static bool CanOverride(AccessContext a) => a.Role is Roles.Owner or Roles.BusinessAdmin;

    public async Task<IReadOnlyList<BookingSummaryDto>> ListAsync(DateOnly? from, DateOnly? to, string? status, Guid? staffId, string? locationType, CancellationToken ct)
    {
        await using var conn = await db.OpenAsync(ct);
        var (access, mine) = await AccessAsync(conn);
        if (status is not null && !BookingStatuses.All.Contains(status)) throw new RequestValidationException(new ValidationErrors().Add("status", "Unknown status."));
        var start = from ?? clock.Today.AddDays(-7);
        var end = to ?? clock.Today.AddDays(30);
        if (end < start || end.DayNumber - start.DayNumber > 370) throw new RequestValidationException(new ValidationErrors().Add("to", "Choose up to one year."));
        var onlyMine = !access.Can(Permission.ViewBookings) && !access.Can(Permission.ManageBookings);
        var rows = await conn.QueryAsync<BookingRow>(
            $"""
            {BookingEngine.Select}
            WHERE b.business_id = @B
              AND (b.starts_at AT TIME ZONE 'Africa/Johannesburg')::date BETWEEN @From AND @To
              AND (@Status::text IS NULL OR b.status = @Status)
              AND (@Staff::uuid IS NULL OR b.staff_id = @Staff::uuid)
              AND (@Loc::text IS NULL OR b.location_type = @Loc)
              AND (NOT @OnlyMine OR b.staff_id = @Mine::uuid)
              AND (@Branches::uuid[] IS NULL OR b.branch_id IS NULL OR b.branch_id = ANY(@Branches::uuid[]) OR b.staff_id = @Mine::uuid)
            ORDER BY b.starts_at LIMIT 500
            """, new { B = access.BusinessId, From = start, To = end, Status = status, Staff = staffId, Loc = locationType, OnlyMine = onlyMine, Mine = mine, Branches = access.BranchFilter });
        return rows.Select(BookingEngine.Summary).ToList();
    }

    public async Task<BookingDetailDto> GetAsync(Guid id, CancellationToken ct)
    {
        await using var conn = await db.OpenAsync(ct);
        var (access, mine) = await AccessAsync(conn);
        var b = await BookingEngine.GetAsync(conn, access.BusinessId, id) ?? throw new NotFoundException();
        if (!CanSee(access, mine, b)) throw new NotFoundException();
        return await DetailAsync(conn, access, mine, b);
    }

    private sealed class HcRow
    {
        public string AddressLine { get; set; } = "";
        public string? Suburb { get; set; }
        public string? Town { get; set; }
        public string? AccessNotes { get; set; }
        public decimal? Latitude { get; set; }
        public decimal? Longitude { get; set; }
        public decimal? DistanceKm { get; set; }
        public string DistanceSource { get; set; } = "";
        public long? EstimatedTravelCostCents { get; set; }
        public long? EstimatedOtherCostCents { get; set; }
    }

    internal static async Task<HouseCallDto?> HouseCallAsync(IDbConnection conn, BookingRow b, bool addressVisible, bool showEconomics = true)
    {
        if (b.LocationType != "house_call") return null;
        var h = await conn.QueryFirstOrDefaultAsync<HcRow>(
            "SELECT address_line, suburb, town, access_notes, latitude, longitude, distance_km, distance_source, estimated_travel_cost_cents, estimated_other_cost_cents FROM house_call_details WHERE booking_id = @Id AND business_id = @B",
            new { Id = b.Id, B = b.BusinessId });
        if (h is null) return null;
        var actual = await conn.QuerySingleAsync<(long Sum, int N)>(
            "SELECT COALESCE(SUM(amount_cents), 0)::bigint, COUNT(*)::int FROM transactions WHERE booking_id = @Id AND business_id = @B AND type = 'expense' AND status = 'posted'",
            new { Id = b.Id, B = b.BusinessId });
        var revenue = b.Status is BookingStatuses.Cancelled or BookingStatuses.NoShow ? 0 : b.TotalCents;
        var econ = HouseCalls.Economics(revenue, h.EstimatedTravelCostCents, h.EstimatedOtherCostCents, actual.Sum, actual.N > 0);
        var distanceLabel = h.DistanceSource switch
        {
            "manual" => $"{h.DistanceKm:0.#} km (entered by the business, not calculated)",
            "provider" => $"{h.DistanceKm:0.#} km (road distance from the mapping provider)",
            _ => "Distance not calculated (no mapping provider is configured)"
        };
        return new HouseCallDto(addressVisible ? h.AddressLine : null, addressVisible ? h.Suburb : null, h.Town, addressVisible ? h.AccessNotes : null,
            addressVisible ? h.Latitude : null, addressVisible ? h.Longitude : null, h.DistanceKm, h.DistanceSource, distanceLabel,
            showEconomics ? h.EstimatedTravelCostCents : null, showEconomics ? h.EstimatedOtherCostCents : null, addressVisible,
            // The shop's margin on a visit is business information: barbers see the visit, not the shop's contribution.
            showEconomics
                ? new HouseCallEconomicsDto(econ.RevenueCents, econ.EstimatedCostsCents, econ.ActualCostsCents, econ.EstimatedContributionCents,
                    econ.ActualContributionCents, econ.HasActualCosts, econ.Caveat)
                : null);
    }

    private async Task<BookingDetailDto> DetailAsync(IDbConnection conn, AccessContext access, Guid? mine, BookingRow b)
    {
        var items = (await conn.QueryAsync<(Guid Id, Guid? ServiceId, string Name, string Person, long Price, int Dur)>(
            "SELECT id, service_id, service_name, person_label, unit_price_cents, duration_minutes FROM booking_items WHERE booking_id = @Id ORDER BY person_label, service_name",
            new { Id = b.Id })).Select(i => new BookingItemDto(i.Id, i.ServiceId, i.Name, i.Person, i.Price, i.Dur)).ToList();
        var events = (await conn.QueryAsync<(string E, string? F, string? T, string K, string? N, DateTime At)>(
            "SELECT event, from_status, to_status, actor_kind, note, created_at FROM booking_events WHERE booking_id = @Id ORDER BY created_at, id", new { Id = b.Id }))
            .Select(e => new BookingEventDto(e.E, e.F, e.T, e.K, e.N, TeamRepository.Utc(e.At))).ToList();
        var payments = (await conn.QueryAsync<(Guid Id, long A, string M, string S, DateOnly D)>(
            "SELECT id, amount_cents, payment_method, payment_status, transaction_date FROM transactions WHERE booking_id = @Id AND business_id = @B AND type = 'income' AND status = 'posted' ORDER BY transaction_date",
            new { Id = b.Id, B = b.BusinessId })).Select(p => new BookingPaymentDto(p.Id, p.A, p.M, p.S, p.D)).ToList();
        var debts = (await conn.QueryAsync<Guid>("SELECT id FROM receivables WHERE booking_id = @Id AND business_id = @B", new { Id = b.Id, B = b.BusinessId })).ToList();
        var manage = CanManage(access, mine, b);
        var addressVisible = manage || access.Can(Permission.ManageBookings);
        var actions = new List<string>();
        if (manage)
        {
            foreach (var a in new[] { BookingActions.Confirm, BookingActions.ProposeReschedule, BookingActions.Complete, BookingActions.NoShow, BookingActions.Cancel })
                if (BookingStateMachine.Next(b.Status, a) is not null) actions.Add(a);
            if (b.Status == BookingStatuses.RescheduleProposed && b.ProposedBy == "customer") { actions.Add(BookingActions.AcceptProposal); actions.Add(BookingActions.RejectProposal); }
            if (b.Status == BookingStatuses.RescheduleProposed && b.ProposedBy == "business") actions.Remove(BookingActions.Confirm);
        }
        return new BookingDetailDto(BookingEngine.Summary(b), manage ? b.CustomerPhone : null, manage ? b.CustomerEmail : null, b.CustomerId, b.CustomerNote,
            manage ? b.InternalNote : null, b.ServicesTotalCents, b.TravelFeeCents, b.DiscountCents, b.ProposedTravelFeeCents, TeamRepository.Utc(b.ProposedEndsAt),
            b.ProposedStaffId, b.ProposalNote, b.Source, b.OffDutyOverride, b.OverrideReason, b.CancelReason, items, events, payments,
            await HouseCallAsync(conn, b, addressVisible, ShowsShopEconomics(access)), debts, actions, b.CustomerUserId, manage ? b.VerifiedContact : null);
    }

    public async Task<QuoteDto> QuoteAsync(BookingInput input, CancellationToken ct)
    {
        await using var conn = await db.OpenAsync(ct);
        var (access, _) = await AccessAsync(conn);
        var policy = await PolicyRepository.GetAsync(conn, access.BusinessId);
        var p = await BookingEngine.PrepareAsync(conn, null, access.BusinessId, input.Items, input.StaffId, input.LocationType ?? "in_shop", policy,
            input.HouseCall?.DistanceKm, input.DiscountCents ?? 0, false);
        return new QuoteDto(p.Quote.ServicesTotalCents, p.Quote.TravelFeeCents, p.Quote.DiscountCents, p.Quote.TotalCents, p.Quote.DurationMinutes,
            p.Quote.Travel?.IsFinal ?? true, p.Quote.Travel?.Explanation, p.Quote.Travel?.OutsideServiceArea ?? false);
    }

    internal static ValidationErrors ValidateCommon(DateTimeOffset? startsAt, string? locationType, HouseCallInput? hc, string? name, string? phone, string? email, string? note)
    {
        var e = new ValidationErrors();
        if (startsAt is null) e.Add("startsAt", "Choose a date and time.");
        if (locationType is not (null or "in_shop" or "house_call")) e.Add("locationType", "Choose in-shop or house call.");
        e.Required("customerName", name, 1, 120);
        e.Phone("customerPhone", phone);
        e.Email("customerEmail", email, false);
        e.Optional("customerNote", note, 500);
        if (locationType == "house_call")
        {
            if (hc is null) e.Add("houseCall", "Enter the address for the house call.");
            else
            {
                e.Required("houseCall.addressLine", hc.AddressLine, 3, 200);
                e.Optional("houseCall.suburb", hc.Suburb, 80);
                e.Optional("houseCall.town", hc.Town, 80);
                e.Optional("houseCall.accessNotes", hc.AccessNotes, 300);
                if (hc.Latitude is < -90 or > 90 || hc.Longitude is < -180 or > 180) e.Add("houseCall.latitude", "The map pin is not valid.");
                if (hc.DistanceKm is < 0 or > 9999) e.Add("houseCall.distanceKm", "Enter a valid distance.");
            }
        }
        return e;
    }

    /// <summary>Creates a booking. Shared by staff and the public booking page.</summary>
    internal async Task<(BookingRow Row, string? Token)> CreateInternalAsync(IDbConnection conn, Guid businessId, BookingInput input, string source,
        Guid? actorUserId, bool confirm, bool canOverride, bool publicRequest, Guid? customerUserId = null, string? verifiedContact = null)
    {
        var loc = input.LocationType ?? "in_shop";
        RequestValidationException.ThrowIfInvalid(ValidateCommon(input.StartsAt, loc, input.HouseCall, input.CustomerName, input.CustomerPhone, input.CustomerEmail, input.CustomerNote));
        var e = new ValidationErrors();
        e.Optional("internalNote", input.InternalNote, 500);
        if (input.DiscountCents is < 0 or > 10_000_000) e.Add("discountCents", "Enter a valid discount.");
        RequestValidationException.ThrowIfInvalid(e);
        var policy = await PolicyRepository.GetAsync(conn, businessId);
        var now = clock.UtcNow;
        var start = input.StartsAt!.Value;
        if (start > now.AddDays(policy.BookingHorizonDays + 1)) throw new RequestValidationException(new ValidationErrors().Add("startsAt", $"Bookings can be made up to {policy.BookingHorizonDays} days ahead."));
        // A manually entered distance only comes from staff; the public form cannot set prices through a distance.
        var distance = publicRequest ? null : input.HouseCall?.DistanceKm;

        using var tx = conn.BeginTransaction();
        var prep = await BookingEngine.PrepareAsync(conn, tx, businessId, input.Items, input.StaffId, loc, policy, distance, input.DiscountCents ?? 0, publicRequest);
        var end = start.AddMinutes(prep.Quote.DurationMinutes);
        var (staff, why) = await engine.ChooseStaffAsync(conn, tx, businessId, input.StaffId, start, end, loc,
            prep.ServiceIds.Where(x => x is not null).Select(x => x!.Value).Distinct().ToList(), policy, null);
        if (staff is null)
        {
            // Staff may still record a request for an unavailable time and confirm it later as an approved exception.
            if (publicRequest || input.StaffId is null || !(confirm && input.OffDutyOverride))
                throw new ConflictException(why ?? "No barber is free at that time.");
            staff = await TeamRepository.GetAsync(conn, businessId, input.StaffId.Value, tx) ?? throw new NotFoundException("Barber not found.");
        }
        if (input.StaffId is not null && prep.Items.Count > 0)
        {
            // Re-price with the chosen barber's own prices.
            prep = await BookingEngine.PrepareAsync(conn, tx, businessId, input.Items, staff.Id, loc, policy, distance, input.DiscountCents ?? 0, publicRequest);
        }
        else if (input.StaffId is null)
        {
            prep = await BookingEngine.PrepareAsync(conn, tx, businessId, input.Items, staff.Id, loc, policy, distance, input.DiscountCents ?? 0, publicRequest);
            end = start.AddMinutes(prep.Quote.DurationMinutes);
        }
        if (publicRequest && !string.IsNullOrWhiteSpace(input.CustomerPhone) &&
            await conn.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM bookings WHERE business_id = @B AND customer_phone = @P AND status IN ('requested','reschedule_proposed') AND starts_at > now()",
                new { B = businessId, P = input.CustomerPhone.Trim() }, tx) >= 3)
            throw new ConflictException("You already have several booking requests waiting. Please wait for the business to respond.");
        if (customerUserId is { } cu &&
            await conn.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM bookings WHERE business_id = @B AND customer_user_id = @U AND status IN ('requested','reschedule_proposed') AND starts_at > now()",
                new { B = businessId, U = cu }, tx) >= 3)
            throw new ConflictException("You already have several booking requests waiting. Please wait for the business to respond.");

        Guid? customerId = input.CustomerId;
        if (customerId is { } cid && await conn.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM customers WHERE id = @Id AND business_id = @B", new { Id = cid, B = businessId }, tx) == 0)
            throw new RequestValidationException(new ValidationErrors().Add("customerId", "Choose one of your customers."));

        string? token = publicRequest ? BookingEngine.NewToken() : null;
        var reference = BookingEngine.NewReference();
        var id = await conn.QuerySingleAsync<Guid>(
            """
            INSERT INTO bookings (business_id, reference, customer_id, customer_name, customer_phone, customer_email, staff_id, branch_id, location_type,
                starts_at, ends_at, status, people_count, services_total_cents, travel_fee_cents, discount_cents, total_cents, source, customer_note,
                internal_note, status_token_hash, created_by, customer_user_id, verified_contact)
            VALUES (@B, @Ref, @Cust, @Name, @Phone, @Email, @Staff, @Branch, @Loc, @S, @E, 'requested', @People, @Svc, @Fee, @Disc, @Total, @Source,
                @CNote, @INote, @Hash, @U, @CustUser, @Verified)
            RETURNING id
            """, new { B = businessId, Ref = reference, Cust = customerId, Name = input.CustomerName!.Trim(), Phone = Clean(input.CustomerPhone),
                Email = Clean(input.CustomerEmail), Staff = staff.Id, Branch = staff.BranchId, Loc = loc, S = start.UtcDateTime, E = end.UtcDateTime,
                People = prep.People, Svc = prep.Quote.ServicesTotalCents, Fee = prep.Quote.TravelFeeCents, Disc = prep.Quote.DiscountCents,
                Total = prep.Quote.TotalCents, Source = source, CNote = Clean(input.CustomerNote), INote = Clean(input.InternalNote),
                Hash = token is null ? null : BookingEngine.Hash(token), U = actorUserId, CustUser = customerUserId, Verified = verifiedContact }, tx);
        foreach (var it in prep.Items.Select((it, i) => (it, i)))
            await conn.ExecuteAsync(
                "INSERT INTO booking_items (business_id, booking_id, service_id, service_name, person_label, unit_price_cents, duration_minutes) VALUES (@B, @Id, @Svc, @Name, @P, @Price, @Dur)",
                new { B = businessId, Id = id, Svc = prep.ServiceIds[it.i], Name = it.it.ServiceName, P = it.it.PersonLabel, Price = it.it.UnitPriceCents, Dur = it.it.DurationMinutes }, tx);
        if (loc == "house_call")
        {
            var hc = input.HouseCall!;
            await conn.ExecuteAsync(
                """
                INSERT INTO house_call_details (booking_id, business_id, address_line, suburb, town, access_notes, latitude, longitude, distance_km, distance_source)
                VALUES (@Id, @B, @Addr, @Sub, @Town, @Notes, @Lat, @Lng, @Km, @Src)
                """, new { Id = id, B = businessId, Addr = hc.AddressLine!.Trim(), Sub = Clean(hc.Suburb), Town = Clean(hc.Town), Notes = Clean(hc.AccessNotes),
                    Lat = hc.Latitude, Lng = hc.Longitude, Km = distance, Src = distance is null ? "uncalculated" : "manual" }, tx);
        }
        await BookingEngine.EventAsync(conn, tx, businessId, id, "requested", null, BookingStatuses.Requested, publicRequest ? "customer" : "staff", actorUserId,
            publicRequest ? "Requested through the public booking page." : null);
        var row = (await BookingEngine.GetAsync(conn, businessId, id, tx))!;

        if (confirm || (publicRequest && policy.BookingAutoConfirm))
        {
            if (publicRequest) await conn.ExecuteAsync("SAVEPOINT auto_confirm", transaction: tx);
            try
            {
                await engine.ConfirmAsync(conn, tx, row, start, end, staff.Id, prep.Quote.TravelFeeCents, policy, publicRequest ? "system" : "staff", actorUserId,
                    canOverride, input.OffDutyOverride, input.OverrideReason);
            }
            catch (ConflictException) when (publicRequest)
            {
                // Auto-confirm is best effort: the request stays "requested" for a person to decide.
                await conn.ExecuteAsync("ROLLBACK TO SAVEPOINT auto_confirm", transaction: tx);
            }
            row = (await BookingEngine.GetAsync(conn, businessId, id, tx))!;
        }
        await BookingEngine.NotifyAsync(conn, tx, row, row.Status == BookingStatuses.Confirmed ? "New booking confirmed" : "New booking request",
            $"{row.CustomerName}: {row.ServicesSummary} on {TeamRepository.Utc(row.StartsAt).ToOffset(StaffAvailability.SaOffset):ddd d MMM HH:mm}" +
            (loc == "house_call" ? " (house call)" : "") + $" with {row.StaffName}.", $"booking:new:{id}");
        tx.Commit();
        return (row, token);
    }

    public async Task<BookingDetailDto> CreateAsync(BookingInput input, CancellationToken ct)
    {
        await using var conn = await db.OpenAsync(ct);
        var access = await business.RequireAsync(Permission.ManageBookings);
        var (row, _) = await CreateInternalAsync(conn, access.BusinessId, input, "staff", access.UserId, input.Confirm, CanOverride(access), false);
        await AuditRepository.WriteAsync(conn, null, access.BusinessId, access.UserId, "booking_created", "booking", row.Id);
        var mine = (await TeamRepository.ForUserAsync(conn, access.BusinessId, access.UserId))?.Id;
        return await DetailAsync(conn, access, mine, row);
    }

    public async Task<AvailabilityDto> AvailabilityAsync(Guid businessId, DateOnly date, IReadOnlyList<Guid> serviceIds, Guid? staffId, string? locationType,
        bool publicRequest, CancellationToken ct)
    {
        await using var conn = await db.OpenAsync(ct);
        return await AvailabilityInternalAsync(conn, businessId, date, serviceIds, staffId, locationType, publicRequest);
    }

    public async Task<AvailabilityDto> AvailabilityForMemberAsync(DateOnly date, IReadOnlyList<Guid> serviceIds, Guid? staffId, string? locationType, CancellationToken ct)
    {
        var access = await business.RequireAsync(Permission.ViewBookings, Permission.ManageBookings, Permission.WorkOwnBookings);
        await using var conn = await db.OpenAsync(ct);
        return await AvailabilityInternalAsync(conn, access.BusinessId, date, serviceIds, staffId, locationType, false);
    }

    internal async Task<AvailabilityDto> AvailabilityInternalAsync(IDbConnection conn, Guid businessId, DateOnly date, IReadOnlyList<Guid> serviceIds,
        Guid? staffId, string? locationType, bool publicRequest)
    {
        var loc = locationType ?? "in_shop";
        var policy = await PolicyRepository.GetAsync(conn, businessId);
        var now = clock.UtcNow;
        var notes = new List<string>();
        if (date < clock.Today || date > clock.Today.AddDays(policy.BookingHorizonDays))
            return new AvailabilityDto(date, 0, [], [$"Choose a date from today up to {policy.BookingHorizonDays} days ahead."]);
        var prep = await BookingEngine.PrepareAsync(conn, null, businessId, serviceIds.Select(id => new BookingItemInput(id, null)).ToList(), staffId, loc, policy, null, 0, publicRequest);
        var duration = prep.Quote.DurationMinutes;
        var staff = (await TeamRepository.ListAsync(conn, businessId)).Where(s => s.IsActive && s.IsBookable && (staffId is null || s.Id == staffId)
                     && (loc != "house_call" || s.AcceptsHouseCalls)).ToList();
        var offers = (await conn.QueryAsync<(Guid StaffId, Guid ServiceId)>("SELECT staff_id, service_id FROM staff_services WHERE business_id = @B", new { B = businessId })).ToList();
        var dayStart = new DateTimeOffset(date.ToDateTime(TimeOnly.MinValue), StaffAvailability.SaOffset);
        var schedules = await TeamRepository.SchedulesAsync(conn, businessId, staff, dayStart.AddDays(-1), dayStart.AddDays(2));
        var slots = new List<SlotDto>();
        foreach (var s in staff)
        {
            var assigned = offers.Where(o => o.StaffId == s.Id).Select(o => o.ServiceId).ToHashSet();
            if (assigned.Count > 0 && !serviceIds.All(assigned.Contains)) continue;
            var sch = schedules[s.Id];
            var busy = await TeamRepository.ConfirmedAsync(conn, businessId, s.Id, dayStart.AddHours(-12), dayStart.AddHours(36));
            var blocked = sch.BlockedUntil(now);
            if (blocked is not null && date == clock.Today) notes.Add($"{s.DisplayName} is {StaffStatuses.Label(sch.Effective(now).Status).ToLowerInvariant()} and not taking new bookings right now.");
            foreach (var slot in SlotFinder.FreeSlots(new SlotQuery(date, duration, policy.SlotIntervalMinutes, now, policy.BookingLeadMinutes), sch.Hours, sch.TimeOff, busy, blocked))
                slots.Add(new SlotDto(slot.StartsAt, slot.EndsAt, s.Id, s.DisplayName));
        }
        if (staff.Count == 0) notes.Add(loc == "house_call" ? "No barber is doing house calls." : "No barbers are taking bookings yet.");
        notes.Add("Times are requests until the business confirms them. Pending requests do not block a time.");
        return new AvailabilityDto(date, duration, slots.OrderBy(s => s.StartsAt).ThenBy(s => s.StaffName).ToList(), notes.Distinct().ToList());
    }

    private async Task<(AccessContext Access, Guid? Mine, BookingRow Row)> ForChangeAsync(IDbConnection conn, IDbTransaction tx, Guid id)
    {
        var (access, mine) = await AccessAsync(conn);
        var b = await BookingEngine.GetAsync(conn, access.BusinessId, id, tx, forUpdate: true) ?? throw new NotFoundException();
        if (!CanSee(access, mine, b)) throw new NotFoundException();
        if (!CanManage(access, mine, b)) throw new ForbiddenException("Only the assigned barber or someone who manages bookings can change this booking.");
        return (access, mine, b);
    }

    private async Task<BookingDetailDto> AfterAsync(IDbConnection conn, AccessContext access, Guid? mine, Guid id) =>
        await DetailAsync(conn, access, mine, (await BookingEngine.GetAsync(conn, access.BusinessId, id))!);

    public async Task<BookingDetailDto> ConfirmAsync(Guid id, ConfirmInput input, CancellationToken ct)
    {
        await using var conn = await db.OpenAsync(ct);
        using var tx = conn.BeginTransaction();
        var (access, mine, b) = await ForChangeAsync(conn, tx, id);
        if (BookingStateMachine.Next(b.Status, BookingActions.Confirm) is null)
            throw new ConflictException(b.Status == BookingStatuses.RescheduleProposed ? "Waiting for the customer to answer the proposed time." : $"A {BookingStatuses.Label(b.Status).ToLowerInvariant()} booking cannot be confirmed.");
        var policy = await PolicyRepository.GetAsync(conn, access.BusinessId, tx);
        await engine.ConfirmAsync(conn, tx, b, TeamRepository.Utc(b.StartsAt), TeamRepository.Utc(b.EndsAt), b.StaffId, b.TravelFeeCents, policy, "staff", access.UserId,
            CanOverride(access), input.OffDutyOverride, input.OverrideReason);
        await AuditRepository.WriteAsync(conn, tx, access.BusinessId, access.UserId, "booking_confirmed", "booking", id, JsonSerializer.Serialize(new { exception = input.OffDutyOverride }));
        tx.Commit();
        return await AfterAsync(conn, access, mine, id);
    }

    public async Task<BookingDetailDto> ProposeAsync(Guid id, ProposeInput input, CancellationToken ct)
    {
        var e = new ValidationErrors();
        if (input.StartsAt is null) e.Add("startsAt", "Choose the new time.");
        if (input.TravelFeeCents is < 0 or > 10_000_000) e.Add("travelFeeCents", "Enter a valid travel fee.");
        e.Optional("note", input.Note, 300);
        RequestValidationException.ThrowIfInvalid(e);
        await using var conn = await db.OpenAsync(ct);
        using var tx = conn.BeginTransaction();
        var (access, mine, b) = await ForChangeAsync(conn, tx, id);
        if (BookingStateMachine.Next(b.Status, BookingActions.ProposeReschedule) is null) throw new ConflictException("This booking can no longer be rescheduled.");
        if (input.TravelFeeCents is not null && b.LocationType != "house_call") throw new RequestValidationException(new ValidationErrors().Add("travelFeeCents", "Only house calls have a travel fee."));
        var policy = await PolicyRepository.GetAsync(conn, access.BusinessId, tx);
        var start = input.StartsAt!.Value;
        var end = start.AddMinutes((TeamRepository.Utc(b.EndsAt) - TeamRepository.Utc(b.StartsAt)).TotalMinutes);
        var serviceIds = (await conn.QueryAsync<Guid>("SELECT service_id FROM booking_items WHERE booking_id = @Id AND service_id IS NOT NULL", new { Id = id }, tx)).Distinct().ToList();
        var (staff, why) = await engine.ChooseStaffAsync(conn, tx, access.BusinessId, input.StaffId ?? b.StaffId, start, end, b.LocationType, serviceIds, policy, b.Id);
        if (staff is null) throw new ConflictException(why ?? "That time is not available.");
        await conn.ExecuteAsync(
            """
            UPDATE bookings SET status = 'reschedule_proposed', proposed_starts_at = @S, proposed_ends_at = @E, proposed_staff_id = @Staff,
                proposed_travel_fee_cents = @Fee, proposed_by = 'business', proposal_note = @N, updated_at = now()
            WHERE id = @Id AND business_id = @B
            """, new { S = start.UtcDateTime, E = end.UtcDateTime, Staff = staff.Id, Fee = input.TravelFeeCents, N = Clean(input.Note), Id = id, B = access.BusinessId }, tx);
        await BookingEngine.EventAsync(conn, tx, access.BusinessId, id, "reschedule_proposed", b.Status, BookingStatuses.RescheduleProposed, "staff", access.UserId,
            $"Proposed {start.ToOffset(StaffAvailability.SaOffset):ddd d MMM HH:mm} with {staff.DisplayName}" + (input.TravelFeeCents is { } f ? $", travel fee {Money.FormatZar(f)}" : "") + ". " + input.Note);
        await AuditRepository.WriteAsync(conn, tx, access.BusinessId, access.UserId, "booking_reschedule_proposed", "booking", id);
        tx.Commit();
        return await AfterAsync(conn, access, mine, id);
    }

    /// <summary>Business answers a time the customer proposed.</summary>
    public async Task<BookingDetailDto> AnswerCustomerProposalAsync(Guid id, bool accept, ReasonInput input, CancellationToken ct)
    {
        await using var conn = await db.OpenAsync(ct);
        using var tx = conn.BeginTransaction();
        var (access, mine, b) = await ForChangeAsync(conn, tx, id);
        if (b.Status != BookingStatuses.RescheduleProposed || b.ProposedBy != "customer") throw new ConflictException("There is no customer proposal to answer.");
        if (accept)
        {
            var policy = await PolicyRepository.GetAsync(conn, access.BusinessId, tx);
            await engine.ConfirmAsync(conn, tx, b, TeamRepository.Utc(b.ProposedStartsAt)!.Value, TeamRepository.Utc(b.ProposedEndsAt)!.Value, b.ProposedStaffId ?? b.StaffId,
                b.TravelFeeCents, policy, "staff", access.UserId, CanOverride(access), false, null);
        }
        else
        {
            var to = BookingStateMachine.Next(b.Status, BookingActions.RejectProposal, "customer")!;
            await conn.ExecuteAsync(
                "UPDATE bookings SET status = @To, proposed_starts_at = NULL, proposed_ends_at = NULL, proposed_staff_id = NULL, proposed_travel_fee_cents = NULL, proposed_by = NULL, proposal_note = NULL, updated_at = now() WHERE id = @Id",
                new { To = to, Id = id }, tx);
            await BookingEngine.EventAsync(conn, tx, access.BusinessId, id, "proposal_rejected", b.Status, to, "staff", access.UserId, Clean(input.Reason));
        }
        await AuditRepository.WriteAsync(conn, tx, access.BusinessId, access.UserId, accept ? "booking_proposal_accepted" : "booking_proposal_rejected", "booking", id);
        tx.Commit();
        return await AfterAsync(conn, access, mine, id);
    }

    public async Task<BookingDetailDto> CancelAsync(Guid id, ReasonInput input, CancellationToken ct) => await SimpleTransitionAsync(id, BookingActions.Cancel, input.Reason, true, ct);
    public async Task<BookingDetailDto> NoShowAsync(Guid id, ReasonInput input, CancellationToken ct) => await SimpleTransitionAsync(id, BookingActions.NoShow, input.Reason, false, ct);

    private async Task<BookingDetailDto> SimpleTransitionAsync(Guid id, string action, string? reason, bool reasonRequired, CancellationToken ct)
    {
        if (reasonRequired && string.IsNullOrWhiteSpace(reason)) throw new RequestValidationException(new ValidationErrors().Add("reason", "Give a short reason."));
        if (reason is { Length: > 300 }) throw new RequestValidationException(new ValidationErrors().Add("reason", "Use 300 characters or fewer."));
        await using var conn = await db.OpenAsync(ct);
        using var tx = conn.BeginTransaction();
        var (access, mine, b) = await ForChangeAsync(conn, tx, id);
        var to = BookingStateMachine.Next(b.Status, action) ?? throw new ConflictException($"A {BookingStatuses.Label(b.Status).ToLowerInvariant()} booking cannot be changed like that.");
        if (action == BookingActions.NoShow && TeamRepository.Utc(b.StartsAt) > clock.UtcNow) throw new ConflictException("A no-show can only be recorded after the appointment time.");
        await conn.ExecuteAsync("UPDATE bookings SET status = @To, cancel_reason = CASE WHEN @To = 'cancelled' THEN @R ELSE cancel_reason END, updated_at = now() WHERE id = @Id",
            new { To = to, R = Clean(reason), Id = id }, tx);
        await BookingEngine.EventAsync(conn, tx, access.BusinessId, id, to, b.Status, to, "staff", access.UserId, Clean(reason));
        if (to == BookingStatuses.Cancelled)
            await BookingEngine.NotifyAsync(conn, tx, b, "Booking cancelled", $"{b.CustomerName}'s booking {b.Reference} was cancelled.", $"booking:cancel:{id}");
        await AuditRepository.WriteAsync(conn, tx, access.BusinessId, access.UserId, "booking_" + to, "booking", id);
        tx.Commit();
        return await AfterAsync(conn, access, mine, id);
    }

    /// <summary>Completes a visit: records what was paid (as income linked to the booking) and, optionally, a customer debt
    /// for what is still owed. The debt records whether the charge terms were shown to the customer.</summary>
    public async Task<BookingDetailDto> CompleteAsync(Guid id, CompleteInput input, CancellationToken ct)
    {
        var e = new ValidationErrors();
        var payments = input.Payments ?? [];
        foreach (var (p, i) in payments.Select((p, i) => (p, i)))
        {
            if (p.AmountCents is <= 0 or > 100_000_000) e.Add($"payments[{i}].amountCents", "Enter an amount above zero.");
            if (p.PaymentMethod is null || !PaymentMethods.All.Contains(p.PaymentMethod)) e.Add($"payments[{i}].paymentMethod", "Choose how the customer paid.");
        }
        e.Optional("note", input.Note, 300);
        RequestValidationException.ThrowIfInvalid(e);
        await using var conn = await db.OpenAsync(ct);
        using var tx = conn.BeginTransaction();
        var (access, mine, b) = await ForChangeAsync(conn, tx, id);
        if (BookingStateMachine.Next(b.Status, BookingActions.Complete) is null) throw new ConflictException("Only a confirmed booking can be completed.");
        if (payments.Count > 0 && !access.Can(Permission.RecordSales) && !access.Can(Permission.TakeBookingPayments))
            throw new ForbiddenException("Your role cannot record payments.");
        var paidNow = payments.Sum(p => p.AmountCents);
        var remaining = b.TotalCents - b.PaidCents - paidNow;
        if (remaining < 0) throw new RequestValidationException(new ValidationErrors().Add("payments", $"That is more than the {Money.FormatZar(b.TotalCents - b.PaidCents)} still due. Record tips separately."));
        var today = clock.Today;
        foreach (var p in payments)
        {
            Guid? shift = p.PaymentMethod == PaymentMethods.Cash
                ? await conn.QueryFirstOrDefaultAsync<Guid?>("SELECT id FROM shifts WHERE business_id = @B AND staff_user_id = @U AND status = 'open' ORDER BY opened_at DESC LIMIT 1", new { B = access.BusinessId, U = access.UserId }, tx)
                : null;
            var txId = await LedgerRepository.InsertAsync(conn, tx, access.BusinessId, access.UserId, TransactionTypes.Income, $"Booking {b.Reference}: {Trunc(b.ServicesSummary, 150)}",
                p.AmountCents, "Services", today, p.PaymentMethod!, PaymentStatuses.RecordedManually, TransactionStatuses.Posted, TransactionSources.Manual,
                b.Reference, null, Core.Integrations.RecordOrigins.StaffRecorded, b.BranchId, shift);
            await conn.ExecuteAsync("UPDATE transactions SET booking_id = @Bk WHERE id = @T", new { Bk = id, T = txId }, tx);
        }
        Guid? debtId = null;
        if (remaining > 0 && input.CreateDebtForRemainder)
        {
            if (!access.Can(Permission.ManageFinancials) && !access.Can(Permission.RecordDebtPayments))
                throw new ForbiddenException("Your role cannot record customer debts.");
            if (input.DebtDueDate is { } due && due < today) throw new RequestValidationException(new ValidationErrors().Add("debtDueDate", "The due date cannot be in the past."));
            var customerId = b.CustomerId ?? await FindOrCreateCustomerAsync(conn, tx, access.BusinessId, b);
            var policy = await PolicyRepository.GetAsync(conn, access.BusinessId, tx);
            var disclose = input.ChargeTermsDisclosed && policy.DebtChargeEnabled && !string.IsNullOrWhiteSpace(policy.DebtChargeTerms);
            debtId = await conn.QuerySingleAsync<Guid>(
                """
                INSERT INTO receivables (business_id, customer_id, description, original_amount_cents, issue_date, due_date, booking_id, reference,
                    charge_terms_disclosed_at, charge_terms_snapshot, charge_policy_version, charge_amount_cents, charge_overdue_days)
                VALUES (@B, @C, @D, @A, @Today, @Due, @Bk, @Ref, @DiscAt, @Terms, @Ver, @Amt, @Days) RETURNING id
                """, new { B = access.BusinessId, C = customerId, D = Trunc($"Unpaid balance for booking {b.Reference}", 200), A = remaining, Today = today,
                    Due = input.DebtDueDate ?? today.AddDays(7), Bk = id, Ref = b.Reference, DiscAt = disclose ? DateTime.UtcNow : (DateTime?)null,
                    Terms = disclose ? policy.DebtChargeTerms : null, Ver = disclose ? policy.DebtChargePolicyVersion : (int?)null,
                    Amt = disclose ? policy.DebtChargeCents : (long?)null, Days = disclose ? policy.DebtChargeOverdueDays : (int?)null }, tx);
            await AuditRepository.WriteAsync(conn, tx, access.BusinessId, access.UserId, "debt_created_from_booking", "receivable", debtId, JsonSerializer.Serialize(new { chargeTermsDisclosed = disclose }));
        }
        await conn.ExecuteAsync("UPDATE bookings SET status = 'completed', completed_at = now(), updated_at = now(), customer_id = COALESCE(customer_id, (SELECT customer_id FROM receivables WHERE id = @Debt)) WHERE id = @Id",
            new { Id = id, Debt = debtId }, tx);
        await BookingEngine.EventAsync(conn, tx, access.BusinessId, id, "completed", b.Status, BookingStatuses.Completed, "staff", access.UserId,
            $"Paid now {Money.FormatZar(paidNow)}; still owed {Money.FormatZar(Math.Max(0, remaining))}{(debtId is null ? "" : " (recorded as a customer debt)")}. {input.Note}".Trim());
        await AuditRepository.WriteAsync(conn, tx, access.BusinessId, access.UserId, "booking_completed", "booking", id);
        await JobQueue.EnqueueGrowthRefreshAsync(conn, tx, access.BusinessId);
        tx.Commit();
        return await AfterAsync(conn, access, mine, id);
    }

    internal static async Task<Guid> FindOrCreateCustomerAsync(IDbConnection conn, IDbTransaction tx, Guid businessId, BookingRow b)
    {
        if (!string.IsNullOrWhiteSpace(b.CustomerPhone))
        {
            var existing = await conn.QueryFirstOrDefaultAsync<Guid?>("SELECT id FROM customers WHERE business_id = @B AND phone = @P AND NOT is_archived ORDER BY created_at LIMIT 1",
                new { B = businessId, P = b.CustomerPhone }, tx);
            if (existing is not null) return existing.Value;
        }
        return await conn.QuerySingleAsync<Guid>("INSERT INTO customers (business_id, name, phone, email) VALUES (@B, @N, @P, @E) RETURNING id",
            new { B = businessId, N = b.CustomerName, P = b.CustomerPhone, E = b.CustomerEmail }, tx);
    }

    public async Task<BookingDetailDto> UpdateHouseCallAsync(Guid id, HouseCallUpdateInput input, CancellationToken ct)
    {
        var e = new ValidationErrors();
        if (input.DistanceKm is < 0 or > 9999) e.Add("distanceKm", "Enter a valid distance.");
        if (input.EstimatedTravelCostCents is < 0 or > 10_000_000 || input.EstimatedOtherCostCents is < 0 or > 10_000_000) e.Add("estimated", "Enter valid estimates.");
        e.Optional("accessNotes", input.AccessNotes, 300);
        RequestValidationException.ThrowIfInvalid(e);
        await using var conn = await db.OpenAsync(ct);
        using var tx = conn.BeginTransaction();
        var (access, mine, b) = await ForChangeAsync(conn, tx, id);
        if (b.LocationType != "house_call") throw new ConflictException("This booking is not a house call.");
        await conn.ExecuteAsync(
            """
            UPDATE house_call_details SET distance_km = COALESCE(@Km, distance_km), distance_source = CASE WHEN @Km::numeric IS NULL THEN distance_source ELSE 'manual' END,
                estimated_travel_cost_cents = COALESCE(@T, estimated_travel_cost_cents), estimated_other_cost_cents = COALESCE(@O, estimated_other_cost_cents),
                access_notes = COALESCE(@N, access_notes), updated_at = now()
            WHERE booking_id = @Id AND business_id = @B
            """, new { Km = input.DistanceKm, T = input.EstimatedTravelCostCents, O = input.EstimatedOtherCostCents, N = Clean(input.AccessNotes), Id = id, B = access.BusinessId }, tx);
        await AuditRepository.WriteAsync(conn, tx, access.BusinessId, access.UserId, "house_call_updated", "booking", id);
        tx.Commit();
        return await AfterAsync(conn, access, mine, id);
    }

    /// <summary>Records an actual trip cost (transport, parking, supplies) as a business expense linked to the visit.</summary>
    public async Task<BookingDetailDto> AddVisitExpenseAsync(Guid id, VisitExpenseInput input, CancellationToken ct)
    {
        var e = new ValidationErrors();
        if (input.Category is null || !Categories.Expense.Contains(input.Category)) e.Add("category", "Choose an expense category.");
        e.PositiveCents("amountCents", input.AmountCents);
        e.Required("description", input.Description, 1, 200);
        if (input.PaymentMethod is null || !PaymentMethods.All.Contains(input.PaymentMethod)) e.Add("paymentMethod", "Choose how it was paid.");
        if (input.Date is { } d && d > clock.Today) e.Add("date", "The date cannot be in the future.");
        RequestValidationException.ThrowIfInvalid(e);
        await using var conn = await db.OpenAsync(ct);
        using var tx = conn.BeginTransaction();
        var (access, mine, b) = await ForChangeAsync(conn, tx, id);
        if (!access.Can(Permission.RecordExpenses) && !access.Can(Permission.ManageFinancials) && b.StaffId != mine)
            throw new ForbiddenException("Your role cannot record expenses.");
        var txId = await LedgerRepository.InsertAsync(conn, tx, access.BusinessId, access.UserId, TransactionTypes.Expense, input.Description!.Trim(), input.AmountCents!.Value,
            input.Category!, input.Date ?? clock.Today, input.PaymentMethod!, PaymentStatuses.RecordedManually, TransactionStatuses.Posted, TransactionSources.Manual,
            b.Reference, b.LocationType == "house_call" ? "House-call cost" : "Visit cost", Core.Integrations.RecordOrigins.StaffRecorded, b.BranchId);
        await conn.ExecuteAsync("UPDATE transactions SET booking_id = @Bk WHERE id = @T", new { Bk = id, T = txId }, tx);
        await AuditRepository.WriteAsync(conn, tx, access.BusinessId, access.UserId, "visit_expense_recorded", "booking", id);
        await JobQueue.EnqueueGrowthRefreshAsync(conn, tx, access.BusinessId);
        tx.Commit();
        return await AfterAsync(conn, access, mine, id);
    }

    public sealed record HouseCallListItemDto(BookingSummaryDto Booking, string? Town, string DistanceLabel, HouseCallEconomicsDto Economics);

    public async Task<IReadOnlyList<HouseCallListItemDto>> HouseCallsAsync(DateOnly? from, DateOnly? to, CancellationToken ct)
    {
        // The house-call overview is about the shop's margins, so it is for front desk, managers and owners only.
        var access = await business.RequireAsync(Permission.ViewBookings, Permission.ManageBookings);
        await using var conn = await db.OpenAsync(ct);
        var list = await ListAsync(from ?? clock.Today.AddDays(-30), to ?? clock.Today.AddDays(30), null, null, "house_call", ct);
        var result = new List<HouseCallListItemDto>();
        foreach (var s in list)
        {
            var b = (await BookingEngine.GetAsync(conn, access.BusinessId, s.Id))!;
            var hc = await HouseCallAsync(conn, b, false);
            if (hc?.Economics is { } econ) result.Add(new HouseCallListItemDto(s, hc.Town, hc.DistanceLabel, econ));
        }
        return result;
    }

    private static string? Clean(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();
    private static string Trunc(string s, int n) => s.Length <= n ? s : s[..n];
}
