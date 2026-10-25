using KasiFlow.Api.DTOs;
using KasiFlow.Api.Services.Barbershop;
using KasiFlow.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;

namespace KasiFlow.Api.Controllers;

[Route("api/workspace")]
public sealed class WorkspaceController(WorkspaceService service) : ApiControllerBase
{
    [HttpGet] public Task<WorkspaceDto> Get(CancellationToken ct) => service.GetAsync(ct);
}

[Route("api/team")]
public sealed class TeamController(TeamService service) : ApiControllerBase
{
    [HttpGet] public Task<IReadOnlyList<StaffProfileDto>> List(CancellationToken ct) => service.ListAsync(ct);

    [HttpPost]
    [EnableRateLimiting("writes")]
    public Task<StaffProfileDto> Create(StaffProfileInput input, CancellationToken ct) => service.CreateAsync(input, ct);

    [HttpPut("{id:guid}")] public Task<StaffProfileDto> Update(Guid id, StaffProfileInput input, CancellationToken ct) => service.UpdateAsync(id, input, ct);

    [HttpPut("{id:guid}/status")]
    [EnableRateLimiting("writes")]
    public Task<StaffStatusDto> SetStatus(Guid id, StatusInput input, CancellationToken ct) => service.SetStatusAsync(id, input, ct);

    [HttpGet("{id:guid}/status-history")] public Task<IReadOnlyList<StatusHistoryDto>> History(Guid id, CancellationToken ct) => service.HistoryAsync(id, ct);

    [HttpPut("{id:guid}/hours")]
    public Task<IReadOnlyList<WorkingHoursDto>> SetHours(Guid id, IReadOnlyList<WorkingHoursDto> input, CancellationToken ct) => service.SetHoursAsync(id, input, ct);

    [HttpGet("{id:guid}/time-off")] public Task<IReadOnlyList<TimeOffDto>> TimeOff(Guid id, CancellationToken ct) => service.TimeOffAsync(id, ct);

    [HttpPost("{id:guid}/time-off")]
    [EnableRateLimiting("writes")]
    public Task<TimeOffDto> AddTimeOff(Guid id, TimeOffInput input, CancellationToken ct) => service.AddTimeOffAsync(id, input, ct);

    [HttpDelete("{id:guid}/time-off/{timeOffId:guid}")]
    public async Task<IActionResult> DeleteTimeOff(Guid id, Guid timeOffId, CancellationToken ct) { await service.DeleteTimeOffAsync(id, timeOffId, ct); return NoContent(); }

    [HttpPost("register-barber")]
    [EnableRateLimiting("writes")]
    public Task<RegisterBarberResultDto> Register(RegisterBarberInput input, CancellationToken ct) => service.RegisterBarberAsync(input, ct);

    [HttpPost("{id:guid}/login-invite")]
    [EnableRateLimiting("writes")]
    public Task<RegisterBarberResultDto> InviteLogin(Guid id, LoginInviteInput input, CancellationToken ct) => service.InviteLoginAsync(id, input, ct);

    [HttpPut("{id:guid}/services")]
    public Task<IReadOnlyList<StaffServiceDto>> SetServices(Guid id, IReadOnlyList<StaffServiceInput> input, CancellationToken ct) => service.SetServicesAsync(id, input, ct);
}

[Route("api/team/{staffId:guid}/portfolio")]
public sealed class PortfolioController(PortfolioService service) : ApiControllerBase
{
    [HttpGet] public Task<IReadOnlyList<PortfolioPhotoDto>> List(Guid staffId, CancellationToken ct) => service.ListAsync(staffId, ct);

    [HttpPost]
    [EnableRateLimiting("writes")]
    [RequestSizeLimit(PortfolioService.MaxBytes + 64 * 1024)]
    [Consumes("multipart/form-data")]
    public Task<PortfolioPhotoDto> Upload(Guid staffId, IFormFile? file, [FromForm] string? caption, [FromForm] Guid? serviceId,
        [FromForm] bool consentConfirmed, [FromForm] bool? isPublic, CancellationToken ct) =>
        service.UploadAsync(staffId, file, caption, serviceId, consentConfirmed, isPublic, ct);

