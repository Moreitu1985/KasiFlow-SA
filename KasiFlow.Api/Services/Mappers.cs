using System.Text.Json;
using KasiFlow.Api.DTOs;
using KasiFlow.Api.Models;
using KasiFlow.Api.Repositories;
using KasiFlow.Core.Access;
using KasiFlow.Core.Finance;
using KasiFlow.Core.Forecasting;

namespace KasiFlow.Api.Services;

public static class Mappers
{
    public static BusinessDto ToDto(this BusinessRow b) =>
        new(b.Id, b.Name, b.BusinessType, b.OwnerName, b.ContactEmail, b.ContactPhone, b.Province, b.Town,
            b.RegistrationStatus, b.Currency, b.CreatedAt, b.UpdatedAt, b.Role, RolePermissions.For(b.Role), b.IsDemo, ToDto(RoleExperiences.For(b.Role)));

    public static ExperienceDto ToDto(AppExperience e)
    {
        static ScreenDto Map(ScreenInfo s) => new(s.Key, s.Path, s.Label, s.Short, s.Group);
        return new ExperienceDto(e.Key, e.Title, e.Purpose, e.Home.Path, e.Screens.Select(Map).ToList(), e.MobileTabs.Select(s => s.Key).ToList());
    }

    public static SettingsDto ToDto(this SettingsRow s) =>
        new(s.OpeningCashBalanceCents, s.OpeningBalanceDate, s.CashBufferCents, s.ForecastDays, s.LargeTxMultiplier,
            s.CashupVarianceThresholdCents, s.ReorderSafetyDays, s.ReorderCoverDays, s.DefaultLeadTimeDays);

    public static TransactionDto ToDto(this TransactionRow t) =>
        new(t.Id, t.Type, t.Description, t.AmountCents, t.Category, t.TransactionDate, t.PaymentMethod, t.PaymentStatus,
            t.Status, t.Source, t.Reference, t.Notes, t.VoidReason, t.VoidedAt, t.CreatedAt, t.UpdatedAt, t.ReceivableId,
            t.PayableId, t.CounterpartyName, t.Origin, t.BranchId, t.BranchName, t.ShiftId, t.ProviderPaymentId, t.ProviderKey, t.ProviderStatus);

    public static CustomerDto ToCustomer(this PartyRow p) =>
        new(p.Id, p.Name, p.Phone, p.Email, p.Notes, p.IsArchived, p.OutstandingCents, p.OpenItems, p.CreatedAt);

    public static SupplierDto ToSupplier(this PartyRow p) =>
        new(p.Id, p.Name, p.Phone, p.Email, p.Notes, p.IsArchived, p.OutstandingCents, p.OpenItems, p.CreatedAt);

    public static PaymentRecordDto ToDto(this PaymentRow p) =>
        new(p.Id, p.TransactionId, p.AmountCents, p.PaymentDate, p.PaymentMethod, p.Reference, p.IsVoided);

    /// <summary>Principal and applied charges still owed, kept separate (see KasiFlow.Core.Finance.DebtMath).</summary>
    public static DebtBalance Balance(this ReceivableRow r, DateOnly today) =>
        DebtMath.Balance(r.OriginalAmountCents, r.PaidCents, Math.Min(r.WrittenOffCents, r.OriginalAmountCents),
            [new DebtCharge(r.AppliedChargesCents, "applied"), new DebtCharge(r.ProposedChargesCents, "proposed")],
            r.DueDate, today, r.Disputed, r.Status == "written_off");

    public static long Remaining(this ReceivableRow r) =>
        r.Status == "open" ? r.Balance(DateOnly.MinValue).TotalOutstandingCents : 0;

    public static ReceivableDto ToDto(this ReceivableRow r, DateOnly today)
    {
        var bal = r.Balance(today);
        var remaining = r.Status == "open" ? bal.TotalOutstandingCents : 0;
        var overdue = r.Status == "open" && remaining > 0 && r.DueDate is { } d && d < today;
        return new ReceivableDto(r.Id, r.CustomerId, r.CustomerName, r.Description, r.OriginalAmountCents, r.PaidCents,
            r.WrittenOffCents, remaining, r.IssueDate, r.DueDate, r.Status, overdue,
            overdue ? today.DayNumber - r.DueDate!.Value.DayNumber : 0, r.Notes, r.CreatedAt,
            r.Status == "open" ? bal.PrincipalOutstandingCents : 0, r.Status == "open" ? bal.ChargesOutstandingCents : 0, bal.ProposedChargesCents,
            r.Status == "settled" ? DebtStatuses.Settled : bal.Status, r.Disputed, r.Reference, r.ChargeTermsDisclosedAt is not null);
    }

    public static ReceivableDetailDto ToDetail(this ReceivableRow r, DateOnly today, IReadOnlyList<PaymentRow> payments)
    {
        var d = r.ToDto(today);
        return new ReceivableDetailDto(d.Id, d.CustomerId, d.CustomerName, d.Description, d.OriginalAmountCents, d.PaidCents,
            d.WrittenOffCents, d.RemainingCents, d.IssueDate, d.DueDate, d.Status, d.IsOverdue, d.DaysOverdue, d.Notes,
            d.CreatedAt, payments.Select(p => p.ToDto()).ToList(), d.PrincipalOutstandingCents, d.ChargesOutstandingCents, d.ProposedChargesCents,
            d.DebtStatus, r.Disputed, r.DisputeReason, r.Reference, r.ChargeTermsSnapshot);
    }

