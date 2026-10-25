using System.Data;
using System.Text.Json;
using Dapper;
using KasiFlow.Api.Data;
using KasiFlow.Api.DTOs;
using KasiFlow.Api.Middleware;
using KasiFlow.Api.Models;
using KasiFlow.Api.Repositories;
using KasiFlow.Core.Access;
using KasiFlow.Core.Common;
using KasiFlow.Core.Finance;
using KasiFlow.Core.Validation;

namespace KasiFlow.Api.Services.Barbershop;

public sealed record DebtChargeDto(Guid Id, string EventKey, long AmountCents, string Status, string Basis, DateTimeOffset CreatedAt,
    DateTimeOffset? DecidedAt, string? DecisionReason);

public sealed record StatementLineDto(DateTimeOffset At, string Kind, string Description, long? AmountCents, long? BalanceAfterCents, string? Note);

public sealed record ReminderDto(Guid Id, string Channel, string Outcome, string? Note, DateTimeOffset At);

public sealed record DebtAccountDto(ReceivableDto Debt, string StatusLabel, DebtBalanceDto Balance, IReadOnlyList<DebtChargeDto> Charges,
    IReadOnlyList<StatementLineDto> Statement, IReadOnlyList<ReminderDto> Reminders, string? ChargeTermsSnapshot, DateTimeOffset? ChargeTermsDisclosedAt,
    bool RemindersPaused, string? RemindersPausedReason);

public sealed record DebtBalanceDto(long OriginalPrincipalCents, long PaidCents, long WrittenOffCents, long PrincipalOutstandingCents,
    long AppliedChargesCents, long ChargesOutstandingCents, long ProposedChargesCents, long TotalOutstandingCents, string Explanation);

public sealed record ReminderInput(string? Channel, string? Outcome, string? Note);

public sealed record OverdueDebtDto(ReceivableDto Debt, int ReminderCount, int FailedAttempts, DateTimeOffset? LastReminderAt, bool NeedsReview, string? ReviewReason);

public sealed record OverdueReportDto(long OverduePrincipalCents, long OverdueChargesCents, int OverdueCount, long ExpectedNext30DaysCents,
    IReadOnlyList<OverdueDebtDto> Items, IReadOnlyList<ExpectedCollectionDto> ExpectedCollections, string Note);

public sealed record ExpectedCollectionDto(Guid DebtId, string CustomerName, DateOnly DueDate, long AmountCents, string Label);

/// <summary>Applies or proposes the overdue-debt charge exactly once per qualifying event, following DebtChargeRules.</summary>
public static class DebtChargeEvaluator
{
    public static async Task<int> RunAsync(IDbConnection conn, Guid businessId, DateOnly today)
    {
        var policy = await PolicyRepository.GetAsync(conn, businessId);
        var rows = (await conn.QueryAsync<ReceivableRow>(
            """
            WITH paid AS (SELECT rp.receivable_id, SUM(rp.amount_cents)::bigint AS paid FROM receivable_payments rp JOIN transactions t ON t.id = rp.transaction_id AND t.status <> 'voided'
                          WHERE rp.business_id = @B GROUP BY rp.receivable_id)
            SELECT r.id, r.customer_id, '' AS customer_name, r.description, r.original_amount_cents, COALESCE(p.paid, 0) AS paid_cents, r.written_off_cents,
                   r.issue_date, r.due_date, r.status, r.disputed, r.charge_terms_disclosed_at, r.charge_amount_cents, r.charge_overdue_days, r.charge_policy_version,
                   COALESCE((SELECT SUM(ch.amount_cents) FROM receivable_charges ch WHERE ch.receivable_id = r.id AND ch.status = 'applied'), 0)::bigint AS applied_charges_cents
            FROM receivables r LEFT JOIN paid p ON p.receivable_id = r.id
            WHERE r.business_id = @B AND r.status = 'open' AND r.due_date IS NOT NULL AND r.due_date < @Today
            """, new { B = businessId, Today = today })).ToList();
        var changed = 0;
        foreach (var r in rows)
        {
            var bal = r.Balance(today);
            var decision = DebtChargeRules.Evaluate(policy.DebtCharge,
                new DebtDisclosure(TeamRepository.Utc(r.ChargeTermsDisclosedAt), r.ChargeAmountCents, r.ChargeOverdueDays, r.ChargePolicyVersion), bal, r.DueDate, today);
            if (!decision.Qualifies || decision.EventKey is null) continue;
            var status = decision.Apply ? "applied" : "proposed";
            changed += await conn.ExecuteAsync(
                """
                INSERT INTO receivable_charges (business_id, receivable_id, event_key, amount_cents, status, basis)
                VALUES (@B, @R, @K, @A, @S, @Basis)
                ON CONFLICT (receivable_id, event_key) DO UPDATE SET status = EXCLUDED.status, basis = EXCLUDED.basis
                    WHERE receivable_charges.status = 'proposed' AND EXCLUDED.status = 'applied'
                """, new { B = businessId, R = r.Id, K = decision.EventKey, A = decision.AmountCents, S = status, Basis = decision.Basis });
        }
        return changed;
    }
}

