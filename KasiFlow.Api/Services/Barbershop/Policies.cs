using System.Data;
using System.Text.Json;
using Dapper;
using KasiFlow.Api.Data;
using KasiFlow.Api.Middleware;
using KasiFlow.Api.Repositories;
using KasiFlow.Core.Access;
using KasiFlow.Core.Bookings;
using KasiFlow.Core.Common;
using KasiFlow.Core.Finance;
using KasiFlow.Core.Validation;

namespace KasiFlow.Api.Services.Barbershop;

public sealed class PolicyRow
{
    public bool BookingAutoConfirm { get; set; }
    public bool AllowOffDutyOverride { get; set; }
    public int SlotIntervalMinutes { get; set; } = 15;
    public int BookingLeadMinutes { get; set; } = 30;
    public int BookingHorizonDays { get; set; } = 30;
    public bool HouseCallsEnabled { get; set; }
    public string TravelFeeMode { get; set; } = "flat";
    public long TravelFeeFlatCents { get; set; }
    public long TravelFeePerKmCents { get; set; }
    public long MinTravelFeeCents { get; set; }
    public decimal? MaxTravelKm { get; set; }
    public bool DebtChargeEnabled { get; set; }
    public long DebtChargeCents { get; set; } = 500;
    public int DebtChargeOverdueDays { get; set; } = 7;
    public bool DebtChargeLegalReviewed { get; set; }
    public string? DebtChargeReviewedNote { get; set; }
    public string? DebtChargeTerms { get; set; }
    public int DebtChargePolicyVersion { get; set; }

    public TravelFeePolicy Travel => new(TravelFeeMode, TravelFeeFlatCents, TravelFeePerKmCents, MinTravelFeeCents, MaxTravelKm);
    public DebtChargePolicy DebtCharge => new(DebtChargeEnabled, DebtChargeLegalReviewed, DebtChargeCents, DebtChargeOverdueDays, DebtChargeTerms, DebtChargePolicyVersion);

    public string TravelFeeDescription => TravelFeeMode switch
    {
        "none" => "No travel fee for house calls.",
        "flat" => $"House calls have a flat travel fee of {Money.FormatZar(Math.Max(TravelFeeFlatCents, MinTravelFeeCents))}.",
        _ => $"House calls cost {Money.FormatZar(TravelFeePerKmCents)} per km (minimum {Money.FormatZar(MinTravelFeeCents)}). Distance is confirmed by the barber; any higher fee is proposed to you before it applies."
    } + (MaxTravelKm is { } m ? $" Service area: up to {m:0.#} km." : "");
}

public static class PolicyRepository
{
    public static async Task<PolicyRow> GetAsync(IDbConnection conn, Guid businessId, IDbTransaction? tx = null)
    {
        await conn.ExecuteAsync("INSERT INTO business_settings (business_id) VALUES (@B) ON CONFLICT (business_id) DO NOTHING", new { B = businessId }, tx);
        return await conn.QuerySingleAsync<PolicyRow>(
            """
            SELECT booking_auto_confirm, allow_off_duty_override, slot_interval_minutes, booking_lead_minutes, booking_horizon_days, house_calls_enabled,
                   travel_fee_mode, travel_fee_flat_cents, travel_fee_per_km_cents, min_travel_fee_cents, max_travel_km,
                   debt_charge_enabled, debt_charge_cents, debt_charge_overdue_days, debt_charge_legal_reviewed, debt_charge_reviewed_note,
                   debt_charge_terms, debt_charge_policy_version
            FROM business_settings WHERE business_id = @B
            """, new { B = businessId }, tx);
    }
}

public sealed record BookingPolicyDto(bool BookingAutoConfirm, bool AllowOffDutyOverride, int SlotIntervalMinutes, int BookingLeadMinutes,
    int BookingHorizonDays, bool HouseCallsEnabled, string TravelFeeMode, long TravelFeeFlatCents, long TravelFeePerKmCents,
    long MinTravelFeeCents, decimal? MaxTravelKm, string TravelFeeDescription, bool DistanceProviderConfigured);