    [HttpPut("{photoId:guid}")]
    public Task<PortfolioPhotoDto> Update(Guid staffId, Guid photoId, PortfolioUpdateInput input, CancellationToken ct) => service.UpdateAsync(staffId, photoId, input, ct);

    [HttpDelete("{photoId:guid}")]
    public async Task<IActionResult> Delete(Guid staffId, Guid photoId, CancellationToken ct)
    {
        await service.DeleteAsync(staffId, photoId, ct);
        return NoContent();
    }

    [HttpGet("{photoId:guid}/file")]
    public async Task<IActionResult> File(Guid staffId, Guid photoId, CancellationToken ct)
    {
        var (content, type) = await service.FileAsync(staffId, photoId, ct);
        Response.Headers["X-Content-Type-Options"] = "nosniff";
        Response.Headers["Cache-Control"] = "private, max-age=300";
        return File(content, type);
    }
}

[Route("api/services")]
public sealed class ServicesController(ServiceCatalogService service) : ApiControllerBase
{
    [HttpGet] public Task<IReadOnlyList<ServiceDto>> List([FromQuery] bool includeInactive = false, CancellationToken ct = default) => service.ListAsync(includeInactive, ct);

    [HttpPost]
    [EnableRateLimiting("writes")]
    public Task<ServiceDto> Create(ServiceInput input, CancellationToken ct) => service.CreateAsync(input, ct);

    [HttpPut("{id:guid}")] public Task<ServiceDto> Update(Guid id, ServiceInput input, CancellationToken ct) => service.UpdateAsync(id, input, ct);
}

[Route("api/policies")]
public sealed class PoliciesController(PolicyService service) : ApiControllerBase
{
    [HttpGet("booking")] public Task<BookingPolicyDto> Booking(CancellationToken ct) => service.GetBookingAsync(ct);
    [HttpPut("booking")] public Task<BookingPolicyDto> UpdateBooking(BookingPolicyDto input, CancellationToken ct) => service.UpdateBookingAsync(input, ct);
    [HttpGet("debt-charge")] public Task<DebtChargePolicyDto> DebtCharge(CancellationToken ct) => service.GetDebtAsync(ct);
    [HttpPut("debt-charge")] public Task<DebtChargePolicyDto> UpdateDebtCharge(DebtChargePolicyInput input, CancellationToken ct) => service.UpdateDebtAsync(input, ct);
}

[Route("api/bookings")]
public sealed class BookingsController(BookingService service) : ApiControllerBase
{
    [HttpGet]
    public Task<IReadOnlyList<BookingSummaryDto>> List([FromQuery] DateOnly? from, [FromQuery] DateOnly? to, [FromQuery] string? status,
        [FromQuery] Guid? staffId, [FromQuery] string? locationType, CancellationToken ct) => service.ListAsync(from, to, status, staffId, locationType, ct);

    [HttpGet("availability")]
    public Task<AvailabilityDto> Availability([FromQuery] DateOnly date, [FromQuery] string? serviceIds, [FromQuery] Guid? staffId, [FromQuery] string? locationType, CancellationToken ct) =>
        service.AvailabilityForMemberAsync(date, ParseIds(serviceIds), staffId, locationType, ct);

    [HttpPost("quote")] public Task<QuoteDto> Quote(BookingInput input, CancellationToken ct) => service.QuoteAsync(input, ct);

    [HttpPost]
    [EnableRateLimiting("writes")]
    public Task<BookingDetailDto> Create(BookingInput input, CancellationToken ct) => service.CreateAsync(input, ct);

