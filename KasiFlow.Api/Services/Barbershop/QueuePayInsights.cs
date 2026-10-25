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
using KasiFlow.Core.Domain;
using KasiFlow.Core.Validation;

namespace KasiFlow.Api.Services.Barbershop;

// ============================================================================================ walk-in queue

public sealed record QueueTicketDto(Guid Id, int Number, string CustomerName, string Status, string StatusLabel, string ServicesSummary, int EstMinutes,
    Guid? PreferredStaffId, string? PreferredStaffName, Guid? StaffId, string? StaffName, DateTimeOffset JoinedAt, DateTimeOffset? CalledAt,
    DateTimeOffset? StartedAt, DateTimeOffset? FinishedAt, int? Position, string? WaitLabel, int WaitedMinutes, string Source, Guid? BookingId,
    IReadOnlyList<string> AllowedActions);

public sealed record QueueBoardDto(DateOnly Date, bool Enabled, int Waiting, int InChair, int DoneToday, int BarbersWorking, string NextWaitLabel,
    int? AverageWaitMinutes, IReadOnlyList<QueueTicketDto> Open, IReadOnlyList<QueueTicketDto> Finished);

public sealed record QueueJoinInput(string? CustomerName, string? CustomerPhone, IReadOnlyList<Guid>? ServiceIds, Guid? PreferredStaffId);

public sealed record QueueActionInput(Guid? StaffId, IReadOnlyList<CompletionPaymentInput>? Payments, string? Note);

public sealed record PublicQueueDto(string Slug, string BusinessName, bool Enabled, int Waiting, int BarbersWorking, string NextWaitLabel);

public sealed record PublicTicketDto(Guid Id, int Number, string BusinessName, string Status, string StatusLabel, int? Position, string? WaitLabel,
    string? StaffName, string ServicesSummary, string Message);

public sealed record PublicTicketCreatedDto(Guid Id, int Number, string Token, string StatusPath, PublicTicketDto Ticket);

/// <summary>
/// Walk-in queue. Customers join from the shop's QR code (signed in with a one-time code) or the front desk adds them;
/// barbers call the next person, start and finish. A finished ticket becomes a completed booking (source "walkin"),
/// so payments, insights and barber pay all see it. Waits are estimates, never promises.
/// </summary>
public sealed class QueueService(IDbConnectionFactory db, IBusinessContext business, ICurrentUser user, IClock clock)
{
    private sealed class Row
    {
        public Guid Id { get; set; }
        public Guid BusinessId { get; set; }
        public Guid? BranchId { get; set; }
        public int Number { get; set; }
        public string CustomerName { get; set; } = "";
        public string? CustomerPhone { get; set; }
        public Guid? CustomerUserId { get; set; }
        public Guid[] ServiceIds { get; set; } = [];
        public string ServicesSummary { get; set; } = "";
        public int EstMinutes { get; set; }
        public Guid? PreferredStaffId { get; set; }
        public string? PreferredStaffName { get; set; }
        public Guid? StaffId { get; set; }
        public string? StaffName { get; set; }
        public Guid? StaffUserId { get; set; }
        public string Status { get; set; } = "";
        public DateTime JoinedAt { get; set; }
        public DateTime? CalledAt { get; set; }
        public DateTime? StartedAt { get; set; }
        public DateTime? FinishedAt { get; set; }
        public Guid? BookingId { get; set; }
        public string? TokenHash { get; set; }
        public string Source { get; set; } = "";
    }

    private sealed class QueueSettings
    {
        public bool QueueEnabled { get; set; }
        public int QueueMaxWaiting { get; set; }
    }

    private const string Select = """
        SELECT t.id, t.business_id, t.branch_id, t.number, t.customer_name, t.customer_phone, t.customer_user_id, t.service_ids, t.services_summary,
               t.est_minutes, t.preferred_staff_id, ps.display_name AS preferred_staff_name, t.staff_id, s.display_name AS staff_name, s.user_id AS staff_user_id,
               t.status, t.joined_at, t.called_at, t.started_at, t.finished_at, t.booking_id, t.token_hash, t.source
        FROM walkin_tickets t
        LEFT JOIN staff_profiles s ON s.id = t.staff_id
        LEFT JOIN staff_profiles ps ON ps.id = t.preferred_staff_id
        """;

    private static DateTimeOffset U(DateTime d) => TeamRepository.Utc(d);

    private async Task<(AccessContext Access, Guid? Mine)> AccessAsync(IDbConnection conn)
    {
        var access = await business.RequireAsync(Permission.ManageBookings, Permission.WorkOwnBookings);
        var mine = (await TeamRepository.ForUserAsync(conn, access.BusinessId, access.UserId))?.Id;
        return (access, mine);
    }

    private static async Task<List<Row>> TodayAsync(IDbConnection conn, Guid businessId, DateOnly day, IDbTransaction? tx = null) =>
        (await conn.QueryAsync<Row>($"{Select} WHERE t.business_id = @B AND t.ticket_date = @D ORDER BY t.number", new { B = businessId, D = day }, tx)).ToList();

    /// <summary>Barbers who can take the next walk-in: active, bookable, and in the shop now (available, busy or called in).</summary>
    private async Task<int> BarbersWorkingAsync(IDbConnection conn, Guid businessId)
    {
        var now = clock.UtcNow;
        var staff = (await TeamRepository.ListAsync(conn, businessId)).Where(s => s.IsActive && s.IsBookable).ToList();
        var sched = await TeamRepository.SchedulesAsync(conn, businessId, staff, now.AddDays(-1), now.AddDays(1));
        return staff.Count(s =>
        {
            var e = sched[s.Id].Effective(now);
            return !e.Stale && e.Status is StaffStatuses.Available or StaffStatuses.Busy;
        });
    }

    private static List<int> InChairRemaining(IEnumerable<Row> rows, DateTimeOffset now) =>
        rows.Where(r => r.Status == QueueStatuses.InChair)
            .Select(r => Math.Max(0, r.EstMinutes - (int)(now - U(r.StartedAt ?? r.JoinedAt)).TotalMinutes)).ToList();