    public static long Remaining(this PayableRow p) =>
        p.Status == "open" ? BalanceMath.Remaining(p.OriginalAmountCents, Math.Min(p.PaidCents, p.OriginalAmountCents)) : 0;

    public static PayableDto ToDto(this PayableRow p, DateOnly today)
    {
        var remaining = p.Remaining();
        return new PayableDto(p.Id, p.SupplierId, p.SupplierName, p.Description, p.Category, p.OriginalAmountCents, p.PaidCents,
            remaining, p.BillDate, p.DueDate, p.Status, p.Status == "open" && remaining > 0 && p.DueDate < today,
            p.DueDate.DayNumber - today.DayNumber, p.Reference, p.Notes, p.CreatedAt);
    }

    public static PayableDetailDto ToDetail(this PayableRow p, DateOnly today, IReadOnlyList<PaymentRow> payments)
    {
        var d = p.ToDto(today);
        return new PayableDetailDto(d.Id, d.SupplierId, d.SupplierName, d.Description, d.Category, d.OriginalAmountCents,
            d.PaidCents, d.RemainingCents, d.BillDate, d.DueDate, d.Status, d.IsOverdue, d.DaysUntilDue, d.Reference, d.Notes,
            d.CreatedAt, payments.Select(x => x.ToDto()).ToList());
    }

    public static RecommendationDto ToDto(this RecommendationRow r) =>
        new(r.Id, r.RuleCode, r.Title, r.Severity, r.Explanation,
            JsonSerializer.Deserialize<List<EvidenceDto>>(r.Evidence, GrowthRepository.Json) ?? new(),
            JsonSerializer.Deserialize<List<RelevantDateDto>>(r.RelevantDates, GrowthRepository.Json) ?? new(),
            JsonSerializer.Deserialize<List<string>>(r.Actions, GrowthRepository.Json) ?? new(),
            r.EstimatedImpactCents, r.Status, r.ResolutionNote, r.CreatedAt, r.UpdatedAt);

    public static ForecastDto ToDto(this ForecastResult f) =>
        new(f.AsOf, f.HorizonDays, f.OpeningBalanceCents, f.CashBufferCents, f.OpeningBalanceConfigured,
            f.Days.Select(d => new ForecastDayDto(d.Date, d.OpeningBalanceCents, d.ScheduledInflowsCents, d.ExpectedInflowsCents,
                d.OutflowsCents, d.ExpectedClosingCents, d.ConservativeClosingCents, d.BelowBuffer, d.BelowZero,
                d.Events.Select(e => new ForecastEventDto(e.Kind, e.SourceType, e.SourceId, e.Description, e.Counterparty,
                    e.AmountCents, e.IsExpected, e.IsOverdueCarryForward)).ToList(), d.OptimisticClosingCents)).ToList(),
            new BalancePointDto(f.LowestExpected.Date, f.LowestExpected.BalanceCents),
            new BalancePointDto(f.LowestConservative.Date, f.LowestConservative.BalanceCents),
            f.FirstShortageDate, f.FirstBelowBufferDate, f.FirstConservativeShortageDate,
            new ForecastTotalsDto(f.TotalScheduledInflowsCents, f.TotalExpectedInflowsCents, f.TotalOutflowsCents),
            f.Excluded.Select(x => new ExcludedItemDto(x.SourceType, x.SourceId, x.Description, x.AmountCents, x.Reason)).ToList(),
            f.Assumptions,
            new BalancePointDto(f.LowestOptimistic.Date, f.LowestOptimistic.BalanceCents), f.TotalOptimisticExtraCents,
            f.IsPreliminary, f.PreliminaryReason, f.Scenarios.Select(x => new ScenarioDto(x.Key, x.Name, x.Assumption)).ToList());

    public static OpportunityDto ToDto(this OpportunityRow o) =>
        new(o.Id, o.Title, o.Description, o.Organisation, o.OpportunityType, o.Industry, o.EligibilityCriteria,
            JsonSerializer.Deserialize<List<string>>(o.RequiredDocuments) ?? new(), o.ApplicationDeadline, o.SourceUrl,
            o.GeographicScope, o.VerificationStatus, o.LastCheckedOn, o.BusinessId is not null,
            o.TrackingId is { } tid
                ? new TrackingDto(tid, o.ApplicationStatus ?? "saved", o.TrackingNotes, o.PersonalDeadline, o.TrackingUpdatedAt ?? DateTime.UtcNow)
                : null);

    public static FraudIncidentDto ToDto(this FraudIncidentRow f) =>
        new(f.Id, f.IncidentType, f.Description, f.IncidentDate, f.RelatedTransactionId, f.Status, f.ActionTaken,
            f.PrivateNotes, f.CreatedAt, f.UpdatedAt);

    public static CategoryBreakdownDto ToDto(this CategoryTotal c) => new(c.Type, c.Category, c.TotalCents, c.Count, c.SharePercent);

    public static MonthlyRowDto ToDto(this MonthlyTotal m) => new(m.Month, m.Label, m.IncomeCents, m.ExpensesCents, m.NetCents);
}
