using KasiFlow.Api.DTOs;
using KasiFlow.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;

namespace KasiFlow.Api.Controllers;

// Controllers are deliberately thin: validation, authorisation scoping and business rules live in services.
// Every controller except PublicProfilesController requires an authenticated user (see [Authorize]).

[ApiController]
[Authorize]
[Produces("application/json")]
public abstract class ApiControllerBase : ControllerBase;

[Route("api/me")]
public sealed class MeController(BusinessService service) : ApiControllerBase
{
    [HttpGet] public Task<MeDto> Get(CancellationToken ct) => service.MeAsync(ct);
}

[Route("api/businesses")]
public sealed class BusinessesController(BusinessService service) : ApiControllerBase
{
    [HttpGet] public Task<IReadOnlyList<BusinessDto>> List(CancellationToken ct) => service.ListAsync(ct);

    [HttpPost]
    [EnableRateLimiting("writes")]
    public async Task<ActionResult<BusinessDto>> Create(BusinessInput input, CancellationToken ct)
    {
        var b = await service.CreateAsync(input, ct);
        return CreatedAtAction(nameof(Get), new { id = b.Id }, b);
    }

    [HttpGet("{id:guid}")] public Task<BusinessDto> Get(Guid id, CancellationToken ct) => service.GetAsync(id, ct);
    [HttpPut("{id:guid}")] public Task<BusinessDto> Update(Guid id, BusinessInput input, CancellationToken ct) => service.UpdateAsync(id, input, ct);
}

[Route("api/settings")]
public sealed class SettingsController(BusinessService service) : ApiControllerBase
{
    [HttpGet] public Task<SettingsDto> Get(CancellationToken ct) => service.GetSettingsAsync(ct);
    [HttpPut] public Task<SettingsDto> Update(SettingsDto input, CancellationToken ct) => service.UpdateSettingsAsync(input, ct);
}

[Route("api/dashboard")]
public sealed class DashboardController(DashboardService dashboard, TransactionService transactions) : ApiControllerBase
{
    [HttpGet("summary")]
    public Task<DashboardSummaryDto> Summary([FromQuery] string? period, [FromQuery] DateOnly? from, [FromQuery] DateOnly? to, CancellationToken ct) =>
        dashboard.SummaryAsync(period, from, to, ct);

    [HttpGet("recent-transactions")]
    public Task<IReadOnlyList<TransactionDto>> Recent([FromQuery] int limit = 8, CancellationToken ct = default) => transactions.RecentAsync(limit, ct);
}

[Route("api/transactions")]
public sealed class TransactionsController(TransactionService service) : ApiControllerBase
{
    [HttpGet]
    public Task<PagedResult<TransactionDto>> List([FromQuery] string? type, [FromQuery] string? category, [FromQuery] string? status,
        [FromQuery] DateOnly? from, [FromQuery] DateOnly? to, [FromQuery] string? search, [FromQuery] int page = 1,
        [FromQuery] int pageSize = 20, [FromQuery] Guid? branchId = null, [FromQuery] string? origin = null, CancellationToken ct = default) =>
        service.ListAsync(new TransactionQuery(type, category, status, from, to, search, page, pageSize, branchId, origin), ct);

    [HttpGet("categories")]
    public CategoriesDto Categories() => new(Core.Domain.Categories.Income, Core.Domain.Categories.Expense);

    [HttpPost]
    [EnableRateLimiting("writes")]
    public async Task<ActionResult<TransactionDto>> Create(TransactionInput input, [FromHeader(Name = "Idempotency-Key")] string? idempotencyKey, CancellationToken ct)
    {
        var t = await service.CreateAsync(input, ct, idempotencyKey);
        return CreatedAtAction(nameof(Get), new { id = t.Id }, t);
    }

    [HttpGet("{id:guid}")] public Task<TransactionDto> Get(Guid id, CancellationToken ct) => service.GetAsync(id, ct);
    [HttpPut("{id:guid}")] public Task<TransactionDto> Update(Guid id, TransactionInput input, CancellationToken ct) => service.UpdateAsync(id, input, ct);
    [HttpPost("{id:guid}/void")] public Task<TransactionDto> Void(Guid id, VoidInput input, CancellationToken ct) => service.VoidAsync(id, input, ct);
}