    private QueueTicketDto ToDto(Row r, IReadOnlyList<Row> all, int barbers, DateTimeOffset now, AccessContext? access, Guid? mine, bool showPhone)
    {
        int? position = null;
        string? wait = null;
        if (r.Status == QueueStatuses.Waiting)
        {
            var ahead = all.Where(x => x.Status == QueueStatuses.Waiting && x.Number < r.Number).ToList();
            position = ahead.Count + 1;
            wait = QueueEstimator.ForNext(ahead.Select(a => a.EstMinutes).ToList(), InChairRemaining(all, now), barbers).Label;
        }
        var actions = new List<string>();
        if (access is not null)
        {
            var desk = access.Can(Permission.ManageBookings);
            var mineTicket = mine is not null && (r.StaffId is null || r.StaffId == mine);
            foreach (var a in new[] { "call", "start", "requeue", "done", "left", "no_show" })
                if (QueueStatuses.Next(r.Status, a) is not null && (desk || (mineTicket && a is not ("left"))))
                    actions.Add(a);
        }
        var waited = (int)((U(r.StartedAt ?? r.FinishedAt ?? now.UtcDateTime) - U(r.JoinedAt)).TotalMinutes);
        return new QueueTicketDto(r.Id, r.Number, showPhone ? r.CustomerName : FirstName(r.CustomerName), r.Status, QueueStatuses.Label(r.Status), r.ServicesSummary,
            r.EstMinutes, r.PreferredStaffId, r.PreferredStaffName, r.StaffId, r.StaffName, U(r.JoinedAt), r.CalledAt is { } c ? U(c) : null,
            r.StartedAt is { } s ? U(s) : null, r.FinishedAt is { } f ? U(f) : null, position, wait, Math.Max(0, waited), r.Source, r.BookingId, actions);
    }

    private static string FirstName(string name)
    {
        // "Thabo N. (fictional)" -> "Thabo N.": ignore bracketed notes, keep the first name and the last name's initial.
        var parts = name.Trim().Split(' ', StringSplitOptions.RemoveEmptyEntries).Where(p => !p.StartsWith('(') && char.IsLetter(p[0])).ToList();
        return parts.Count switch { 0 => name, 1 => parts[0], _ => $"{parts[0]} {char.ToUpperInvariant(parts[^1][0])}." };
    }

    public async Task<QueueBoardDto> BoardAsync(CancellationToken ct)
    {
        await using var conn = await db.OpenAsync(ct);
        var (access, mine) = await AccessAsync(conn);
        return await BoardAsync(conn, access, mine);
    }

    private async Task<QueueBoardDto> BoardAsync(IDbConnection conn, AccessContext access, Guid? mine)
    {
        var today = clock.Today;
        var now = clock.UtcNow;
        var rows = await TodayAsync(conn, access.BusinessId, today);
        var barbers = await BarbersWorkingAsync(conn, access.BusinessId);
        var enabled = await conn.ExecuteScalarAsync<bool?>("SELECT queue_enabled FROM business_settings WHERE business_id = @B", new { B = access.BusinessId }) ?? true;
        var desk = access.Can(Permission.ManageBookings);
        var open = rows.Where(r => QueueStatuses.Open.Contains(r.Status)).Select(r => ToDto(r, rows, barbers, now, access, mine, desk)).ToList();
        var finished = rows.Where(r => !QueueStatuses.Open.Contains(r.Status)).OrderByDescending(r => r.FinishedAt ?? r.JoinedAt)
            .Select(r => ToDto(r, rows, barbers, now, access, mine, desk)).Take(30).ToList();
        var waits = rows.Where(r => r.StartedAt is not null).Select(r => (U(r.StartedAt!.Value) - U(r.JoinedAt)).TotalMinutes).ToList();
        var next = QueueEstimator.ForNext(rows.Where(r => r.Status == QueueStatuses.Waiting).Select(r => r.EstMinutes).ToList(), InChairRemaining(rows, now), barbers);
        return new QueueBoardDto(today, enabled, rows.Count(r => r.Status == QueueStatuses.Waiting), rows.Count(r => r.Status == QueueStatuses.InChair),
            rows.Count(r => r.Status == QueueStatuses.Done), barbers, next.Label, waits.Count > 0 ? (int)Math.Round(waits.Average()) : null, open, finished);
    }

    private static async Task<(IReadOnlyList<Guid> Ids, string Summary, int Minutes)> ServicesAsync(IDbConnection conn, Guid businessId, IReadOnlyList<Guid>? ids, IDbTransaction? tx = null)
    {
        var list = (ids ?? []).Distinct().ToList();
        if (list.Count > 6) throw new RequestValidationException(new ValidationErrors().Add("serviceIds", "Choose up to 6 services."));
        if (list.Count == 0) return ([], "Haircut (to be confirmed)", 30);
        var rows = (await conn.QueryAsync<(Guid Id, string Name, int Dur)>(
            "SELECT id, name, duration_minutes FROM services WHERE business_id = @B AND is_active AND id = ANY(@Ids)", new { B = businessId, Ids = list.ToArray() }, tx)).ToList();
        if (rows.Count != list.Count) throw new RequestValidationException(new ValidationErrors().Add("serviceIds", "Choose services from this shop's list."));
        return (list, string.Join(", ", rows.Select(r => r.Name)), Math.Clamp(rows.Sum(r => r.Dur), 5, 480));
    }

    private static async Task<int> NextNumberAsync(IDbConnection conn, IDbTransaction tx, Guid businessId, DateOnly day)
    {
        await conn.ExecuteAsync("SELECT pg_advisory_xact_lock(hashtext(@K))", new { K = $"queue:{businessId}:{day:yyyyMMdd}" }, tx);
        return await conn.ExecuteScalarAsync<int>("SELECT COALESCE(MAX(number), 0) + 1 FROM walkin_tickets WHERE business_id = @B AND ticket_date = @D", new { B = businessId, D = day }, tx);
    }

    private static async Task CheckCapacityAsync(IDbConnection conn, IDbTransaction tx, Guid businessId, DateOnly day)
    {
        var s = await conn.QueryFirstOrDefaultAsync<QueueSettings>("SELECT queue_enabled, queue_max_waiting FROM business_settings WHERE business_id = @B", new { B = businessId }, tx);
        if (s is { QueueEnabled: false }) throw new ConflictException("This shop isn't taking walk-ins through the queue right now.");
        var waiting = await conn.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM walkin_tickets WHERE business_id = @B AND ticket_date = @D AND status IN ('waiting','called')", new { B = businessId, D = day }, tx);
        if (waiting >= (s?.QueueMaxWaiting ?? 30)) throw new ConflictException("The queue is full right now. Please try again a bit later.");
    }

    /// <summary>Front desk adds a walk-in (name only is fine).</summary>
    public async Task<QueueBoardDto> AddAsync(QueueJoinInput input, CancellationToken ct)
    {
        var e = new ValidationErrors();
        e.Required("customerName", input.CustomerName, 1, 80);
        e.Phone("customerPhone", input.CustomerPhone);
        RequestValidationException.ThrowIfInvalid(e);
        await using var conn = await db.OpenAsync(ct);
        var access = await business.RequireAsync(Permission.ManageBookings);
        using var tx = conn.BeginTransaction();
        var day = clock.Today;
        await CheckCapacityAsync(conn, tx, access.BusinessId, day);
        var (ids, summary, minutes) = await ServicesAsync(conn, access.BusinessId, input.ServiceIds, tx);
        if (input.PreferredStaffId is { } p && await TeamRepository.GetAsync(conn, access.BusinessId, p, tx) is null) throw new RequestValidationException(new ValidationErrors().Add("preferredStaffId", "Choose one of your barbers."));
        var number = await NextNumberAsync(conn, tx, access.BusinessId, day);
        await conn.ExecuteAsync(
            """
            INSERT INTO walkin_tickets (business_id, branch_id, ticket_date, number, customer_name, customer_phone, service_ids, services_summary, est_minutes, preferred_staff_id, source, created_by)
            VALUES (@B, (SELECT id FROM branches WHERE business_id = @B AND is_active ORDER BY created_at LIMIT 1), @D, @N, @Name, @Phone, @Ids, @Sum, @Min, @Pref, 'desk', @U)
            """, new { B = access.BusinessId, D = day, N = number, Name = input.CustomerName!.Trim(), Phone = TeamService.Clean(input.CustomerPhone), Ids = ids.ToArray(), Sum = summary,
                Min = minutes, Pref = input.PreferredStaffId, U = access.UserId }, tx);
        tx.Commit();
        var mine = (await TeamRepository.ForUserAsync(conn, access.BusinessId, access.UserId))?.Id;
        return await BoardAsync(conn, access, mine);
    }

