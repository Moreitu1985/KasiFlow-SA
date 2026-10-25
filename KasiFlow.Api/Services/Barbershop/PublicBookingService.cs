using System.Data;
using Dapper;
using KasiFlow.Api.Data;
using KasiFlow.Api.DTOs;
using KasiFlow.Api.Middleware;
using KasiFlow.Api.Repositories;
using KasiFlow.Core.Bookings;
using KasiFlow.Core.Common;
using KasiFlow.Core.Validation;
using KasiFlow.Api.Services;

namespace KasiFlow.Api.Services.Barbershop;

/// <summary>
/// Anonymous, rate-limited booking from a published business profile. Customers see services, prices, barbers' public
/// status labels and free times — never other customers' bookings, addresses or the business's internal data. A booking
/// is managed afterwards with its reference plus a secret token that is shown once.
/// </summary>
public sealed class PublicBookingService(IDbConnectionFactory db, BookingService bookings, BookingEngine engine, IClock clock, ICurrentUser user)
{
    private sealed class Biz
    {
        public Guid BusinessId { get; set; }
        public string Name { get; set; } = "";
        public string Slug { get; set; } = "";
    }

    internal sealed class PhotoBlob
    {
        public byte[] Data { get; set; } = [];
        public string ContentType { get; set; } = "";
    }

    private sealed class SvcRow
    {
        public Guid Id { get; set; }
        public string Name { get; set; } = "";
        public string? Description { get; set; }
        public string? Category { get; set; }
        public long PriceCents { get; set; }
        public int DurationMinutes { get; set; }
        public bool AllowsHouseCall { get; set; }
    }

    private static async Task<Biz> BusinessAsync(IDbConnection conn, string slug)
    {
        slug = (slug ?? "").Trim().ToLowerInvariant();
        if (!Slug.IsValid(slug)) throw new NotFoundException("Business not found.");
        return await conn.QueryFirstOrDefaultAsync<Biz>(
            "SELECT p.business_id, b.name, p.slug FROM public_profiles p JOIN businesses b ON b.id = p.business_id WHERE p.slug = @S AND p.is_published",
            new { S = slug }) ?? throw new NotFoundException("Business not found.");
    }

    public async Task<PublicBookingInfoDto> InfoAsync(string slug, CancellationToken ct)
    {
        await using var conn = await db.OpenAsync(ct);
        var biz = await BusinessAsync(conn, slug);
        var policy = await PolicyRepository.GetAsync(conn, biz.BusinessId);
        var services = (await conn.QueryAsync<SvcRow>(
            "SELECT id, name, description, category, price_cents, duration_minutes, allows_house_call FROM services WHERE business_id = @B AND is_active AND is_public ORDER BY sort_order, name",
            new { B = biz.BusinessId })).Select(r => new PublicServiceDto(r.Id, r.Name, r.Description, r.Category, r.PriceCents, r.DurationMinutes, r.AllowsHouseCall)).ToList();
        var now = clock.UtcNow;
        var staff = (await TeamRepository.ListAsync(conn, biz.BusinessId)).Where(s => s.IsActive && s.IsBookable).ToList();
        var sched = await TeamRepository.SchedulesAsync(conn, biz.BusinessId, staff, now.AddDays(-1), now.AddDays(1));
        var offers = (await conn.QueryAsync<(Guid StaffId, Guid ServiceId, long? Price)>(
            "SELECT ss.staff_id, ss.service_id, ss.price_cents FROM staff_services ss JOIN services v ON v.id = ss.service_id WHERE ss.business_id = @B AND v.is_active AND v.is_public",
            new { B = biz.BusinessId })).ToLookup(x => x.StaffId);
        var photos = (await conn.QueryAsync<(Guid Id, Guid StaffId, string? Caption, Guid? ServiceId)>(
            """
            SELECT id, staff_id, caption, service_id FROM staff_portfolio_photos
            WHERE business_id = @B AND is_public ORDER BY sort_order, created_at DESC
            """, new { B = biz.BusinessId })).ToLookup(x => x.StaffId);
        var listPrice = services.ToDictionary(x => x.Id, x => x.PriceCents);
        var publicStaff = staff.Select(s =>
        {
            var eff = sched[s.Id].Effective(now);
            // Customers only see a simple label; notes and history stay internal. "Busy"-type statuses are never shown as available.
            var label = eff.Stale ? "Status not confirmed" : StaffStatuses.Label(eff.Status);
            // A barber with no assigned services offers the whole public catalogue at list prices.
            var mine = offers[s.Id].Where(o => listPrice.ContainsKey(o.ServiceId)).ToList();
            var prices = mine.Count > 0
                ? mine.Select(o => new PublicStaffPriceDto(o.ServiceId, o.Price ?? listPrice[o.ServiceId])).ToList()
                : services.Select(x => new PublicStaffPriceDto(x.Id, x.PriceCents)).ToList();
            var gallery = photos[s.Id].Take(24).Select(p => new PublicPhotoDto(p.Id, p.Caption, p.ServiceId, $"/api/public/profiles/{biz.Slug}/photos/{p.Id}")).ToList();
            return new PublicStaffDto(s.Id, s.DisplayName, s.RoleTitle, label, StaffAvailability.AvailableNow(eff, now, sched[s.Id].Hours), s.AcceptsHouseCalls,
                s.Bio, s.Specialties, prices, gallery);
        }).ToList();
        return new PublicBookingInfoDto(biz.Slug, biz.Name, services, publicStaff, policy.HouseCallsEnabled, policy.TravelFeeDescription, !policy.BookingAutoConfirm,
            policy.BookingHorizonDays,
            "Choosing a time sends a request. The business confirms it (or proposes another time). Prices are the business's own listed prices.",
            true, true, CustomerReadiness.Terms);
    }