[Route("api/customers")]
public sealed class CustomersController(ContactService service) : ApiControllerBase
{
    [HttpGet]
    public Task<IReadOnlyList<CustomerDto>> List([FromQuery] string? search, [FromQuery] bool includeArchived = false, CancellationToken ct = default) =>
        service.ListCustomersAsync(search, includeArchived, ct);

    [HttpPost]
    [EnableRateLimiting("writes")]
    public async Task<ActionResult<CustomerDto>> Create(ContactInput input, CancellationToken ct)
    {
        var c = await service.CreateCustomerAsync(input, ct);
        return CreatedAtAction(nameof(Get), new { id = c.Id }, c);
    }

    [HttpGet("{id:guid}")] public Task<CustomerDto> Get(Guid id, CancellationToken ct) => service.GetCustomerAsync(id, ct);
    [HttpPut("{id:guid}")] public Task<CustomerDto> Update(Guid id, ContactInput input, CancellationToken ct) => service.UpdateCustomerAsync(id, input, ct);
}

[Route("api/suppliers")]
public sealed class SuppliersController(ContactService service) : ApiControllerBase
{
    [HttpGet]
    public Task<IReadOnlyList<SupplierDto>> List([FromQuery] string? search, [FromQuery] bool includeArchived = false, CancellationToken ct = default) =>
        service.ListSuppliersAsync(search, includeArchived, ct);

    [HttpPost]
    [EnableRateLimiting("writes")]
    public async Task<ActionResult<SupplierDto>> Create(ContactInput input, CancellationToken ct)
    {
        var s = await service.CreateSupplierAsync(input, ct);
        return CreatedAtAction(nameof(Get), new { id = s.Id }, s);
    }

    [HttpGet("{id:guid}")] public Task<SupplierDto> Get(Guid id, CancellationToken ct) => service.GetSupplierAsync(id, ct);
    [HttpPut("{id:guid}")] public Task<SupplierDto> Update(Guid id, ContactInput input, CancellationToken ct) => service.UpdateSupplierAsync(id, input, ct);
}

[Route("api/receivables")]
public sealed class ReceivablesController(ReceivableService service) : ApiControllerBase
{
    [HttpGet]
    public Task<PagedResult<ReceivableDto>> List([FromQuery] string? status, [FromQuery] string? filter, [FromQuery] Guid? customerId,
        [FromQuery] int page = 1, [FromQuery] int pageSize = 20, CancellationToken ct = default) =>
        service.ListAsync(status, filter, customerId, page, pageSize, ct);

    [HttpGet("summary")] public Task<ReceivableSummaryDto> Summary(CancellationToken ct) => service.SummaryAsync(ct);

    [HttpPost]
    [EnableRateLimiting("writes")]
    public async Task<ActionResult<ReceivableDetailDto>> Create(ReceivableInput input, CancellationToken ct)
    {
        var r = await service.CreateAsync(input, ct);
        return CreatedAtAction(nameof(Get), new { id = r.Id }, r);
    }

    [HttpGet("{id:guid}")] public Task<ReceivableDetailDto> Get(Guid id, CancellationToken ct) => service.GetAsync(id, ct);

    [HttpPost("{id:guid}/payments")]
    [EnableRateLimiting("writes")]
    public Task<ReceivableDetailDto> Pay(Guid id, PaymentInput input, CancellationToken ct) => service.RecordPaymentAsync(id, input, ct);

    [HttpPost("{id:guid}/write-off")]
    public Task<ReceivableDetailDto> WriteOff(Guid id, ReasonInput input, CancellationToken ct) => service.WriteOffAsync(id, input, ct);
}

[Route("api/payables")]
public sealed class PayablesController(PayableService service) : ApiControllerBase
{
    [HttpGet]
    public Task<PagedResult<PayableDto>> List([FromQuery] string? status, [FromQuery] string? filter, [FromQuery] Guid? supplierId,
        [FromQuery] int page = 1, [FromQuery] int pageSize = 20, CancellationToken ct = default) =>
        service.ListAsync(status, filter, supplierId, page, pageSize, ct);

    [HttpGet("summary")] public Task<PayableSummaryDto> Summary(CancellationToken ct) => service.SummaryAsync(ct);