    [HttpGet("{id:guid}")] public Task<BookingDetailDto> Get(Guid id, CancellationToken ct) => service.GetAsync(id, ct);
    [HttpPost("{id:guid}/confirm")] public Task<BookingDetailDto> Confirm(Guid id, ConfirmInput input, CancellationToken ct) => service.ConfirmAsync(id, input, ct);
    [HttpPost("{id:guid}/propose")] public Task<BookingDetailDto> Propose(Guid id, ProposeInput input, CancellationToken ct) => service.ProposeAsync(id, input, ct);
    [HttpPost("{id:guid}/accept-proposal")] public Task<BookingDetailDto> Accept(Guid id, ReasonInput input, CancellationToken ct) => service.AnswerCustomerProposalAsync(id, true, input, ct);
    [HttpPost("{id:guid}/reject-proposal")] public Task<BookingDetailDto> Reject(Guid id, ReasonInput input, CancellationToken ct) => service.AnswerCustomerProposalAsync(id, false, input, ct);
    [HttpPost("{id:guid}/complete")] public Task<BookingDetailDto> Complete(Guid id, CompleteInput input, CancellationToken ct) => service.CompleteAsync(id, input, ct);
    [HttpPost("{id:guid}/no-show")] public Task<BookingDetailDto> NoShow(Guid id, ReasonInput input, CancellationToken ct) => service.NoShowAsync(id, input, ct);
    [HttpPost("{id:guid}/cancel")] public Task<BookingDetailDto> Cancel(Guid id, ReasonInput input, CancellationToken ct) => service.CancelAsync(id, input, ct);
    [HttpPut("{id:guid}/house-call")] public Task<BookingDetailDto> HouseCall(Guid id, HouseCallUpdateInput input, CancellationToken ct) => service.UpdateHouseCallAsync(id, input, ct);
    [HttpGet("{id:guid}/safety")]
    public Task<HouseCallSafetyDto> Safety(Guid id, [FromServices] HouseCallSafetyService safety, CancellationToken ct) => safety.GetAsync(id, ct);

    [HttpPost("{id:guid}/safety/check-ins")]
    [EnableRateLimiting("writes")]
    public Task<HouseCallSafetyDto> CheckIn(Guid id, SafetyCheckinInput input, [FromServices] HouseCallSafetyService safety, CancellationToken ct) =>
        safety.CheckInAsync(id, input, ct);

    [HttpGet("{id:guid}/customer-account")]
    public Task<CustomerAccountSummaryDto> CustomerAccount(Guid id, [FromServices] CustomerSafetyService customers, CancellationToken ct) => customers.ForBookingAsync(id, ct);

    [HttpPost("{id:guid}/safety-notes")]
    [EnableRateLimiting("writes")]
    public Task<CustomerAccountSummaryDto> SafetyNote(Guid id, SafetyNoteInput input, [FromServices] CustomerSafetyService customers, CancellationToken ct) =>
        customers.AddNoteAsync(id, input, ct);

    [HttpPost("{id:guid}/expenses")] public Task<BookingDetailDto> Expense(Guid id, VisitExpenseInput input, CancellationToken ct) => service.AddVisitExpenseAsync(id, input, ct);

    internal static IReadOnlyList<Guid> ParseIds(string? ids) =>
        (ids ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).Select(x => Guid.TryParse(x, out var g) ? g : Guid.Empty)
        .Where(g => g != Guid.Empty).Take(20).ToList();
}

[Route("api/house-calls")]
public sealed class HouseCallsController(BookingService service) : ApiControllerBase
{
    [HttpGet] public Task<IReadOnlyList<BookingService.HouseCallListItemDto>> List([FromQuery] DateOnly? from, [FromQuery] DateOnly? to, CancellationToken ct) => service.HouseCallsAsync(from, to, ct);
}

/// <summary>Anonymous customer booking from a published profile. Rate limited per IP.</summary>
[ApiController]
[AllowAnonymous]
[EnableRateLimiting("public")]
[Route("api/public")]
public sealed class PublicBookingController(PublicBookingService service) : ControllerBase
{
    [HttpGet("profiles/{slug}/queue")]
    public Task<PublicQueueDto> Queue(string slug, [FromServices] QueueService queue, CancellationToken ct) => queue.PublicSnapshotAsync(slug, ct);

    [HttpGet("queue/{id:guid}")]
    public Task<PublicTicketDto> Ticket(Guid id, [FromQuery] string? t, [FromServices] QueueService queue, CancellationToken ct) => queue.TicketAsync(id, t, ct);

    [HttpPost("queue/{id:guid}/leave")]
    public Task<PublicTicketDto> Leave(Guid id, PublicActionInput input, [FromServices] QueueService queue, CancellationToken ct) => queue.LeaveAsync(id, input, ct);