public sealed record DebtChargePolicyDto(bool Enabled, long AmountCents, int OverdueDays, bool LegallyReviewed, string? ReviewedNote, string? Terms,
    int Version, bool AppliesToRealDebts, IReadOnlyList<string> Safeguards);

public sealed record DebtChargePolicyInput(bool Enabled, long? AmountCents, int? OverdueDays, bool LegallyReviewed, string? ReviewedNote, string? Terms);

/// <summary>Booking, travel-fee and debt-charge policies.</summary>
public sealed class PolicyService(IDbConnectionFactory db, IBusinessContext business)
{
    public static readonly IReadOnlyList<string> DebtSafeguards =
    [
        "One charge per qualifying event: when a debt becomes overdue by the set number of days. Never per day, never compounded.",
        "Applied only when the policy is enabled, marked as legally reviewed, and the terms were shown to the customer when the debt was created.",
        "Otherwise the charge is shown as 'proposed' only and is NOT added to what the customer owes.",
        "Disputed, settled and written-off debts never get charges. Charges can be waived or reversed with a reason, and every decision is logged.",
        "Changing the policy never changes debts that already exist: each debt keeps the terms that were shown at the time.",
        "A flat fee is not lawful for every kind of debt or customer agreement. Get advice before enabling it.",
    ];

    private static BookingPolicyDto ToBooking(PolicyRow p) =>
        new(p.BookingAutoConfirm, p.AllowOffDutyOverride, p.SlotIntervalMinutes, p.BookingLeadMinutes, p.BookingHorizonDays, p.HouseCallsEnabled,
            p.TravelFeeMode, p.TravelFeeFlatCents, p.TravelFeePerKmCents, p.MinTravelFeeCents, p.MaxTravelKm, p.TravelFeeDescription, false);

    private static DebtChargePolicyDto ToDebt(PolicyRow p) =>
        new(p.DebtChargeEnabled, p.DebtChargeCents, p.DebtChargeOverdueDays, p.DebtChargeLegalReviewed, p.DebtChargeReviewedNote, p.DebtChargeTerms,
            p.DebtChargePolicyVersion, p.DebtChargeEnabled && p.DebtChargeLegalReviewed && !string.IsNullOrWhiteSpace(p.DebtChargeTerms), DebtSafeguards);

    public async Task<BookingPolicyDto> GetBookingAsync(CancellationToken ct)
    {
        var access = await business.GetAccessAsync(ct);
        await using var conn = await db.OpenAsync(ct);
        return ToBooking(await PolicyRepository.GetAsync(conn, access.BusinessId));
    }

    public async Task<BookingPolicyDto> UpdateBookingAsync(BookingPolicyDto i, CancellationToken ct)
    {
        var access = await business.RequireAsync(Permission.ManageSettings);
        var e = new ValidationErrors();
        if (i.SlotIntervalMinutes is not (5 or 10 or 15 or 20 or 30 or 60)) e.Add("slotIntervalMinutes", "Choose 5, 10, 15, 20, 30 or 60 minutes.");
        if (i.BookingLeadMinutes is < 0 or > 2880) e.Add("bookingLeadMinutes", "Choose 0 to 2880 minutes.");
        if (i.BookingHorizonDays is < 1 or > 120) e.Add("bookingHorizonDays", "Choose 1 to 120 days.");
        if (i.TravelFeeMode is not ("none" or "flat" or "per_km")) e.Add("travelFeeMode", "Choose none, flat or per_km.");
        if (i.TravelFeeFlatCents is < 0 or > 10_000_000 || i.TravelFeePerKmCents is < 0 or > 1_000_000 || i.MinTravelFeeCents is < 0 or > 10_000_000)
            e.Add("travelFee", "Enter valid travel fee amounts.");
        if (i.MaxTravelKm is <= 0 or > 9999) e.Add("maxTravelKm", "Enter a positive distance or leave empty.");
        RequestValidationException.ThrowIfInvalid(e);
        await using var conn = await db.OpenAsync(ct);
        await PolicyRepository.GetAsync(conn, access.BusinessId);
        await conn.ExecuteAsync(
            """
            UPDATE business_settings SET booking_auto_confirm = @BookingAutoConfirm, allow_off_duty_override = @AllowOffDutyOverride,
                slot_interval_minutes = @SlotIntervalMinutes, booking_lead_minutes = @BookingLeadMinutes, booking_horizon_days = @BookingHorizonDays,
                house_calls_enabled = @HouseCallsEnabled, travel_fee_mode = @TravelFeeMode, travel_fee_flat_cents = @TravelFeeFlatCents,
                travel_fee_per_km_cents = @TravelFeePerKmCents, min_travel_fee_cents = @MinTravelFeeCents, max_travel_km = @MaxTravelKm, updated_at = now()
            WHERE business_id = @B
            """, new { B = access.BusinessId, i.BookingAutoConfirm, i.AllowOffDutyOverride, i.SlotIntervalMinutes, i.BookingLeadMinutes, i.BookingHorizonDays,
                i.HouseCallsEnabled, i.TravelFeeMode, i.TravelFeeFlatCents, i.TravelFeePerKmCents, i.MinTravelFeeCents, i.MaxTravelKm });
        await AuditRepository.WriteAsync(conn, null, access.BusinessId, access.UserId, "booking_policy_changed", "business_settings", access.BusinessId);
        return ToBooking(await PolicyRepository.GetAsync(conn, access.BusinessId));
    }