    [HttpPost]
    [EnableRateLimiting("writes")]
    public async Task<ActionResult<PayableDetailDto>> Create(PayableInput input, CancellationToken ct)
    {
        var p = await service.CreateAsync(input, ct);
        return CreatedAtAction(nameof(Get), new { id = p.Id }, p);
    }

    [HttpGet("{id:guid}")] public Task<PayableDetailDto> Get(Guid id, CancellationToken ct) => service.GetAsync(id, ct);

    [HttpPost("{id:guid}/payments")]
    [EnableRateLimiting("writes")]
    public Task<PayableDetailDto> Pay(Guid id, PaymentInput input, CancellationToken ct) => service.RecordPaymentAsync(id, input, ct);

    [HttpPost("{id:guid}/cancel")]
    public Task<PayableDetailDto> Cancel(Guid id, ReasonInput input, CancellationToken ct) => service.CancelAsync(id, input, ct);
}

[Route("api/growth")]
public sealed class GrowthController(GrowthService service) : ApiControllerBase
{
    [HttpGet("forecast")] public Task<ForecastDto> Forecast([FromQuery] int? days, CancellationToken ct) => service.GetForecastAsync(days, ct);

    [HttpGet("recommendations")]
    public Task<IReadOnlyList<RecommendationDto>> Recommendations([FromQuery] string? status, [FromQuery] string? severity, CancellationToken ct) =>
        service.ListAsync(status, severity, ct);

    [HttpPatch("recommendations/{id:guid}")]
    public Task<RecommendationDto> Update(Guid id, RecommendationStatusInput input, CancellationToken ct) => service.UpdateStatusAsync(id, input, ct);

    [HttpPost("refresh")]
    [EnableRateLimiting("writes")]
    public Task<RefreshResultDto> Refresh(CancellationToken ct) => service.RefreshAsync(ct);

    [HttpGet("rules")] public IReadOnlyList<GrowthRuleDto> Rules() => service.Rules();
}

[Route("api/opportunities")]
public sealed class OpportunitiesController(OpportunityService service) : ApiControllerBase
{
    [HttpGet]
    public Task<IReadOnlyList<OpportunityDto>> List([FromQuery] string? type, [FromQuery] string? verification, [FromQuery] string? search,
        [FromQuery] bool savedOnly = false, CancellationToken ct = default) => service.ListAsync(type, verification, search, savedOnly, ct);

    [HttpGet("{id:guid}")] public Task<OpportunityDto> Get(Guid id, CancellationToken ct) => service.GetAsync(id, ct);

    [HttpPost]
    [EnableRateLimiting("writes")]
    public async Task<ActionResult<OpportunityDto>> Create(OpportunityInput input, CancellationToken ct)
    {
        var o = await service.CreatePrivateAsync(input, ct);
        return CreatedAtAction(nameof(Get), new { id = o.Id }, o);
    }

    [HttpPost("{id:guid}/save")] public Task<OpportunityDto> Save(Guid id, CancellationToken ct) => service.SaveAsync(id, ct);
    [HttpPut("{id:guid}/tracking")] public Task<OpportunityDto> Track(Guid id, TrackingInput input, CancellationToken ct) => service.TrackAsync(id, input, ct);

    [HttpDelete("{id:guid}/save")]
    public async Task<IActionResult> Unsave(Guid id, CancellationToken ct)
    {
        await service.UnsaveAsync(id, ct);
        return NoContent();
    }
}

[Route("api/registration")]
public sealed class RegistrationController(ReadinessService service) : ApiControllerBase
{
    [HttpGet] public Task<RegistrationDto> Get(CancellationToken ct) => service.GetRegistrationAsync(ct);
    [HttpPut("items/{key}")] public Task<RegistrationDto> UpdateItem(string key, ChecklistItemInput input, CancellationToken ct) => service.UpdateRegistrationItemAsync(key, input, ct);
    [HttpPut("status")] public Task<RegistrationDto> UpdateStatus(RegistrationStatusInput input, CancellationToken ct) => service.UpdateRegistrationStatusAsync(input, ct);
}