/// <summary>Customer-debt account: balance breakdown, statement, disputes, reminders and charge decisions.</summary>
public sealed class DebtService(IDbConnectionFactory db, IBusinessContext business, IClock clock)
{
    private sealed class ChargeRow
    {
        public Guid Id { get; set; }
        public string EventKey { get; set; } = "";
        public long AmountCents { get; set; }
        public string Status { get; set; } = "";
        public string Basis { get; set; } = "";
        public DateTime CreatedAt { get; set; }
        public DateTime? DecidedAt { get; set; }
        public string? DecisionReason { get; set; }
    }

    public static readonly string[] Channels = ["manual", "whatsapp", "sms", "call", "in_person"];
    public static readonly string[] Outcomes = ["sent", "promised", "no_answer", "refused"];

    private static string Label(string s) => s switch
    {
        DebtStatuses.Outstanding => "Outstanding",
        DebtStatuses.PartiallyPaid => "Partially paid",
        DebtStatuses.Overdue => "Overdue",
        DebtStatuses.Settled => "Settled",
        DebtStatuses.Disputed => "Disputed",
        DebtStatuses.WrittenOff => "Written off",
        _ => s
    };

    public async Task<DebtAccountDto> AccountAsync(Guid id, CancellationToken ct)
    {
        var access = await business.RequireAsync(Permission.ViewFinancials, Permission.RecordDebtPayments);
        await using var conn = await db.OpenAsync(ct);
        return await AccountInternalAsync(conn, access.BusinessId, id);
    }