    [HttpGet("shops")]
    public Task<IReadOnlyList<ShopCardDto>> Shops([FromQuery] string? q, [FromServices] ShopDirectoryService shops, CancellationToken ct) => shops.ListAsync(q, ct);

    [HttpGet("profiles/{slug}/booking")] public Task<PublicBookingInfoDto> Info(string slug, CancellationToken ct) => service.InfoAsync(slug, ct);

    [HttpGet("profiles/{slug}/availability")]
    public Task<AvailabilityDto> Availability(string slug, [FromQuery] DateOnly date, [FromQuery] string? serviceIds, [FromQuery] Guid? staffId,
        [FromQuery] string? locationType, CancellationToken ct) => service.AvailabilityAsync(slug, date, serviceIds, staffId, locationType, ct);

    [HttpGet("profiles/{slug}/photos/{id:guid}")]
    public async Task<IActionResult> Photo(string slug, Guid id, CancellationToken ct)
    {
        var (content, type) = await service.PhotoAsync(slug, id, ct);
        Response.Headers["X-Content-Type-Options"] = "nosniff";
        Response.Headers["Cache-Control"] = "public, max-age=3600";
        return File(content, type);
    }

    [HttpGet("bookings/{reference}")]
    public Task<PublicBookingStatusDto> Status(string reference, [FromQuery] string? t, CancellationToken ct) => service.StatusAsync(reference, t, ct);

    [HttpPost("bookings/{reference}/{op}")]
    public Task<PublicBookingStatusDto> Act(string reference, string op, PublicActionInput input, CancellationToken ct) => service.ActAsync(reference, op, input, ct);
}

[Route("api/debts")]
public sealed class DebtsController(DebtService service) : ApiControllerBase
{
    [HttpGet("overdue-report")] public Task<OverdueReportDto> Overdue(CancellationToken ct) => service.OverdueReportAsync(ct);
    [HttpGet("{id:guid}/account")] public Task<DebtAccountDto> Account(Guid id, CancellationToken ct) => service.AccountAsync(id, ct);
    [HttpPost("{id:guid}/dispute")] public Task<DebtAccountDto> Dispute(Guid id, ReasonInput input, CancellationToken ct) => service.DisputeAsync(id, input, true, ct);
    [HttpPost("{id:guid}/resolve-dispute")] public Task<DebtAccountDto> Resolve(Guid id, ReasonInput input, CancellationToken ct) => service.DisputeAsync(id, input, false, ct);
    [HttpPost("{id:guid}/reminders")] public Task<DebtAccountDto> Reminder(Guid id, ReminderInput input, CancellationToken ct) => service.AddReminderAsync(id, input, ct);

    [HttpPost("{id:guid}/charges/{chargeId:guid}/{decision}")]
    public Task<DebtAccountDto> Charge(Guid id, Guid chargeId, string decision, ReasonInput input, CancellationToken ct) => service.DecideChargeAsync(id, chargeId, decision, input, ct);

    [HttpPost("evaluate-charges")] public async Task<object> Evaluate(CancellationToken ct) => new { changed = await service.EvaluateChargesAsync(ct) };
}

[Route("api/money")]
public sealed class MoneyController(MoneyService service) : ApiControllerBase
{
    [HttpGet("summary")]
    public Task<MoneySummaryDto> Summary([FromQuery] string? period, [FromQuery] DateOnly? date, CancellationToken ct) => service.SummaryAsync(period, date, ct);
}

[Route("api/alerts")]
public sealed class AlertsController(AlertService service) : ApiControllerBase
{
    [HttpGet] public Task<AlertSummaryDto> List([FromQuery] string? status, [FromQuery] string? severity, CancellationToken ct) => service.ListAsync(status, severity, ct);
    [HttpPost("{id:guid}/status")] public Task<AlertDto> SetStatus(Guid id, AlertStatusInput input, CancellationToken ct) => service.SetStatusAsync(id, input, ct);
}

[Route("api/payment-proofs")]
public sealed class PaymentProofsController(PaymentProofService service) : ApiControllerBase
{
    [HttpGet] public Task<IReadOnlyList<PaymentProofDto>> List([FromQuery] string? status, CancellationToken ct) => service.ListAsync(status, ct);