[Route("api/funding-readiness")]
public sealed class FundingReadinessController(ReadinessService service, ReportService reports) : ApiControllerBase
{
    [HttpGet] public Task<FundingReadinessDto> Get(CancellationToken ct) => service.GetFundingAsync(ct);
    [HttpPut("items/{key}")] public Task<FundingReadinessDto> UpdateItem(string key, ChecklistItemInput input, CancellationToken ct) => service.UpdateFundingItemAsync(key, input, ct);
    [HttpPut("profile")] public Task<FundingReadinessDto> UpdateProfile(FundingProfileDto input, CancellationToken ct) => service.UpdateFundingProfileAsync(input, ct);

    [HttpGet("summary")]
    public Task<BusinessSummaryDto> Summary([FromQuery] DateOnly? from, [FromQuery] DateOnly? to, CancellationToken ct) => reports.BusinessSummaryAsync(from, to, ct);
}

[Route("api/public-profile")]
public sealed class PublicProfileSettingsController(PublicProfileService service) : ApiControllerBase
{
    [HttpGet] public Task<PublicProfileSettingsDto> Get(CancellationToken ct) => service.GetSettingsAsync(ct);
    [HttpPut] public Task<PublicProfileSettingsDto> Update(PublicProfileInput input, CancellationToken ct) => service.UpdateAsync(input, ct);
}

/// <summary>The only anonymous business endpoint. Rate limited; returns explicitly public fields only.</summary>
[ApiController]
[AllowAnonymous]
[EnableRateLimiting("public")]
[Route("api/public/profiles")]
public sealed class PublicProfilesController(PublicProfileService service) : ControllerBase
{
    [HttpGet("{slug}")]
    public async Task<PublicProfileDto> Get(string slug, CancellationToken ct)
    {
        Response.Headers.CacheControl = "public, max-age=60";
        return await service.GetPublicAsync(slug, ct);
    }
}

[Route("api/fraud/incidents")]
public sealed class FraudIncidentsController(FraudService service) : ApiControllerBase
{
    [HttpGet] public Task<IReadOnlyList<FraudIncidentDto>> List([FromQuery] string? status, CancellationToken ct) => service.ListAsync(status, ct);

    [HttpPost]
    [EnableRateLimiting("writes")]
    public async Task<ActionResult<FraudIncidentDto>> Create(FraudIncidentInput input, CancellationToken ct)
    {
        var f = await service.CreateAsync(input, ct);
        return CreatedAtAction(nameof(Get), new { id = f.Id }, f);
    }

    [HttpGet("{id:guid}")] public Task<FraudIncidentDto> Get(Guid id, CancellationToken ct) => service.GetAsync(id, ct);
    [HttpPut("{id:guid}")] public Task<FraudIncidentDto> Update(Guid id, FraudIncidentInput input, CancellationToken ct) => service.UpdateAsync(id, input, ct);
}

[Route("api/reports")]
public sealed class ReportsController(ReportService reports, GrowthService growth) : ApiControllerBase
{
    [HttpGet("financial-summary")]
    public Task<FinancialSummaryDto> FinancialSummary([FromQuery] DateOnly? from, [FromQuery] DateOnly? to, CancellationToken ct) => reports.FinancialSummaryAsync(from, to, ct);

    [HttpGet("cash-flow")] public Task<ForecastDto> CashFlow([FromQuery] int? days, CancellationToken ct) => growth.GetForecastAsync(days, ct);

    [HttpGet("business-summary")]
    public Task<BusinessSummaryDto> BusinessSummary([FromQuery] DateOnly? from, [FromQuery] DateOnly? to, CancellationToken ct) => reports.BusinessSummaryAsync(from, to, ct);

    [HttpGet("export/{kind}.csv")]
    [EnableRateLimiting("exports")]
    [Produces("text/csv")]
    public async Task<IActionResult> Export(string kind, [FromQuery] DateOnly? from, [FromQuery] DateOnly? to, CancellationToken ct)
    {
        var (name, content) = await reports.ExportAsync(kind, from, to, ct);
        // UTF-8 BOM so spreadsheet apps show "—" and "R" characters correctly.
        var bytes = System.Text.Encoding.UTF8.GetPreamble().Concat(System.Text.Encoding.UTF8.GetBytes(content)).ToArray();
        return File(bytes, "text/csv; charset=utf-8", name);
    }
}