    public async Task<AvailabilityDto> AvailabilityAsync(string slug, DateOnly date, string? serviceIds, Guid? staffId, string? locationType, CancellationToken ct)
    {
        var ids = (serviceIds ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(x => Guid.TryParse(x, out var g) ? g : Guid.Empty).ToList();
        if (ids.Count == 0 || ids.Count > 20 || ids.Contains(Guid.Empty)) throw new RequestValidationException(new ValidationErrors().Add("serviceIds", "Choose at least one service."));
        await using var conn = await db.OpenAsync(ct);
        var biz = await BusinessAsync(conn, slug);
        return await bookings.AvailabilityInternalAsync(conn, biz.BusinessId, date, ids, staffId, locationType, true);
    }

    /// <summary>Booking from the public page requires a customer signed in with a one-time code (verified email or phone).
    /// House calls additionally need a complete customer account and are refused for accounts the business has blocked.</summary>
    public async Task<PublicBookingCreatedDto> CreateAsync(string slug, PublicBookingInput input, CancellationToken ct)
    {
        var verified = CustomerAccountService.VerifiedContact(user)
                       ?? throw new ForbiddenException("Sign in with a one-time code sent to your email or phone before booking.");
        var userId = user.UserId;
        await using var conn = await db.OpenAsync(ct);
        var biz = await BusinessAsync(conn, slug);
        var account = await CustomerAccountService.EnsureAsync(conn, user);
        var loc = input.LocationType ?? "in_shop";
        var name = string.IsNullOrWhiteSpace(input.CustomerName) ? account.FullName : input.CustomerName.Trim();
        var phone = string.IsNullOrWhiteSpace(input.CustomerPhone) ? account.ContactPhone : input.CustomerPhone.Trim();
        var hc = input.HouseCall;
        if (loc == "house_call")
        {
            var missing = CustomerReadiness.MissingForHouseCall(CustomerAccountService.Profile(account, verified));
            if (missing.Count > 0)
                throw new RequestValidationException(new ValidationErrors().Add("account", "House calls need a complete customer account: " + string.Join("; ", missing) + "."));
            if (await conn.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM customer_house_call_blocks WHERE business_id = @B AND customer_user_id = @U AND lifted_at IS NULL",
                    new { B = biz.BusinessId, U = userId }) > 0)
                throw new ForbiddenException("This business is not taking house-call bookings for your account. You can still book a visit at the shop.");
            name = account.FullName;
            phone = account.ContactPhone;
            // The address on the account is used unless the customer gives the visit address for this booking.
            hc = string.IsNullOrWhiteSpace(hc?.AddressLine)
                ? new HouseCallInput(account.AddressLine, account.Suburb, account.Town, hc?.AccessNotes ?? account.AccessNotes, null, null, null)
                : hc with { DistanceKm = null };
        }
        var (row, token) = await bookings.CreateInternalAsync(conn, biz.BusinessId,
            new BookingInput(input.StaffId, input.StartsAt, input.Items, loc, hc, name, phone, user.Email, null, input.CustomerNote, null, null),
            "public", null, false, false, true, userId, verified);
        // Remember the name and phone for next time (only fills empty fields; the customer edits them in their account).
        await conn.ExecuteAsync(
            "UPDATE customer_accounts SET full_name = COALESCE(full_name, @N), contact_phone = COALESCE(contact_phone, @P), updated_at = now() WHERE user_id = @U",
            new { N = name?.Trim() is { Length: >= 2 } n ? n : null, P = phone, U = userId });
        return new PublicBookingCreatedDto(row.Reference, token!, $"/p/{biz.Slug}/booking/{row.Reference}?t={token}", await StatusDtoAsync(conn, biz.Name, row));
    }