    private async Task<DebtAccountDto> AccountInternalAsync(IDbConnection conn, Guid businessId, Guid id, IDbTransaction? tx = null)
    {
        var today = clock.Today;
        var r = await ReceivableRepository.GetAsync(conn, businessId, id, tx) ?? throw new NotFoundException("Debt not found.");
        var dto = r.ToDto(today);
        var bal = r.Balance(today);
        var charges = (await conn.QueryAsync<ChargeRow>(
            "SELECT id, event_key, amount_cents, status, basis, created_at, decided_at, decision_reason FROM receivable_charges WHERE receivable_id = @Id AND business_id = @Bz ORDER BY created_at",
            new { Id = id, Bz = businessId }, tx)).Select(c => new DebtChargeDto(c.Id, c.EventKey, c.AmountCents, c.Status, c.Basis, TeamRepository.Utc(c.CreatedAt),
                TeamRepository.Utc(c.DecidedAt), c.DecisionReason)).ToList();
        var payments = await ReceivableRepository.PaymentsAsync(conn, businessId, id, tx);
        var reminders = (await conn.QueryAsync<(Guid Id, string Ch, string O, string? N, DateTime At)>(
            "SELECT id, channel, outcome, note, created_at FROM receivable_reminders WHERE receivable_id = @Id AND business_id = @B ORDER BY created_at",
            new { Id = id, B = businessId }, tx)).Select(x => new ReminderDto(x.Id, x.Ch, x.O, x.N, TeamRepository.Utc(x.At))).ToList();

        // Chronological statement of account. Proposed charges are listed but never change the balance.
        var events = new List<(DateTimeOffset At, string Kind, string Desc, long Delta, bool Counts, string? Note)>
        {
            (new DateTimeOffset(r.IssueDate.ToDateTime(TimeOnly.MinValue), TimeSpan.Zero), "debt", r.Description, r.OriginalAmountCents, true, r.DueDate is { } d ? $"Due {d:yyyy-MM-dd}" : "No due date")
        };
        foreach (var p in payments.Where(p => !p.IsVoided))
            events.Add((new DateTimeOffset(p.PaymentDate.ToDateTime(new TimeOnly(12, 0)), TimeSpan.Zero), "payment", $"Payment ({p.PaymentMethod})", -p.AmountCents, true, p.Reference));
        foreach (var c in charges)
            events.Add((c.CreatedAt, "charge_" + c.Status, c.Status switch
            {
                "applied" => "Late charge applied",
                "proposed" => "Late charge PROPOSED (not added to the balance)",
                "waived" => "Late charge waived",
                _ => "Late charge reversed"
            }, c.AmountCents, c.Status == "applied", c.Status == "proposed" ? c.Basis : c.DecisionReason));
        if (r.WrittenOffCents > 0) events.Add((new DateTimeOffset(DateTime.SpecifyKind(r.CreatedAt, DateTimeKind.Utc)).AddSeconds(1), "write_off", "Written off", -r.WrittenOffCents, true, null));
        long running = 0;
        var statement = new List<StatementLineDto>();
        foreach (var e in events.OrderBy(e => e.At))
        {
            if (e.Counts) running += e.Delta;
            statement.Add(new StatementLineDto(e.At, e.Kind, e.Desc, e.Kind == "payment" || e.Kind == "write_off" ? -e.Delta : e.Delta, e.Counts ? Math.Max(0, running) : null, e.Note));
        }
        var explanation = $"Principal {Money.FormatZar(bal.OriginalPrincipalCents)} − payments {Money.FormatZar(Math.Min(bal.PaidCents, bal.OriginalPrincipalCents))}" +
                          (bal.WrittenOffCents > 0 ? $" − written off {Money.FormatZar(bal.WrittenOffCents)}" : "") +
                          $" = {Money.FormatZar(bal.PrincipalOutstandingCents)} principal outstanding" +
                          (bal.AppliedChargesCents > 0 ? $"; plus applied charges {Money.FormatZar(bal.ChargesOutstandingCents)} outstanding" : "") +
                          $". Total owed: {Money.FormatZar(bal.TotalOutstandingCents)}." +
                          (bal.ProposedChargesCents > 0 ? $" A proposed charge of {Money.FormatZar(bal.ProposedChargesCents)} is NOT included." : "");
        var paused = r.Disputed || r.Status != "open";
        return new DebtAccountDto(dto, Label(dto.DebtStatus),
            new DebtBalanceDto(bal.OriginalPrincipalCents, bal.PaidCents, bal.WrittenOffCents, bal.PrincipalOutstandingCents, bal.AppliedChargesCents,
                bal.ChargesOutstandingCents, bal.ProposedChargesCents, bal.TotalOutstandingCents, explanation),
            charges, statement, reminders, r.ChargeTermsSnapshot, TeamRepository.Utc(r.ChargeTermsDisclosedAt), paused,
            r.Disputed ? "Reminders are paused while the debt is disputed." : r.Status != "open" ? "The debt is closed." : null);
    }