    public async Task<DebtChargePolicyDto> GetDebtAsync(CancellationToken ct)
    {
        var access = await business.RequireAsync(Permission.ViewFinancials, Permission.RecordDebtPayments, Permission.ConfigureDebtPolicy);
        await using var conn = await db.OpenAsync(ct);
        return ToDebt(await PolicyRepository.GetAsync(conn, access.BusinessId));
    }

    /// <summary>Owner only. Every change creates a new policy version; existing debts keep their disclosed terms.</summary>
    public async Task<DebtChargePolicyDto> UpdateDebtAsync(DebtChargePolicyInput i, CancellationToken ct)
    {
        var access = await business.RequireAsync(Permission.ConfigureDebtPolicy);
        var e = new ValidationErrors();
        if (i.AmountCents is not (> 0 and <= 100_000)) e.Add("amountCents", "Enter a charge between R0.01 and R1 000.");
        if (i.OverdueDays is not (>= 1 and <= 365)) e.Add("overdueDays", "Choose 1 to 365 days.");
        e.Optional("reviewedNote", i.ReviewedNote, 500);
        e.Optional("terms", i.Terms, 1000);
        if (i.Enabled && string.IsNullOrWhiteSpace(i.Terms)) e.Add("terms", "Write the terms customers will be shown before they agree.");
        if (i.LegallyReviewed && string.IsNullOrWhiteSpace(i.ReviewedNote)) e.Add("reviewedNote", "Say who reviewed the policy and when.");
        RequestValidationException.ThrowIfInvalid(e);
        await using var conn = await db.OpenAsync(ct);
        await PolicyRepository.GetAsync(conn, access.BusinessId);
        await conn.ExecuteAsync(
            """
            UPDATE business_settings SET debt_charge_enabled = @Enabled, debt_charge_cents = @Amount, debt_charge_overdue_days = @Days,
                debt_charge_legal_reviewed = @Reviewed, debt_charge_reviewed_note = @Note, debt_charge_terms = @Terms,
                debt_charge_policy_version = debt_charge_policy_version + 1, updated_at = now()
            WHERE business_id = @B
            """, new { B = access.BusinessId, i.Enabled, Amount = i.AmountCents, Days = i.OverdueDays, Reviewed = i.LegallyReviewed,
                Note = string.IsNullOrWhiteSpace(i.ReviewedNote) ? null : i.ReviewedNote.Trim(), Terms = string.IsNullOrWhiteSpace(i.Terms) ? null : i.Terms.Trim() });
        await AuditRepository.WriteAsync(conn, null, access.BusinessId, access.UserId, "debt_charge_policy_changed", "business_settings", access.BusinessId,
            JsonSerializer.Serialize(new { enabled = i.Enabled, legallyReviewed = i.LegallyReviewed, overdueDays = i.OverdueDays }));
        return ToDebt(await PolicyRepository.GetAsync(conn, access.BusinessId));
    }
}