    /// <summary>Serves a public portfolio photo: only when the profile is published, the photo is public and the barber is active.</summary>
    public async Task<(byte[] Content, string ContentType)> PhotoAsync(string slug, Guid id, CancellationToken ct)
    {
        await using var conn = await db.OpenAsync(ct);
        var biz = await BusinessAsync(conn, slug);
        var row = await conn.QueryFirstOrDefaultAsync<PhotoBlob>(
            """
            SELECT p.data, p.content_type FROM staff_portfolio_photos p JOIN staff_profiles s ON s.id = p.staff_id AND s.business_id = p.business_id
            WHERE p.id = @Id AND p.business_id = @B AND p.is_public AND s.is_active AND s.is_bookable
            """, new { Id = id, B = biz.BusinessId });
        return row is { } r ? (r.Data, r.ContentType) : throw new NotFoundException();
    }

    private static async Task<(Biz Biz, BookingRow Row)> ByTokenAsync(IDbConnection conn, string reference, string? token, IDbTransaction? tx = null, bool forUpdate = false,
        Guid? ownerUserId = null)
    {
        reference = (reference ?? "").Trim().ToUpperInvariant();
        var row = await conn.QueryFirstOrDefaultAsync<BookingRow>($"{BookingEngine.Select} WHERE b.reference = @R{(forUpdate ? " FOR UPDATE OF b" : "")}", new { R = reference }, tx);
        // Same answer for "no such booking", "wrong token" and "not your booking", so references cannot be probed.
        if (row is null || !(ownerUserId is { } o ? row.CustomerUserId == o : BookingEngine.TokenMatches(row.StatusTokenHash, token)))
            throw new NotFoundException("Booking not found. Check the link you were given.");
        var biz = await conn.QuerySingleAsync<Biz>("SELECT b.id AS business_id, b.name, COALESCE(p.slug, '') AS slug FROM businesses b LEFT JOIN public_profiles p ON p.business_id = b.id WHERE b.id = @B",
            new { B = row.BusinessId }, tx);
        return (biz, row);
    }