    public async Task<DebtAccountDto> DisputeAsync(Guid id, ReasonInput input, bool open, CancellationToken ct)
    {
        var access = await business.RequireAsync(Permission.ManageFinancials, Permission.RecordDebtPayments);
        if (string.IsNullOrWhiteSpace(input.Reason) || input.Reason.Length > 500)
            throw new RequestValidationException(new ValidationErrors().Add("reason", "Describe the dispute or how it was resolved (500 characters or fewer)."));
        await using var conn = await db.OpenAsync(ct);
        using var tx = conn.BeginTransaction();
        if (!await ReceivableRepository.LockAsync(conn, tx, access.BusinessId, id)) throw new NotFoundException("Debt not found.");
        var r = (await ReceivableRepository.GetAsync(conn, access.BusinessId, id, tx))!;
        if (r.Status != "open") throw new ConflictException("Only open debts can be disputed.");
        if (r.Disputed == open) throw new ConflictException(open ? "This debt is already disputed." : "This debt is not disputed.");
        await conn.ExecuteAsync(
            "UPDATE receivables SET disputed = @D, dispute_reason = @R, disputed_at = CASE WHEN @D THEN now() ELSE disputed_at END, updated_at = now() WHERE id = @Id AND business_id = @B",
            new { D = open, R = open ? input.Reason.Trim() : r.DisputeReason, Id = id, B = access.BusinessId }, tx);
        await AuditRepository.WriteAsync(conn, tx, access.BusinessId, access.UserId, open ? "debt_disputed" : "debt_dispute_resolved", "receivable", id);
        if (open)
            await NotificationRepository.NotifyAsync(conn, tx, access.BusinessId, Permission.ManageFinancials, "debt", "warning", "A customer disputed a debt",
                $"{r.CustomerName} disputes {Money.FormatZar(r.Remaining())}. Reminders and charges are paused until it is reviewed.", $"/customers/debts/{id}", $"dispute:{id}:{DateTime.UtcNow:yyyyMMddHHmm}");
        tx.Commit();
        return await AccountInternalAsync(conn, access.BusinessId, id);
    }

    public async Task<DebtAccountDto> AddReminderAsync(Guid id, ReminderInput input, CancellationToken ct)
    {
        var access = await business.RequireAsync(Permission.ManageFinancials, Permission.RecordDebtPayments);
        var e = new ValidationErrors();
        if (input.Channel is not null && !Channels.Contains(input.Channel)) e.Add("channel", "Choose how you reminded the customer.");
        if (input.Outcome is not null && !Outcomes.Contains(input.Outcome)) e.Add("outcome", "Choose the outcome.");
        e.Optional("note", input.Note, 300);
        RequestValidationException.ThrowIfInvalid(e);
        await using var conn = await db.OpenAsync(ct);
        var r = await ReceivableRepository.GetAsync(conn, access.BusinessId, id) ?? throw new NotFoundException("Debt not found.");
        if (r.Disputed) throw new ConflictException("Reminders are paused while the debt is disputed. Resolve the dispute first.");
        if (r.Status != "open") throw new ConflictException("This debt is closed.");
        await conn.ExecuteAsync("INSERT INTO receivable_reminders (business_id, receivable_id, channel, outcome, note, created_by) VALUES (@B, @R, @C, @O, @N, @U)",
            new { B = access.BusinessId, R = id, C = input.Channel ?? "manual", O = input.Outcome ?? "sent", N = string.IsNullOrWhiteSpace(input.Note) ? null : input.Note.Trim(), U = access.UserId });
        return await AccountInternalAsync(conn, access.BusinessId, id);
    }