    public async Task<QueueBoardDto> ActAsync(Guid id, string action, QueueActionInput input, CancellationToken ct)
    {
        await using var conn = await db.OpenAsync(ct);
        var (access, mine) = await AccessAsync(conn);
        using var tx = conn.BeginTransaction();
        var r = await conn.QueryFirstOrDefaultAsync<Row>($"{Select} WHERE t.id = @Id AND t.business_id = @B FOR UPDATE OF t", new { Id = id, B = access.BusinessId }, tx)
                ?? throw new NotFoundException();
        var to = QueueStatuses.Next(r.Status, action) ?? throw new ConflictException($"A ticket that is \"{QueueStatuses.Label(r.Status)}\" can't do that.");
        var desk = access.Can(Permission.ManageBookings);
        // Barbers act on unassigned tickets (claiming them) or their own; only the desk removes people from the queue.
        if (!desk && (mine is null || (r.StaffId is not null && r.StaffId != mine) || action == "left"))
            throw new ForbiddenException("Only the front desk can do that for another barber's customer.");
        Guid? staff = r.StaffId;
        if (action is "call" or "start")
        {
            staff = desk && input.StaffId is { } chosen ? chosen : staff ?? mine ?? input.StaffId;
            if (staff is null) throw new RequestValidationException(new ValidationErrors().Add("staffId", "Choose which barber takes this customer."));
            if (await TeamRepository.GetAsync(conn, access.BusinessId, staff.Value, tx) is null) throw new RequestValidationException(new ValidationErrors().Add("staffId", "Choose one of your barbers."));
            if (action == "start" && await conn.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM walkin_tickets WHERE business_id = @B AND staff_id = @S AND status = 'in_chair' AND id <> @Id",
                    new { B = access.BusinessId, S = staff, Id = id }, tx) > 0)
                throw new ConflictException("That barber already has someone in the chair. Finish that cut first.");
        }
        if (action == "requeue") staff = null;
        Guid? bookingId = r.BookingId;
        if (action == "done") bookingId = await FinishAsync(conn, tx, access, r, input);

