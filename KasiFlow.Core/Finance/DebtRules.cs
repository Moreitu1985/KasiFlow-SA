namespace KasiFlow.Core.Finance;

public static class DebtStatuses
{
    public const string Outstanding = "outstanding";
    public const string PartiallyPaid = "partially_paid";
    public const string Overdue = "overdue";
    public const string Settled = "settled";
    public const string Disputed = "disputed";
    public const string WrittenOff = "written_off";
}

public sealed record DebtCharge(long AmountCents, string Status);

/// <summary>Debt balance with principal, charges and payments kept separate.</summary>
public sealed record DebtBalance(
    long OriginalPrincipalCents,
    long PaidCents,
    long WrittenOffCents,
    long PrincipalOutstandingCents,
    long AppliedChargesCents,
    long ChargesOutstandingCents,
    long ProposedChargesCents,
    long TotalOutstandingCents,
    string Status);

/// <summary>
/// Debt maths. Payments settle principal first and then any applied (valid, disclosed, authorised) charges.
/// Proposed charges are shown but never added to the amount owed. Example: R200 owed, R50 paid → R150 principal; with a
/// valid R5 charge applied → R155 total; without it → R150.
/// </summary>
public static class DebtMath
{
    public static DebtBalance Balance(long originalCents, long paidCents, long writtenOffCents, IReadOnlyList<DebtCharge> charges,
        DateOnly? dueDate, DateOnly today, bool disputed, bool closedWrittenOff = false)
    {
        if (originalCents <= 0 || paidCents < 0 || writtenOffCents < 0) throw new ArgumentOutOfRangeException(nameof(originalCents));
        var applied = charges.Where(c => c.Status == "applied").Sum(c => c.AmountCents);
        var proposed = charges.Where(c => c.Status == "proposed").Sum(c => c.AmountCents);
        var toPrincipal = Math.Min(paidCents, Math.Max(0, originalCents - writtenOffCents));
        var principalOutstanding = Math.Max(0, originalCents - writtenOffCents - toPrincipal);
        var toCharges = Math.Min(applied, paidCents - toPrincipal);
        var chargesOutstanding = applied - toCharges;
        var total = principalOutstanding + chargesOutstanding;
        string status;
        if (closedWrittenOff) status = DebtStatuses.WrittenOff;
        else if (total == 0) status = DebtStatuses.Settled;
        else if (disputed) status = DebtStatuses.Disputed;
        else if (dueDate is { } d && d < today) status = DebtStatuses.Overdue;
        else if (paidCents > 0) status = DebtStatuses.PartiallyPaid;
        else status = DebtStatuses.Outstanding;
        return new DebtBalance(originalCents, paidCents, writtenOffCents, principalOutstanding, applied, chargesOutstanding, proposed, total, status);
    }
}

/// <summary>The business's debt-charge policy as configured, plus what was disclosed on one specific debt.</summary>
public sealed record DebtChargePolicy(bool Enabled, bool LegallyReviewed, long AmountCents, int OverdueDays, string? Terms, int Version);

public sealed record DebtDisclosure(DateTimeOffset? DisclosedAt, long? AmountCents, int? OverdueDays, int? PolicyVersion);

public sealed record ChargeDecision(bool Qualifies, string? EventKey, long AmountCents, bool Apply, string Basis);

/// <summary>
/// Safeguards for the requested R5 overdue-debt charge:
/// one charge per qualifying event (here: the debt becoming overdue by the configured number of days — never per day,
/// never compounded); applied only when the policy is enabled, marked legally reviewed, and the same terms were disclosed
/// on this debt before it was incurred; otherwise recorded as "proposed" only and not added to the amount owed.
/// Disputed and settled debts never attract charges. Terms are taken from the snapshot on the debt, so later policy
/// changes never alter an existing debt.
/// </summary>
public static class DebtChargeRules
{
    public const string EventKey = "overdue";

    public static ChargeDecision Evaluate(DebtChargePolicy policy, DebtDisclosure disclosure, DebtBalance balance, DateOnly? dueDate, DateOnly today)
    {
        if (balance.PrincipalOutstandingCents <= 0 || balance.Status is DebtStatuses.Settled or DebtStatuses.Disputed or DebtStatuses.WrittenOff)
            return new ChargeDecision(false, null, 0, false, "No charge: the debt is settled, disputed or written off.");
        if (dueDate is null) return new ChargeDecision(false, null, 0, false, "No charge: the debt has no due date.");

        // The disclosed terms (if any) decide the amount and trigger; otherwise the current policy is only a proposal.
        var amount = disclosure.AmountCents ?? policy.AmountCents;
        var days = disclosure.OverdueDays ?? policy.OverdueDays;
        if (amount <= 0) return new ChargeDecision(false, null, 0, false, "No charge: the amount is zero.");
        if (today.DayNumber - dueDate.Value.DayNumber < days)
            return new ChargeDecision(false, null, amount, false, $"No charge yet: applies only once the debt is {days} days overdue.");

        string? reason = null;
        if (!policy.Enabled) reason = "the owner has not enabled the charge policy";
        else if (!policy.LegallyReviewed) reason = "the policy has not been marked as legally reviewed";
        else if (disclosure.DisclosedAt is null) reason = "the charge terms were not disclosed to the customer when this debt was created";
        // When disclosed, the terms recorded on the debt apply even if the policy was edited later.

        return reason is null
            ? new ChargeDecision(true, EventKey, amount, true, $"Applied: the {Common.Money.FormatZar(amount)} charge for debts {days}+ days overdue was disclosed when the debt was created.")
            : new ChargeDecision(true, EventKey, amount, false, $"Proposed only (not added to the amount owed): {reason}.");
    }
}