    private static async Task<PublicBookingStatusDto> StatusDtoAsync(IDbConnection conn, string businessName, BookingRow b)
    {
        var services = (await conn.QueryAsync<string>("SELECT person_label || ': ' || service_name FROM booking_items WHERE booking_id = @Id ORDER BY person_label, service_name", new { Id = b.Id })).ToList();
        var actions = new List<string>();
        if (b.Status is BookingStatuses.Requested or BookingStatuses.Confirmed) { actions.Add("cancel"); actions.Add("reschedule"); }
        if (b.Status == BookingStatuses.RescheduleProposed)
        {
            actions.Add("cancel");
            if (b.ProposedBy == "business") { actions.Add("accept-proposal"); actions.Add("reject-proposal"); }
        }
        var message = b.Status switch
        {
            BookingStatuses.Requested => "Your request was sent. It is not confirmed until the business confirms it.",
            BookingStatuses.Confirmed => "Your booking is confirmed.",
            BookingStatuses.RescheduleProposed when b.ProposedBy == "business" => "The business proposed a different time" + (b.ProposedTravelFeeCents is not null ? " and travel fee" : "") + ". Accept or decline below.",
            BookingStatuses.RescheduleProposed => "You asked for a different time. The business will confirm or decline.",
            BookingStatuses.Completed => "This visit is complete. Thank you!",
            BookingStatuses.Cancelled => "This booking was cancelled.",
            _ => "This booking was marked as missed."
        };
        return new PublicBookingStatusDto(b.Reference, businessName, b.Status, BookingStatuses.Label(b.Status), TeamRepository.Utc(b.StartsAt), TeamRepository.Utc(b.EndsAt),
            b.StaffName, b.LocationType, services, b.ServicesTotalCents, b.TravelFeeCents, b.TotalCents, TeamRepository.Utc(b.ProposedStartsAt),
            b.ProposedTravelFeeCents, b.ProposedBy, b.ProposalNote, actions, message,
            (await conn.QueryAsync<Guid>("SELECT DISTINCT service_id FROM booking_items WHERE booking_id = @Id AND service_id IS NOT NULL", new { Id = b.Id })).ToList(), b.StaffId);
    }

    public async Task<PublicBookingStatusDto> StatusAsync(string reference, string? token, CancellationToken ct, Guid? ownerUserId = null)
    {
        await using var conn = await db.OpenAsync(ct);
        var (biz, row) = await ByTokenAsync(conn, reference, token, ownerUserId: ownerUserId);
        return await StatusDtoAsync(conn, biz.Name, row);
    }