        await conn.ExecuteAsync(
            """
            UPDATE walkin_tickets SET status = @To, staff_id = @S,
                called_at = CASE WHEN @To = 'called' THEN now() WHEN @To = 'waiting' THEN NULL ELSE called_at END,
                started_at = CASE WHEN @To = 'in_chair' THEN now() ELSE started_at END,
                finished_at = CASE WHEN @To IN ('done','left','no_show') THEN now() ELSE finished_at END,
                booking_id = @Bk
            WHERE id = @Id
            """, new { To = to, S = staff, Id = id, Bk = bookingId }, tx);
        // Keep the team board honest without extra taps: in the chair = Busy, finished = Available.
        if (staff is { } st && to == QueueStatuses.InChair)
            await TeamRepository.SetStatusAsync(conn, tx, access.BusinessId, st, StaffStatuses.Busy, $"Walk-in #{r.Number}", null, null, access.UserId, "booking");
        if (staff is { } st2 && to == QueueStatuses.Done)
            await TeamRepository.SetStatusAsync(conn, tx, access.BusinessId, st2, StaffStatuses.Available, null, null, null, access.UserId, "booking");
        await AuditRepository.WriteAsync(conn, tx, access.BusinessId, access.UserId, $"queue_{action}", "walkin_ticket", id);
        tx.Commit();
        return await BoardAsync(conn, access, mine);
    }

    /// <summary>A finished walk-in becomes a completed booking (priced from the barber's own prices) plus any payment taken.</summary>
    private static async Task<Guid> FinishAsync(IDbConnection conn, IDbTransaction tx, AccessContext access, Row r, QueueActionInput input)
    {
        var payments = input.Payments ?? [];
        var e = new ValidationErrors();
        foreach (var (p, i) in payments.Select((p, i) => (p, i)))
        {
            if (p.AmountCents is <= 0 or > 100_000_000) e.Add($"payments[{i}].amountCents", "Enter an amount above zero.");
            if (p.PaymentMethod is null || !PaymentMethods.All.Contains(p.PaymentMethod)) e.Add($"payments[{i}].paymentMethod", "Choose how the customer paid.");
        }
        RequestValidationException.ThrowIfInvalid(e);
        if (payments.Count > 0 && !access.Can(Permission.RecordSales) && !access.Can(Permission.TakeBookingPayments))
            throw new ForbiddenException("Your role cannot record payments.");
        var staffId = r.StaffId ?? throw new ConflictException("Assign a barber first.");
        var policy = await PolicyRepository.GetAsync(conn, access.BusinessId, tx);
        var items = r.ServiceIds.Select(s => new BookingItemInput(s, null)).ToList();
        long services = 0;
        IReadOnlyList<PricedItem> priced = [];
        IReadOnlyList<Guid?> ids = [];
        if (items.Count > 0)
        {
            var prep = await BookingEngine.PrepareAsync(conn, tx, access.BusinessId, items, staffId, "in_shop", policy, null, 0, false);
            services = prep.Quote.ServicesTotalCents;
            priced = prep.Items;
            ids = prep.ServiceIds;
        }
        var paid = payments.Sum(p => p.AmountCents);
        if (services > 0 && paid > services)
            throw new RequestValidationException(new ValidationErrors().Add("payments", $"That is more than the {Money.FormatZar(services)} for these services. Record tips separately."));
        var start = r.StartedAt ?? DateTime.UtcNow.AddMinutes(-r.EstMinutes);
        var end = DateTime.UtcNow > start.AddMinutes(1) ? DateTime.UtcNow : start.AddMinutes(1);
        var branch = await conn.ExecuteScalarAsync<Guid?>("SELECT branch_id FROM staff_profiles WHERE id = @S", new { S = staffId }, tx) ?? r.BranchId;
        var bookingId = await conn.QuerySingleAsync<Guid>(
            """
            INSERT INTO bookings (business_id, reference, customer_name, customer_phone, staff_id, branch_id, location_type, starts_at, ends_at, status,
                people_count, services_total_cents, travel_fee_cents, discount_cents, total_cents, source, customer_user_id, completed_at, created_by, internal_note)
            VALUES (@B, @Ref, @Name, @Phone, @S, @Br, 'in_shop', @Start, @End, 'completed', 1, @Svc, 0, 0, @Svc, 'walkin', @Cu, now(), @U, @Note)
            RETURNING id
            """, new { B = access.BusinessId, Ref = BookingEngine.NewReference(), Name = r.CustomerName, Phone = r.CustomerPhone, S = staffId, Br = branch,
                Start = start, End = end, Svc = services, Cu = r.CustomerUserId, U = access.UserId, Note = $"Walk-in #{r.Number}" }, tx);
        for (var i = 0; i < priced.Count; i++)
            await conn.ExecuteAsync(
                "INSERT INTO booking_items (business_id, booking_id, service_id, service_name, person_label, unit_price_cents, duration_minutes) VALUES (@B, @Id, @Svc, @Name, @P, @Price, @Dur)",
                new { B = access.BusinessId, Id = bookingId, Svc = ids[i], Name = priced[i].ServiceName, P = priced[i].PersonLabel, Price = priced[i].UnitPriceCents, Dur = priced[i].DurationMinutes }, tx);
        await BookingEngine.EventAsync(conn, tx, access.BusinessId, bookingId, "completed", null, BookingStatuses.Completed, "staff", access.UserId, $"Walk-in #{r.Number}");
        var today = DateOnly.FromDateTime(DateTime.UtcNow.AddHours(2));
        foreach (var p in payments)
        {
            var txId = await LedgerRepository.InsertAsync(conn, tx, access.BusinessId, access.UserId, TransactionTypes.Income, $"Walk-in #{r.Number}: {Trunc(r.ServicesSummary, 150)}",
                p.AmountCents, "Services", today, p.PaymentMethod!, PaymentStatuses.RecordedManually, TransactionStatuses.Posted, TransactionSources.Manual,
                null, null, Core.Integrations.RecordOrigins.StaffRecorded, branch, null);
            await conn.ExecuteAsync("UPDATE transactions SET booking_id = @Bk WHERE id = @T", new { Bk = bookingId, T = txId }, tx);
        }
        await JobQueue.EnqueueGrowthRefreshAsync(conn, tx, access.BusinessId);
        return bookingId;
    }

    private static string Trunc(string s, int n) => s.Length <= n ? s : s[..n];

    // ---------------------------------------------------------------- public (customer) side

    private sealed class Biz
    {
        public Guid BusinessId { get; set; }
        public string Name { get; set; } = "";
        public string Slug { get; set; } = "";
    }

    private static async Task<Biz> ShopAsync(IDbConnection conn, string slug) =>
        await conn.QueryFirstOrDefaultAsync<Biz>(
            "SELECT p.business_id, b.name, p.slug FROM public_profiles p JOIN businesses b ON b.id = p.business_id WHERE p.slug = @S AND p.is_published",
            new { S = (slug ?? "").Trim().ToLowerInvariant() }) ?? throw new NotFoundException("Shop not found.");

    public async Task<PublicQueueDto> PublicSnapshotAsync(string slug, CancellationToken ct)
    {
        await using var conn = await db.OpenAsync(ct);
        var biz = await ShopAsync(conn, slug);
        var rows = await TodayAsync(conn, biz.BusinessId, clock.Today);
        var barbers = await BarbersWorkingAsync(conn, biz.BusinessId);
        var enabled = await conn.ExecuteScalarAsync<bool?>("SELECT queue_enabled FROM business_settings WHERE business_id = @B", new { B = biz.BusinessId }) ?? true;
        var next = QueueEstimator.ForNext(rows.Where(r => r.Status == QueueStatuses.Waiting).Select(r => r.EstMinutes).ToList(), InChairRemaining(rows, clock.UtcNow), barbers);
        return new PublicQueueDto(biz.Slug, biz.Name, enabled, rows.Count(r => r.Status == QueueStatuses.Waiting), barbers, next.Label);
    }

    /// <summary>Join from the shop's QR code. Like booking, it needs a one-time-code sign-in, and one open ticket per person per shop.</summary>
    public async Task<PublicTicketCreatedDto> JoinAsync(string slug, QueueJoinInput input, CancellationToken ct)
    {
        _ = CustomerAccountService.VerifiedContact(user) ?? throw new ForbiddenException("Sign in with a one-time code to join the queue.");
        await using var conn = await db.OpenAsync(ct);
        var biz = await ShopAsync(conn, slug);
        var account = await CustomerAccountService.EnsureAsync(conn, user);
        var name = string.IsNullOrWhiteSpace(input.CustomerName) ? account.FullName : input.CustomerName.Trim();
        var e = new ValidationErrors();
        e.Required("customerName", name, 1, 80);
        RequestValidationException.ThrowIfInvalid(e);
        using var tx = conn.BeginTransaction();
        var day = clock.Today;
        await CheckCapacityAsync(conn, tx, biz.BusinessId, day);
        if (await conn.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM walkin_tickets WHERE business_id = @B AND ticket_date = @D AND customer_user_id = @U AND status IN ('waiting','called','in_chair')",
                new { B = biz.BusinessId, D = day, U = user.UserId }, tx) > 0)
            throw new ConflictException("You're already in this shop's queue.");
        var (ids, summary, minutes) = await ServicesAsync(conn, biz.BusinessId, input.ServiceIds, tx);
        var number = await NextNumberAsync(conn, tx, biz.BusinessId, day);
        var token = BookingEngine.NewToken();
        var id = await conn.QuerySingleAsync<Guid>(
            """
            INSERT INTO walkin_tickets (business_id, branch_id, ticket_date, number, customer_name, customer_phone, customer_user_id, service_ids, services_summary,
                est_minutes, preferred_staff_id, token_hash, source)
            VALUES (@B, (SELECT id FROM branches WHERE business_id = @B AND is_active ORDER BY created_at LIMIT 1), @D, @N, @Name, @Phone, @U, @Ids, @Sum, @Min, @Pref, @Hash, 'customer')
            RETURNING id
            """, new { B = biz.BusinessId, D = day, N = number, Name = name, Phone = account.ContactPhone, U = user.UserId, Ids = ids.ToArray(), Sum = summary,
                Min = minutes, Pref = input.PreferredStaffId, Hash = BookingEngine.Hash(token) }, tx);
        var branch = await conn.ExecuteScalarAsync<Guid?>("SELECT branch_id FROM walkin_tickets WHERE id = @Id", new { Id = id }, tx);
        await NotificationRepository.NotifyAsync(conn, tx, biz.BusinessId, Permission.ManageBookings, "booking", "informational",
            $"Walk-in #{number} joined the queue", $"{name}: {summary}.", "/queue", $"queue:{id}", branch);
        tx.Commit();
        var t = await TicketAsync(conn, id, token);
        return new PublicTicketCreatedDto(id, number, token, $"/q/{id}?t={token}", t);
    }

    public async Task<PublicTicketDto> TicketAsync(Guid id, string? token, CancellationToken ct)
    {
        await using var conn = await db.OpenAsync(ct);
        return await TicketAsync(conn, id, token);
    }

    private async Task<PublicTicketDto> TicketAsync(IDbConnection conn, Guid id, string? token)
    {
        var r = await conn.QueryFirstOrDefaultAsync<Row>($"{Select} WHERE t.id = @Id", new { Id = id });
        var ok = r is not null && (BookingEngine.TokenMatches(r.TokenHash, token) || (r.CustomerUserId is { } cu && TryUser() == cu));
        if (!ok) throw new NotFoundException("Ticket not found. Check the link you were given.");
        var name = await conn.ExecuteScalarAsync<string>("SELECT name FROM businesses WHERE id = @B", new { B = r!.BusinessId });
        var rows = await TodayAsync(conn, r.BusinessId, clock.Today);
        var barbers = await BarbersWorkingAsync(conn, r.BusinessId);
        var dto = ToDto(r, rows, barbers, clock.UtcNow, null, null, false);
        var message = r.Status switch
        {
            QueueStatuses.Waiting => dto.Position == 1 ? "You're next. Please stay close to the shop." : $"You're number {dto.Position} in line. Waits are estimates and can change.",
            QueueStatuses.Called => $"It's your turn{(r.StaffName is { } s ? $" with {s}" : "")}. Please go to the chair.",
            QueueStatuses.InChair => "You're in the chair. Enjoy the cut!",
            QueueStatuses.Done => "All done. Thank you for coming!",
            QueueStatuses.Left => "You left the queue.",
            _ => "Your turn was missed. Ask the front desk to add you again."
        };
        return new PublicTicketDto(r.Id, r.Number, name ?? "", r.Status, QueueStatuses.Label(r.Status), dto.Position, dto.WaitLabel, r.StaffName, r.ServicesSummary, message);
    }

    private Guid? TryUser()
    {
        try { return user.UserId; } catch { return null; }
    }

    public async Task<PublicTicketDto> LeaveAsync(Guid id, PublicActionInput input, CancellationToken ct)
    {
        await using var conn = await db.OpenAsync(ct);
        var r = await conn.QueryFirstOrDefaultAsync<Row>($"{Select} WHERE t.id = @Id", new { Id = id });
        if (r is null || !BookingEngine.TokenMatches(r.TokenHash, input.Token)) throw new NotFoundException("Ticket not found. Check the link you were given.");
        if (QueueStatuses.Next(r.Status, "left") is null) throw new ConflictException("You can only leave while waiting.");
        await conn.ExecuteAsync("UPDATE walkin_tickets SET status = 'left', finished_at = now() WHERE id = @Id", new { Id = id });
        return await TicketAsync(conn, id, input.Token);
    }
}