    /// <summary>Waive (before or after it applied) or reverse an invalid charge. Needs a reason; logged.</summary>
    public async Task<DebtAccountDto> DecideChargeAsync(Guid id, Guid chargeId, string decision, ReasonInput input, CancellationToken ct)
    {
        var access = await business.RequireAsync(Permission.ManageFinancials);
        if (string.IsNullOrWhiteSpace(input.Reason) || input.Reason.Length > 300)
            throw new RequestValidationException(new ValidationErrors().Add("reason", "Give a reason (300 characters or fewer)."));
        var to = decision switch { "waive" => "waived", "reverse" => "reversed", _ => throw new NotFoundException() };
        await using var conn = await db.OpenAsync(ct);
        using var tx = conn.BeginTransaction();
        if (!await ReceivableRepository.LockAsync(conn, tx, access.BusinessId, id)) throw new NotFoundException("Debt not found.");
        var current = await conn.QueryFirstOrDefaultAsync<string>("SELECT status FROM receivable_charges WHERE id = @C AND receivable_id = @R AND business_id = @B FOR UPDATE",
            new { C = chargeId, R = id, B = access.BusinessId }, tx) ?? throw new NotFoundException("Charge not found.");
        var allowed = (current, to) is ("proposed", "waived") or ("applied", "waived") or ("applied", "reversed");
        if (!allowed) throw new ConflictException($"A {current} charge cannot be {to}.");
        await conn.ExecuteAsync("UPDATE receivable_charges SET status = @S, decided_by = @U, decided_at = now(), decision_reason = @R WHERE id = @C",
            new { S = to, U = access.UserId, R = input.Reason.Trim(), C = chargeId }, tx);
        // If the debt is now fully covered by payments, close it.
        var r = (await ReceivableRepository.GetAsync(conn, access.BusinessId, id, tx))!;
        if (r.Status == "open" && r.Remaining() == 0) await ReceivableRepository.SetStatusAsync(conn, tx, access.BusinessId, id, "settled");
        await AuditRepository.WriteAsync(conn, tx, access.BusinessId, access.UserId, "debt_charge_" + to, "receivable", id, JsonSerializer.Serialize(new { from = current }));
        tx.Commit();
        return await AccountInternalAsync(conn, access.BusinessId, id);
    }

    public async Task<int> EvaluateChargesAsync(CancellationToken ct)
    {
        var access = await business.RequireAsync(Permission.ManageFinancials);
        await using var conn = await db.OpenAsync(ct);
        return await DebtChargeEvaluator.RunAsync(conn, access.BusinessId, clock.Today);
    }

    public async Task<OverdueReportDto> OverdueReportAsync(CancellationToken ct)
    {
        var access = await business.RequireAsync(Permission.ViewFinancials, Permission.RecordDebtPayments);
        await using var conn = await db.OpenAsync(ct);
        var today = clock.Today;
        var (rows, _) = await ReceivableRepository.ListAsync(conn, access.BusinessId, today, "open", "all", null, 1, 500);
        var rem = (await conn.QueryAsync<(Guid R, int N, int Failed, DateTime? Last)>(
            "SELECT receivable_id, COUNT(*)::int, COUNT(*) FILTER (WHERE outcome IN ('no_answer','refused'))::int, MAX(created_at) FROM receivable_reminders WHERE business_id = @B GROUP BY receivable_id",
            new { B = access.BusinessId })).ToDictionary(x => x.R);
        var overdue = rows.Where(r => r.DueDate is { } d && d < today && r.Remaining() > 0).Select(r =>
        {
            var dto = r.ToDto(today);
            var x = rem.GetValueOrDefault(r.Id);
            string? why = r.Disputed ? "Disputed — needs review before any further reminders." :
                x.Failed >= 2 ? $"{x.Failed} collection attempts failed." :
                dto.DaysOverdue >= 30 ? $"{dto.DaysOverdue} days overdue." : null;
            return new OverdueDebtDto(dto, x.N, x.Failed, TeamRepository.Utc(x.Last), why is not null, why);
        }).OrderByDescending(o => o.Debt.DaysOverdue).ToList();
        var expected = rows.Where(r => r.DueDate is { } d && d >= today && d <= today.AddDays(30) && !r.Disputed)
            .Select(r => new ExpectedCollectionDto(r.Id, r.CustomerName, r.DueDate!.Value, r.Balance(today).PrincipalOutstandingCents, "Expected — not received"))
            .Where(x => x.AmountCents > 0).OrderBy(x => x.DueDate).ToList();
        return new OverdueReportDto(overdue.Sum(o => o.Debt.PrincipalOutstandingCents), overdue.Sum(o => o.Debt.ChargesOutstandingCents), overdue.Count,
            expected.Sum(x => x.AmountCents), overdue, expected,
            "Expected collections are amounts customers are due to pay. They are not money received and may arrive late or not at all.");
    }
}