    [HttpPost]
    [EnableRateLimiting("writes")]
    [RequestSizeLimit(PaymentProofService.MaxBytes + 64 * 1024)]
    [Consumes("multipart/form-data")]
    public Task<PaymentProofDto> Upload(IFormFile? file, [FromForm] Guid? transactionId, [FromForm] Guid? bookingId, [FromForm] Guid? receivableId,
        [FromForm] long? claimedAmountCents, [FromForm] string? claimedReference, [FromForm] string? payerName, CancellationToken ct) =>
        service.UploadAsync(file, transactionId, bookingId, receivableId, claimedAmountCents, claimedReference, payerName, ct);

    [HttpGet("{id:guid}/file")]
    public async Task<IActionResult> File(Guid id, CancellationToken ct)
    {
        var (content, type, name) = await service.FileAsync(id, ct);
        Response.Headers["X-Content-Type-Options"] = "nosniff";
        return File(content, type, name);
    }

    [HttpPost("{id:guid}/confirm-in-bank")] public Task<PaymentProofDto> Confirm(Guid id, ProofDecisionInput input, CancellationToken ct) => service.DecideAsync(id, true, input, ct);
    [HttpPost("{id:guid}/reject")] public Task<PaymentProofDto> Reject(Guid id, ProofDecisionInput input, CancellationToken ct) => service.DecideAsync(id, false, input, ct);
}

[Route("api/suppliers/{supplierId:guid}/bank-details")]
public sealed class SupplierBankController(SupplierBankService service) : ApiControllerBase
{
    [HttpGet] public Task<IReadOnlyList<SupplierBankDetailDto>> List(Guid supplierId, CancellationToken ct) => service.ListAsync(supplierId, ct);
    [HttpPost] public Task<IReadOnlyList<SupplierBankDetailDto>> Add(Guid supplierId, SupplierBankInput input, CancellationToken ct) => service.AddAsync(supplierId, input, ct);
    [HttpPost("{id:guid}/verify")] public Task<IReadOnlyList<SupplierBankDetailDto>> Verify(Guid supplierId, Guid id, VerifyBankInput input, CancellationToken ct) => service.DecideAsync(supplierId, id, true, input, ct);
    [HttpPost("{id:guid}/reject")] public Task<IReadOnlyList<SupplierBankDetailDto>> Reject(Guid supplierId, Guid id, VerifyBankInput input, CancellationToken ct) => service.DecideAsync(supplierId, id, false, input, ct);
}

/// <summary>Booking from a public profile needs a customer signed in with a one-time code (no business access is involved).</summary>
[Route("api/public")]
[EnableRateLimiting("public")]
public sealed class PublicBookingCreateController(PublicBookingService service) : ApiControllerBase
{
    [HttpPost("profiles/{slug}/queue")]
    public Task<PublicTicketCreatedDto> JoinQueue(string slug, QueueJoinInput input, [FromServices] QueueService queue, CancellationToken ct) => queue.JoinAsync(slug, input, ct);

    [HttpPost("profiles/{slug}/bookings")]
    public Task<PublicBookingCreatedDto> Create(string slug, PublicBookingInput input, CancellationToken ct) => service.CreateAsync(slug, input, ct);
}

/// <summary>The signed-in customer's own account and bookings (across businesses). Never business data.</summary>
[Route("api/customer")]
[EnableRateLimiting("writes")]
public sealed class CustomerController(CustomerAccountService service) : ApiControllerBase
{
    [HttpGet("me")] public Task<CustomerAccountDto> Me(CancellationToken ct) => service.MeAsync(ct);
    [HttpPut("me")] public Task<CustomerAccountDto> Update(CustomerAccountInput input, CancellationToken ct) => service.UpdateAsync(input, ct);

    [HttpDelete("me")]
    public async Task<IActionResult> Delete(CancellationToken ct)
    {
        await service.DeleteAsync(ct);
        return NoContent();
    }