// ============================================================================================ barber pay

public sealed record PayTermsDto(Guid StaffId, string? Mode, string? ModeLabel, decimal? CommissionPercent, long? ChairRentWeeklyCents, long? WageWeeklyCents);

public sealed record PayTermsInput(string? Mode, decimal? CommissionPercent, long? ChairRentWeeklyCents, long? WageWeeklyCents);

public sealed record EarningsDayDto(DateOnly Date, int Visits, long ServicesCents);

public sealed record EarningsDto(Guid StaffId, string DisplayName, DateOnly From, DateOnly To, PayTermsDto Terms, int Visits, int WalkIns, int HouseCalls,
    long ServicesCents, long TravelFeesCents, long CommissionCents, long WageCents, long ChairRentCents, long EarnedCents, long PaidOutCents, long BalanceCents,
    string Explanation, IReadOnlyList<EarningsDayDto> Days, string Disclaimer);

public sealed record PayrollDto(DateOnly From, DateOnly To, IReadOnlyList<EarningsDto> Barbers, long TotalServicesCents, long TotalOwedToBarbersCents,
    long TotalOwedToShopCents, string Disclaimer);

public sealed record PayoutInput(Guid? StaffId, long? AmountCents, DateOnly? From, DateOnly? To, string? PaymentMethod, string? Note);

/// <summary>Commission, chair rent or wage per barber, earnings statements from completed visits, and payouts the owner
/// records (as a Wages expense or a chair-rent income). KasiFlow never moves money.</summary>
public sealed class PayService(IDbConnectionFactory db, IBusinessContext business, IClock clock)
{
    public const string Disclaimer = "Calculated from completed visits recorded in KasiFlow. It is a statement to agree on, not a payslip or tax advice.";

    private sealed class TermsRow
    {
        public Guid StaffId { get; set; }
        public string Mode { get; set; } = "";
        public decimal? CommissionPercent { get; set; }
        public long? ChairRentWeeklyCents { get; set; }
        public long? WageWeeklyCents { get; set; }
    }

    private static PayTermsDto ToDto(Guid staffId, TermsRow? t) =>
        new(staffId, t?.Mode, t is null ? null : PayModes.Label(t.Mode), t?.CommissionPercent, t?.ChairRentWeeklyCents, t?.WageWeeklyCents);

    private static Task<TermsRow?> TermsAsync(IDbConnection conn, Guid businessId, Guid staffId) =>
        conn.QueryFirstOrDefaultAsync<TermsRow>(
            "SELECT staff_id, mode, commission_percent, chair_rent_weekly_cents, wage_weekly_cents FROM staff_pay_terms WHERE business_id = @B AND staff_id = @S",
            new { B = businessId, S = staffId });

    public async Task<PayTermsDto> GetTermsAsync(Guid staffId, CancellationToken ct)
    {
        await using var conn = await db.OpenAsync(ct);
        var (access, _) = await CanSeeAsync(conn, staffId);
        return ToDto(staffId, await TermsAsync(conn, access.BusinessId, staffId));
    }