    public async Task<PublicBookingStatusDto> ActAsync(string reference, string action, PublicActionInput input, CancellationToken ct, Guid? ownerUserId = null)
    {
        if (input.Note is { Length: > 300 }) throw new RequestValidationException(new ValidationErrors().Add("note", "Use 300 characters or fewer."));
        await using var conn = await db.OpenAsync(ct);
        using var tx = conn.BeginTransaction();
        var (biz, b) = await ByTokenAsync(conn, reference, input.Token, tx, forUpdate: true, ownerUserId: ownerUserId);
        var note = string.IsNullOrWhiteSpace(input.Note) ? null : input.Note.Trim();
        switch (action)
        {
            case "cancel":
            {
                var to = BookingStateMachine.Next(b.Status, BookingActions.Cancel) ?? throw new ConflictException("This booking can no longer be cancelled.");
                await conn.ExecuteAsync("UPDATE bookings SET status = @To, cancel_reason = @R, updated_at = now() WHERE id = @Id", new { To = to, R = note ?? "Cancelled by the customer", Id = b.Id }, tx);
                await BookingEngine.EventAsync(conn, tx, b.BusinessId, b.Id, "cancelled", b.Status, to, "customer", null, note);
                await BookingEngine.NotifyAsync(conn, tx, b, "Customer cancelled a booking", $"{b.CustomerName} cancelled {b.Reference}.", $"booking:cancel:{b.Id}", "warning");
                break;
            }
            case "reschedule":
            {
                if (input.StartsAt is null) throw new RequestValidationException(new ValidationErrors().Add("startsAt", "Choose the new time."));
                if (BookingStateMachine.Next(b.Status, BookingActions.ProposeReschedule) is null || b.Status == BookingStatuses.RescheduleProposed)
                    throw new ConflictException("This booking cannot be rescheduled now.");
                var policy = await PolicyRepository.GetAsync(conn, b.BusinessId, tx);
                var start = input.StartsAt.Value;
                var end = start.AddMinutes((TeamRepository.Utc(b.EndsAt) - TeamRepository.Utc(b.StartsAt)).TotalMinutes);
                var serviceIds = (await conn.QueryAsync<Guid>("SELECT service_id FROM booking_items WHERE booking_id = @Id AND service_id IS NOT NULL", new { Id = b.Id }, tx)).Distinct().ToList();
                var (staff, why) = await engine.ChooseStaffAsync(conn, tx, b.BusinessId, b.StaffId, start, end, b.LocationType, serviceIds, policy, b.Id);
                if (staff is null) throw new ConflictException(why ?? "That time is not available.");
                await conn.ExecuteAsync(
                    "UPDATE bookings SET status = 'reschedule_proposed', proposed_starts_at = @S, proposed_ends_at = @E, proposed_staff_id = @Staff, proposed_by = 'customer', proposal_note = @N, updated_at = now() WHERE id = @Id",
                    new { S = start.UtcDateTime, E = end.UtcDateTime, Staff = staff.Id, N = note, Id = b.Id }, tx);
                await BookingEngine.EventAsync(conn, tx, b.BusinessId, b.Id, "reschedule_requested", b.Status, BookingStatuses.RescheduleProposed, "customer", null,
                    $"Asked for {start.ToOffset(StaffAvailability.SaOffset):ddd d MMM HH:mm}. {note}".Trim());
                await BookingEngine.NotifyAsync(conn, tx, b, "Customer asked to reschedule", $"{b.CustomerName} asked to move {b.Reference} to {start.ToOffset(StaffAvailability.SaOffset):ddd d MMM HH:mm}.", $"booking:resched:{b.Id}:{start:yyyyMMddHHmm}");
                break;
            }
            case "accept-proposal":
            {
                if (b.Status != BookingStatuses.RescheduleProposed || b.ProposedBy != "business") throw new ConflictException("There is no proposal to accept.");
                var policy = await PolicyRepository.GetAsync(conn, b.BusinessId, tx);
                await engine.ConfirmAsync(conn, tx, b, TeamRepository.Utc(b.ProposedStartsAt)!.Value, TeamRepository.Utc(b.ProposedEndsAt)!.Value, b.ProposedStaffId ?? b.StaffId,
                    b.ProposedTravelFeeCents ?? b.TravelFeeCents, policy, "customer", null, false, false, null);
                await BookingEngine.NotifyAsync(conn, tx, b, "Customer accepted the new time", $"{b.CustomerName} accepted the proposal for {b.Reference}. It is now confirmed.", $"booking:accept:{b.Id}:{DateTime.UtcNow:yyyyMMddHHmm}");
                break;
            }
            case "reject-proposal":
            {
                if (b.Status != BookingStatuses.RescheduleProposed || b.ProposedBy != "business") throw new ConflictException("There is no proposal to decline.");
                var to = BookingStateMachine.Next(b.Status, BookingActions.RejectProposal, "business")!;
                await conn.ExecuteAsync("UPDATE bookings SET status = @To, proposed_starts_at = NULL, proposed_ends_at = NULL, proposed_staff_id = NULL, proposed_travel_fee_cents = NULL, proposed_by = NULL, proposal_note = NULL, updated_at = now() WHERE id = @Id",
                    new { To = to, Id = b.Id }, tx);
                await BookingEngine.EventAsync(conn, tx, b.BusinessId, b.Id, "proposal_declined", b.Status, to, "customer", null, note);
                await BookingEngine.NotifyAsync(conn, tx, b, "Customer declined the proposed time", $"{b.CustomerName} declined the proposal for {b.Reference}.", $"booking:decline:{b.Id}:{DateTime.UtcNow:yyyyMMddHHmm}");
                break;
            }
            default:
                throw new NotFoundException();
        }
        tx.Commit();
        var fresh = (await BookingEngine.GetAsync(conn, b.BusinessId, b.Id))!;
        return await StatusDtoAsync(conn, biz.Name, fresh);
    }
}