    [HttpGet("bookings")] public Task<IReadOnlyList<CustomerBookingDto>> Bookings(CancellationToken ct) => service.BookingsAsync(ct);
    [HttpGet("bookings/{reference}")] public Task<PublicBookingStatusDto> Booking(string reference, CancellationToken ct) => service.BookingAsync(reference, ct);

    [HttpPost("bookings/{reference}/{op}")]
    public Task<PublicBookingStatusDto> Act(string reference, string op, PublicActionInput input, CancellationToken ct) => service.ActAsync(reference, op, input, ct);
}

[Route("api/customer-accounts/{userId:guid}/house-call-block")]
[EnableRateLimiting("writes")]
public sealed class CustomerBlocksController(CustomerSafetyService service) : ApiControllerBase
{
    [HttpPost] public Task<CustomerAccountSummaryDto> Block(Guid userId, ReasonInput input, CancellationToken ct) => service.BlockAsync(userId, true, input, ct);
    [HttpPost("lift")] public Task<CustomerAccountSummaryDto> Lift(Guid userId, ReasonInput input, CancellationToken ct) => service.BlockAsync(userId, false, input, ct);
}

/// <summary>The manager's "today on the floor" screen. No money totals or trends (owner only).</summary>
[Route("api/floor")]
public sealed class FloorController(FloorService service) : ApiControllerBase
{
    [HttpGet] public Task<FloorDto> Today(CancellationToken ct) => service.TodayAsync(ct);
}

/// <summary>Walk-in queue for the front desk and barbers.</summary>
[Route("api/queue")]
public sealed class QueueController(QueueService service) : ApiControllerBase
{
    [HttpGet] public Task<QueueBoardDto> Board(CancellationToken ct) => service.BoardAsync(ct);

    [HttpPost]
    [EnableRateLimiting("writes")]
    public Task<QueueBoardDto> Add(QueueJoinInput input, CancellationToken ct) => service.AddAsync(input, ct);

    [HttpPost("{id:guid}/{op}")]
    [EnableRateLimiting("writes")]
    public Task<QueueBoardDto> Act(Guid id, string op, QueueActionInput input, CancellationToken ct) =>
        op is "call" or "start" or "requeue" or "done" or "left" or "no-show"
            ? service.ActAsync(id, op == "no-show" ? "no_show" : op, input, ct)
            : throw new KasiFlow.Api.Middleware.NotFoundException();
}

/// <summary>Barber pay: terms, own earnings statements, owner payroll and payouts.</summary>
[Route("api")]
public sealed class PayController(PayService service) : ApiControllerBase
{
    [HttpGet("team/{id:guid}/pay-terms")] public Task<PayTermsDto> Terms(Guid id, CancellationToken ct) => service.GetTermsAsync(id, ct);

    [HttpPut("team/{id:guid}/pay-terms")]
    [EnableRateLimiting("writes")]
    public Task<PayTermsDto> SetTerms(Guid id, PayTermsInput input, CancellationToken ct) => service.SetTermsAsync(id, input, ct);

    [HttpGet("team/{id:guid}/earnings")]
    public Task<EarningsDto> Earnings(Guid id, [FromQuery] DateOnly? from, [FromQuery] DateOnly? to, CancellationToken ct) => service.EarningsAsync(id, from, to, ct);

    [HttpGet("payroll")]
    public Task<PayrollDto> Payroll([FromQuery] DateOnly? from, [FromQuery] DateOnly? to, CancellationToken ct) => service.PayrollAsync(from, to, ct);

    [HttpPost("payroll/payouts")]
    [EnableRateLimiting("writes")]
    public Task<EarningsDto> Payout(PayoutInput input, CancellationToken ct) => service.PayoutAsync(input, ct);
}

[Route("api/house-calls/map")]
public sealed class HouseCallMapController(HouseCallMapService service) : ApiControllerBase
{
    [HttpGet] public Task<HouseCallMapDto> Today([FromQuery] DateOnly? date, CancellationToken ct) => service.TodayAsync(date, ct);
}

[Route("api/insights/shop")]
public sealed class ShopInsightsController(ShopInsightsService service) : ApiControllerBase
{
    [HttpGet] public Task<ShopInsightsDto> Get([FromQuery] int? days, CancellationToken ct) => service.GetAsync(days, ct);
}