    public async Task<PayTermsDto> SetTermsAsync(Guid staffId, PayTermsInput input, CancellationToken ct)
    {
        var access = await business.RequireAsync(Permission.ManageStaff);
        var e = new ValidationErrors();
        if (input.Mode is null || !PayModes.All.Contains(input.Mode)) e.Add("mode", "Choose commission, chair rent or wage.");
        if (input.Mode == PayModes.Commission && input.CommissionPercent is null or < 0 or > 100) e.Add("commissionPercent", "Enter a percentage from 0 to 100.");
        if (input.Mode == PayModes.ChairRent && input.ChairRentWeeklyCents is null or < 0 or > 100_000_000) e.Add("chairRentWeeklyCents", "Enter the weekly chair rent.");
        if (input.Mode == PayModes.Wage && input.WageWeeklyCents is null or < 0 or > 100_000_000) e.Add("wageWeeklyCents", "Enter the weekly wage.");
        RequestValidationException.ThrowIfInvalid(e);
        await using var conn = await db.OpenAsync(ct);
        _ = await TeamRepository.GetAsync(conn, access.BusinessId, staffId) ?? throw new NotFoundException();
        await conn.ExecuteAsync(
            """
            INSERT INTO staff_pay_terms (staff_id, business_id, mode, commission_percent, chair_rent_weekly_cents, wage_weekly_cents, updated_by, updated_at)
            VALUES (@S, @B, @M, @P, @R, @W, @U, now())
            ON CONFLICT (staff_id) DO UPDATE SET mode = EXCLUDED.mode, commission_percent = EXCLUDED.commission_percent, chair_rent_weekly_cents = EXCLUDED.chair_rent_weekly_cents,
                wage_weekly_cents = EXCLUDED.wage_weekly_cents, updated_by = EXCLUDED.updated_by, updated_at = now()
            """, new { S = staffId, B = access.BusinessId, M = input.Mode, P = input.Mode == PayModes.Commission ? input.CommissionPercent : null,
                R = input.Mode == PayModes.ChairRent ? input.ChairRentWeeklyCents : null, W = input.Mode == PayModes.Wage ? input.WageWeeklyCents : null, U = access.UserId });
        await AuditRepository.WriteAsync(conn, null, access.BusinessId, access.UserId, "pay_terms_changed", "staff_profile", staffId, JsonSerializer.Serialize(new { input.Mode }));
        return ToDto(staffId, await TermsAsync(conn, access.BusinessId, staffId));
    }

    /// <summary>Barbers see only their own statement; the owner sees anyone's.</summary>
    private async Task<(AccessContext Access, StaffRow Staff)> CanSeeAsync(IDbConnection conn, Guid staffId)
    {
        var access = await business.RequireAsync(Permission.WorkOwnBookings, Permission.ViewBusinessInsights, Permission.ManageStaff);
        var s = await TeamRepository.GetAsync(conn, access.BusinessId, staffId) ?? throw new NotFoundException();
        var own = s.UserId == access.UserId;
        if (!own && !access.Can(Permission.ViewBusinessInsights) && !access.Can(Permission.ManageStaff)) throw new NotFoundException();
        return (access, s);
    }

    private (DateOnly From, DateOnly To) Period(DateOnly? from, DateOnly? to)
    {
        var t = to ?? clock.Today;
        var f = from ?? t.AddDays(-(((int)t.DayOfWeek + 6) % 7)); // Monday of this week
        if (f > t || t.DayNumber - f.DayNumber > 370) throw new RequestValidationException(new ValidationErrors().Add("from", "Choose a period of up to a year."));
        return (f, t);
    }

    public async Task<EarningsDto> EarningsAsync(Guid staffId, DateOnly? from, DateOnly? to, CancellationToken ct)
    {
        await using var conn = await db.OpenAsync(ct);
        var (access, s) = await CanSeeAsync(conn, staffId);
        var (f, t) = Period(from, to);
        return await StatementAsync(conn, access.BusinessId, s, f, t);
    }

    private static async Task<EarningsDto> StatementAsync(IDbConnection conn, Guid businessId, StaffRow s, DateOnly f, DateOnly t)
    {
        var days = (await conn.QueryAsync<(DateTime D, int N, long Svc)>(
            """
            SELECT (starts_at AT TIME ZONE 'Africa/Johannesburg')::date::timestamp AS d, COUNT(*)::int, COALESCE(SUM(services_total_cents - discount_cents), 0)::bigint
            FROM bookings WHERE business_id = @B AND staff_id = @S AND status = 'completed'
              AND (starts_at AT TIME ZONE 'Africa/Johannesburg')::date BETWEEN @F AND @T
            GROUP BY 1 ORDER BY 1
            """, new { B = businessId, S = s.Id, F = f, T = t })).Select(x => new EarningsDayDto(DateOnly.FromDateTime(x.D), x.N, x.Svc)).ToList();
        var mix = await conn.QuerySingleAsync<(int Walk, int House, long Travel)>(
            """
            SELECT COUNT(*) FILTER (WHERE source = 'walkin')::int, COUNT(*) FILTER (WHERE location_type = 'house_call')::int, COALESCE(SUM(travel_fee_cents), 0)::bigint
            FROM bookings WHERE business_id = @B AND staff_id = @S AND status = 'completed' AND (starts_at AT TIME ZONE 'Africa/Johannesburg')::date BETWEEN @F AND @T
            """, new { B = businessId, S = s.Id, F = f, T = t });
        var paid = await conn.ExecuteScalarAsync<long>(
            "SELECT COALESCE(SUM(CASE WHEN direction = 'to_barber' THEN amount_cents ELSE -amount_cents END), 0)::bigint FROM staff_payouts WHERE business_id = @B AND staff_id = @S AND period_from >= @F AND period_to <= @T",
            new { B = businessId, S = s.Id, F = f, T = t });
        var terms = await TermsAsync(conn, businessId, s.Id);
        var st = PayCalculator.Statement(terms is null ? null : new PayTerms(terms.Mode, terms.CommissionPercent, terms.ChairRentWeeklyCents, terms.WageWeeklyCents),
            days.Sum(d => d.Visits), days.Sum(d => d.ServicesCents), mix.Travel, f, t, paid);
        return new EarningsDto(s.Id, s.DisplayName, f, t, ToDto(s.Id, terms), st.Visits, mix.Walk, mix.House, st.ServicesCents, st.TravelFeesCents, st.CommissionCents,
            st.WageCents, st.ChairRentCents, st.EarnedCents, st.PaidOutCents, st.BalanceCents, st.Explanation, days, Disclaimer);
    }

    public async Task<PayrollDto> PayrollAsync(DateOnly? from, DateOnly? to, CancellationToken ct)
    {
        var access = await business.RequireAsync(Permission.ViewBusinessInsights);
        var (f, t) = Period(from, to);
        await using var conn = await db.OpenAsync(ct);
        var list = new List<EarningsDto>();
        foreach (var s in (await TeamRepository.ListAsync(conn, access.BusinessId)).Where(s => s.IsActive))
            list.Add(await StatementAsync(conn, access.BusinessId, s, f, t));
        return new PayrollDto(f, t, list, list.Sum(x => x.ServicesCents), list.Where(x => x.BalanceCents > 0).Sum(x => x.BalanceCents),
            list.Where(x => x.BalanceCents < 0).Sum(x => -x.BalanceCents), Disclaimer);
    }

    /// <summary>Records a payout to a barber (Wages expense) or chair rent received from one (income). No money is moved.</summary>
    public async Task<EarningsDto> PayoutAsync(PayoutInput input, CancellationToken ct)
    {
        var access = await business.RequireAsync(Permission.ViewBusinessInsights);
        var e = new ValidationErrors();
        if (input.StaffId is null) e.Add("staffId", "Choose the barber.");
        if (input.AmountCents is null or 0 or < -100_000_000 or > 100_000_000) e.Add("amountCents", "Enter the amount.");
        if (input.From is null || input.To is null || input.To < input.From) e.Add("from", "Choose the period this covers.");
        if (input.PaymentMethod is null || !PaymentMethods.All.Contains(input.PaymentMethod)) e.Add("paymentMethod", "Choose how it was paid.");
        e.Optional("note", input.Note, 300);
        RequestValidationException.ThrowIfInvalid(e);
        await using var conn = await db.OpenAsync(ct);
        var s = await TeamRepository.GetAsync(conn, access.BusinessId, input.StaffId!.Value) ?? throw new NotFoundException();
        using var tx = conn.BeginTransaction();
        var toBarber = input.AmountCents > 0;
        var amount = Math.Abs(input.AmountCents!.Value);
        var txId = await LedgerRepository.InsertAsync(conn, tx, access.BusinessId, access.UserId, toBarber ? TransactionTypes.Expense : TransactionTypes.Income,
            toBarber ? $"Barber pay: {s.DisplayName} ({input.From:d MMM}–{input.To:d MMM})" : $"Chair rent: {s.DisplayName} ({input.From:d MMM}–{input.To:d MMM})",
            amount, toBarber ? "Wages" : "Other income", clock.Today, input.PaymentMethod!, PaymentStatuses.RecordedManually, TransactionStatuses.Posted,
            TransactionSources.Manual, null, TeamService.Clean(input.Note), Core.Integrations.RecordOrigins.StaffRecorded, s.BranchId, null);
        await conn.ExecuteAsync(
            """
            INSERT INTO staff_payouts (business_id, staff_id, period_from, period_to, amount_cents, direction, payment_method, transaction_id, note, created_by)
            VALUES (@B, @S, @F, @T, @A, @D, @M, @Tx, @N, @U)
            """, new { B = access.BusinessId, S = s.Id, F = input.From, T = input.To, A = amount, D = toBarber ? "to_barber" : "from_barber", M = input.PaymentMethod,
                Tx = txId, N = TeamService.Clean(input.Note), U = access.UserId }, tx);
        await AuditRepository.WriteAsync(conn, tx, access.BusinessId, access.UserId, "barber_payout_recorded", "staff_profile", s.Id, JsonSerializer.Serialize(new { amount, toBarber }));
        await JobQueue.EnqueueGrowthRefreshAsync(conn, tx, access.BusinessId);
        tx.Commit();
        return await StatementAsync(conn, access.BusinessId, s, input.From!.Value, input.To!.Value);
    }
}

// ============================================================================================ house-call map

public sealed record MapPointDto(decimal Latitude, decimal Longitude, DateTimeOffset? At, string Label);

public sealed record MapHouseCallDto(Guid BookingId, string Reference, string Status, DateTimeOffset StartsAt, string? StaffName, string CustomerName,
    string? Area, MapPointDto? Address, MapPointDto? LastShared, string Stage, string StageLabel, bool Overdue, bool HelpActive);

public sealed record HouseCallMapDto(DateOnly Date, IReadOnlyList<MapHouseCallDto> Visits, int WithoutPin, string Note);

/// <summary>Today's house calls on a map: the customer's pin (if they dropped one) and the barber's last *shared* check-in
/// location. Nothing is tracked in the background.</summary>
public sealed class HouseCallMapService(IDbConnectionFactory db, IBusinessContext business, IClock clock)
{
    private sealed class Row
    {
        public Guid Id { get; set; }
        public string Reference { get; set; } = "";
        public string Status { get; set; } = "";
        public DateTime StartsAt { get; set; }
        public DateTime EndsAt { get; set; }
        public string? StaffName { get; set; }
        public string CustomerName { get; set; } = "";
        public string? Suburb { get; set; }
        public string? Town { get; set; }
        public decimal? Latitude { get; set; }
        public decimal? Longitude { get; set; }
        public Guid? BranchId { get; set; }
    }

    public async Task<HouseCallMapDto> TodayAsync(DateOnly? date, CancellationToken ct)
    {
        var access = await business.RequireAsync(Permission.ManageBookings, Permission.ViewBookings);
        var day = date ?? clock.Today;
        await using var conn = await db.OpenAsync(ct);
        var rows = (await conn.QueryAsync<Row>(
            """
            SELECT b.id, b.reference, b.status, b.starts_at, b.ends_at, sp.display_name AS staff_name, b.customer_name, h.suburb, h.town, h.latitude, h.longitude, b.branch_id
            FROM bookings b JOIN house_call_details h ON h.booking_id = b.id LEFT JOIN staff_profiles sp ON sp.id = b.staff_id
            WHERE b.business_id = @B AND b.location_type = 'house_call' AND b.status IN ('confirmed','completed','requested','reschedule_proposed')
              AND (b.starts_at AT TIME ZONE 'Africa/Johannesburg')::date = @D
              AND (@Br::uuid[] IS NULL OR b.branch_id IS NULL OR b.branch_id = ANY(@Br))
            ORDER BY b.starts_at
            """, new { B = access.BusinessId, D = day, Br = access.BranchFilter })).ToList();
        var grace = await HouseCallSafetyService.GraceAsync(conn, access.BusinessId);
        var list = new List<MapHouseCallDto>();
        foreach (var r in rows)
        {
            var checkins = (await conn.QueryAsync<(string Kind, DateTime At, decimal? Lat, decimal? Lng)>(
                "SELECT kind, created_at, latitude, longitude FROM house_call_checkins WHERE booking_id = @Id ORDER BY created_at", new { Id = r.Id })).ToList();
            var row = (await BookingEngine.GetAsync(conn, access.BusinessId, r.Id))!;
            var st = HouseCallSafetyService.State(row, checkins.Select(c => (c.Kind, c.At)), grace, clock.UtcNow);
            var last = checkins.LastOrDefault(c => c.Lat is not null && c.Lng is not null);
            list.Add(new MapHouseCallDto(r.Id, r.Reference, r.Status, TeamRepository.Utc(r.StartsAt), r.StaffName, r.CustomerName,
                string.Join(", ", new[] { r.Suburb, r.Town }.Where(x => !string.IsNullOrWhiteSpace(x))),
                r.Latitude is { } la && r.Longitude is { } lo ? new MapPointDto(la, lo, null, "Visit address (customer's pin)") : null,
                last.Lat is { } sla && last.Lng is { } slo ? new MapPointDto(sla, slo, TeamRepository.Utc(last.At), $"{r.StaffName ?? "Barber"} shared their location ({SafetyCheckinKinds.Label(last.Kind).ToLowerInvariant()})") : null,
                st.Stage, st.StageLabel, st.Overdue, st.HelpActive));
        }
        return new HouseCallMapDto(day, list, list.Count(x => x.Address is null),
            "Pins come from the customer's map pin and from check-ins where the barber chose to share their location. KasiFlow does not track anyone in the background, and distances are not calculated.");
    }
}

// ============================================================================================ owner insights+

public sealed record HeatCellDto(int Weekday, int Hour, int Visits);
public sealed record TopServiceDto(string Name, int Count, long RevenueCents);
public sealed record BarberPerformanceDto(Guid StaffId, string Name, int Visits, long RevenueCents, long AverageTicketCents, int NoShows, decimal NoShowRate,
    decimal RepeatCustomerRate, int WalkIns, int HouseCalls);

public sealed record ShopInsightsDto(DateOnly From, DateOnly To, int Days, int Visits, long RevenueCents, long AverageTicketCents, int UniqueCustomers,
    int RepeatCustomers, decimal RepeatRate, decimal WalkInShare, decimal HouseCallShare, int? AverageQueueWaitMinutes, string BusiestSlot,
    IReadOnlyList<HeatCellDto> Heatmap, IReadOnlyList<TopServiceDto> TopServices, IReadOnlyList<BarberPerformanceDto> Barbers, IReadOnlyList<string> Notes);

/// <summary>Owner-only shop insights from completed visits: busiest hours, top services, per-barber performance and
/// repeat customers. Visit values are services booked, not money received — see the money pages for cash.</summary>
public sealed class ShopInsightsService(IDbConnectionFactory db, IBusinessContext business, IClock clock)
{
    private sealed class VisitRow
    {
        public Guid? StaffId { get; set; }
        public string? StaffName { get; set; }
        public DateTime StartsAt { get; set; }
        public string Status { get; set; } = "";
        public long Total { get; set; }
        public string Source { get; set; } = "";
        public string LocationType { get; set; } = "";
        public string CustomerKey { get; set; } = "";
    }

    public async Task<ShopInsightsDto> GetAsync(int? days, CancellationToken ct)
    {
        var access = await business.RequireAsync(Permission.ViewBusinessInsights);
        var span = Math.Clamp(days ?? 90, 7, 365);
        var to = clock.Today;
        var from = to.AddDays(-(span - 1));
        await using var conn = await db.OpenAsync(ct);
        var visits = (await conn.QueryAsync<VisitRow>(
            """
            SELECT b.staff_id, sp.display_name AS staff_name, b.starts_at, b.status, (b.services_total_cents - b.discount_cents)::bigint AS total, b.source, b.location_type,
                   COALESCE(b.customer_user_id::text, b.customer_id::text, NULLIF(regexp_replace(COALESCE(b.customer_phone, ''), '\D', '', 'g'), ''), lower(trim(b.customer_name))) AS customer_key
            FROM bookings b LEFT JOIN staff_profiles sp ON sp.id = b.staff_id
            WHERE b.business_id = @B AND b.status IN ('completed','no_show') AND (b.starts_at AT TIME ZONE 'Africa/Johannesburg')::date BETWEEN @F AND @T
            """, new { B = access.BusinessId, F = from, T = to })).ToList();
        var done = visits.Where(v => v.Status == BookingStatuses.Completed).ToList();
        static DateTimeOffset Sa(DateTime d) => TeamRepository.Utc(d).ToOffset(StaffAvailability.SaOffset);
        var heat = done.GroupBy(v => ((int)Sa(v.StartsAt).DayOfWeek, Sa(v.StartsAt).Hour)).Select(g => new HeatCellDto(g.Key.Item1, g.Key.Hour, g.Count()))
            .OrderBy(h => h.Weekday).ThenBy(h => h.Hour).ToList();
        var busiest = heat.OrderByDescending(h => h.Visits).FirstOrDefault();
        var top = (await conn.QueryAsync<(string Name, int N, long Rev)>(
            """
            SELECT i.service_name, COUNT(*)::int, COALESCE(SUM(i.unit_price_cents), 0)::bigint
            FROM booking_items i JOIN bookings b ON b.id = i.booking_id
            WHERE b.business_id = @B AND b.status = 'completed' AND (b.starts_at AT TIME ZONE 'Africa/Johannesburg')::date BETWEEN @F AND @T
            GROUP BY i.service_name ORDER BY 2 DESC, 3 DESC LIMIT 8
            """, new { B = access.BusinessId, F = from, T = to })).Select(x => new TopServiceDto(x.Name, x.N, x.Rev)).ToList();
        var perCustomer = done.GroupBy(v => v.CustomerKey).ToDictionary(g => g.Key, g => g.Count());
        var barbers = visits.Where(v => v.StaffId is not null).GroupBy(v => (v.StaffId!.Value, v.StaffName ?? "Barber")).Select(g =>
        {
            var d = g.Where(v => v.Status == BookingStatuses.Completed).ToList();
            var ns = g.Count(v => v.Status == BookingStatuses.NoShow);
            var custs = d.Select(v => v.CustomerKey).Distinct().ToList();
            var rev = d.Sum(v => v.Total);
            return new BarberPerformanceDto(g.Key.Item1, g.Key.Item2, d.Count, rev, d.Count > 0 ? rev / d.Count : 0, ns,
                g.Count() > 0 ? Math.Round(ns * 100m / g.Count(), 1) : 0,
                custs.Count > 0 ? Math.Round(custs.Count(c => perCustomer.GetValueOrDefault(c) > 1) * 100m / custs.Count, 1) : 0,
                d.Count(v => v.Source == "walkin"), d.Count(v => v.LocationType == "house_call"));
        }).OrderByDescending(b => b.RevenueCents).ToList();
        var revenue = done.Sum(v => v.Total);
        var unique = perCustomer.Count;
        var repeat = perCustomer.Count(kv => kv.Value > 1);
        var avgWait = await conn.ExecuteScalarAsync<double?>(
            "SELECT AVG(EXTRACT(EPOCH FROM (started_at - joined_at)) / 60) FROM walkin_tickets WHERE business_id = @B AND started_at IS NOT NULL AND ticket_date BETWEEN @F AND @T",
            new { B = access.BusinessId, F = from, T = to });
        string[] dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
        var notes = new List<string>
        {
            "Visit values are the services booked (after discounts), not money received. Use the money pages for cash.",
            "Repeat customers are matched by account, customer record, phone number or name, so a few may be counted twice.",
        };
        if (done.Any(v => v.Source == "history")) notes.Add("Includes visits copied in from the shop's appointment book.");
        return new ShopInsightsDto(from, to, span, done.Count, revenue, done.Count > 0 ? revenue / done.Count : 0, unique, repeat,
            unique > 0 ? Math.Round(repeat * 100m / unique, 1) : 0, done.Count > 0 ? Math.Round(done.Count(v => v.Source == "walkin") * 100m / done.Count, 1) : 0,
            done.Count > 0 ? Math.Round(done.Count(v => v.LocationType == "house_call") * 100m / done.Count, 1) : 0,
            avgWait is { } w ? (int)Math.Round(w) : null,
            busiest is null ? "Not enough visits yet" : $"{dayNames[busiest.Weekday]}s around {busiest.Hour:00}:00",
            heat, top, barbers, notes);
    }
}
