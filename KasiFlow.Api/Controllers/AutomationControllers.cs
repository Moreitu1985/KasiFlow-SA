using KasiFlow.Api.DTOs;
using KasiFlow.Api.Services.Automation;
using KasiFlow.Api.Services.Integrations;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;

namespace KasiFlow.Api.Controllers;

[Route("api/integrations")]
public sealed class IntegrationsController(IntegrationService service) : ApiControllerBase
{
    [HttpGet] public Task<IntegrationsOverviewDto> Overview(CancellationToken ct) => service.OverviewAsync(ct);

    [HttpPost("connections")]
    [EnableRateLimiting("writes")]
    public Task<ConnectionTestDto> Connect(ConnectInput input, CancellationToken ct) => service.ConnectAsync(input, ct);

    [HttpGet("connections/{id:guid}")] public Task<ConnectionDto> Get(Guid id, CancellationToken ct) => service.GetAsync(id, ct);

    [HttpPost("connections/{id:guid}/test")]
    [EnableRateLimiting("writes")]
    public Task<ConnectionTestDto> Test(Guid id, CancellationToken ct) => service.TestAsync(id, ct);

    [HttpPost("connections/{id:guid}/sync")]
    [EnableRateLimiting("writes")]
    public async Task<IActionResult> Sync(Guid id, CancellationToken ct)
    {
        await service.SyncNowAsync(id, ct);
        return Accepted();
    }

    [HttpDelete("connections/{id:guid}")]
    public async Task<IActionResult> Disconnect(Guid id, CancellationToken ct)
    {
        await service.DisconnectAsync(id, ct);
        return NoContent();
    }

    [HttpGet("connections/{id:guid}/activity")] public Task<IReadOnlyList<ActivityDto>> Activity(Guid id, CancellationToken ct) => service.ActivityAsync(id, ct);

    [HttpGet("payments")]
    public Task<PagedResult<ProviderPaymentDto>> Payments([FromQuery] string? reconciliationStatus, [FromQuery] string? status, [FromQuery] Guid? connectionId,
        [FromQuery] DateOnly? from, [FromQuery] DateOnly? to, [FromQuery] int page = 1, [FromQuery] int pageSize = 20, CancellationToken ct = default) =>
        service.PaymentsAsync(reconciliationStatus, status, connectionId, from, to, page, pageSize, ct);

    [HttpGet("settlements")] public Task<IReadOnlyList<SettlementDto>> Settlements(CancellationToken ct) => service.SettlementsAsync(ct);

    [HttpGet("jobs")] public Task<IReadOnlyList<JobDto>> Jobs([FromQuery] string? status, CancellationToken ct) => service.JobsAsync(status, ct);

    [HttpPost("jobs/{id:guid}/retry")]
    [EnableRateLimiting("writes")]
    public async Task<IActionResult> Retry(Guid id, CancellationToken ct)
    {
        await service.RetryJobAsync(id, ct);
        return Accepted();
    }

    [HttpPost("connections/{id:guid}/simulate")]
    [EnableRateLimiting("writes")]
    public Task<SimulateResultDto> Simulate(Guid id, SimulateInput input, CancellationToken ct) => service.SimulateAsync(id, input, ct);

    [HttpPost("sandbox/reset")]
    [EnableRateLimiting("writes")]
    public Task<SandboxResetDto> ResetSandbox(CancellationToken ct) => service.ResetSandboxAsync(ct);
}

[Route("api/reconciliation")]
public sealed class ReconciliationController(ReconciliationService service) : ApiControllerBase
{
    [HttpGet("summary")] public Task<ReconciliationSummaryDto> Summary(CancellationToken ct) => service.SummaryAsync(ct);
    [HttpGet("queue")] public Task<IReadOnlyList<ReconciliationItemDto>> Queue([FromQuery] string? status, CancellationToken ct) => service.QueueAsync(status, ct);

    [HttpPost("payments/{id:guid}/match")]
    [EnableRateLimiting("writes")]
    public Task<ReconciliationItemDto> Match(Guid id, MatchInput input, CancellationToken ct) => service.MatchAsync(id, input, ct);

    [HttpPost("payments/{id:guid}/create-sale")]
    [EnableRateLimiting("writes")]
    public Task<ReconciliationItemDto> CreateSale(Guid id, ReconcileActionInput input, CancellationToken ct) => service.CreateSaleAsync(id, input, ct);

    [HttpPost("payments/{id:guid}/ignore")]
    [EnableRateLimiting("writes")]
    public Task<ReconciliationItemDto> Ignore(Guid id, ReconcileActionInput input, CancellationToken ct) => service.IgnoreAsync(id, input, ct);

    [HttpPost("payments/{id:guid}/unmatch")]
    [EnableRateLimiting("writes")]
    public Task<ReconciliationItemDto> Unmatch(Guid id, ReconcileActionInput input, CancellationToken ct) => service.UnmatchAsync(id, input, ct);
}

[Route("api/notifications")]
public sealed class NotificationsController(NotificationService service) : ApiControllerBase
{
    [HttpGet] public Task<NotificationListDto> List([FromQuery] bool unreadOnly = false, CancellationToken ct = default) => service.ListAsync(unreadOnly, ct);

    [HttpPost("{id:guid}/read")]
    public async Task<IActionResult> Read(Guid id, CancellationToken ct) { await service.MarkReadAsync(id, ct); return NoContent(); }

    [HttpPost("read-all")]
    public async Task<IActionResult> ReadAll(CancellationToken ct) { await service.MarkReadAsync(null, ct); return NoContent(); }

    [HttpGet("preferences")] public Task<NotificationPreferencesDto> Preferences(CancellationToken ct) => service.GetPreferencesAsync(ct);
    [HttpPut("preferences")] public Task<NotificationPreferencesDto> UpdatePreferences(NotificationPreferencesDto input, CancellationToken ct) => service.UpdatePreferencesAsync(input, ct);
}

[Route("api/briefing")]
public sealed class BriefingController(NotificationService service) : ApiControllerBase
{
    [HttpGet] public Task<BriefingDto> Get(CancellationToken ct) => service.BriefingAsync(ct);
}

[Route("api/branches")]
public sealed class BranchesController(StaffService service) : ApiControllerBase
{
    [HttpGet] public Task<IReadOnlyList<BranchDto>> List(CancellationToken ct) => service.BranchesAsync(ct);

    [HttpPost]
    [EnableRateLimiting("writes")]
    public Task<BranchDto> Create(BranchInput input, CancellationToken ct) => service.CreateBranchAsync(input, ct);

    [HttpPut("{id:guid}")] public Task<BranchDto> Update(Guid id, BranchInput input, CancellationToken ct) => service.UpdateBranchAsync(id, input, ct);
}

[Route("api/staff")]
public sealed class StaffController(StaffService service) : ApiControllerBase
{
    [HttpGet] public Task<StaffOverviewDto> Overview(CancellationToken ct) => service.OverviewAsync(ct);

    [HttpPost("invitations")]
    [EnableRateLimiting("writes")]
    public Task<InvitationCreatedDto> Invite(InvitationInput input, CancellationToken ct) => service.InviteAsync(input, ct);

    [HttpDelete("invitations/{id:guid}")]
    public async Task<IActionResult> Revoke(Guid id, CancellationToken ct) { await service.RevokeInvitationAsync(id, ct); return NoContent(); }

    [HttpPut("{userId:guid}/role")]
    [EnableRateLimiting("writes")]
    public Task<StaffMemberDto> ChangeRole(Guid userId, RoleChangeInput input, CancellationToken ct) => service.ChangeRoleAsync(userId, input, ct);

    [HttpPost("{userId:guid}/deactivate")]
    public async Task<IActionResult> Deactivate(Guid userId, CancellationToken ct) { await service.SetActiveAsync(userId, false, ct); return NoContent(); }

    [HttpPost("{userId:guid}/reactivate")]
    public async Task<IActionResult> Reactivate(Guid userId, CancellationToken ct) { await service.SetActiveAsync(userId, true, ct); return NoContent(); }

    [HttpGet("performance")]
    public Task<StaffPerformanceDto> Performance([FromQuery] DateOnly? from, [FromQuery] DateOnly? to, CancellationToken ct) => service.PerformanceAsync(from, to, ct);
}

/// <summary>Not business-scoped: the invited person is not a member yet.</summary>
[Route("api/invitations")]
public sealed class InvitationsController(StaffService service) : ApiControllerBase
{
    [HttpPost("accept")]
    [EnableRateLimiting("writes")]
    public Task<BusinessSummaryForJoinDto> Accept(AcceptInvitationInput input, CancellationToken ct) => service.AcceptAsync(input, ct);
}

[Route("api/shifts")]
public sealed class ShiftsController(ShiftService service) : ApiControllerBase
{
    [HttpGet] public Task<IReadOnlyList<ShiftDto>> List([FromQuery] string? status, CancellationToken ct) => service.ListAsync(status, ct);

    [HttpGet("current")]
    public async Task<IActionResult> Current(CancellationToken ct) => await service.CurrentAsync(ct) is { } s ? Ok(s) : NoContent();

    [HttpGet("{id:guid}")] public Task<ShiftDto> Get(Guid id, CancellationToken ct) => service.GetAsync(id, ct);

    [HttpPost("open")]
    [EnableRateLimiting("writes")]
    public Task<ShiftDto> Open(OpenShiftInput input, CancellationToken ct) => service.OpenAsync(input, ct);

    [HttpPost("{id:guid}/cash-movements")]
    [EnableRateLimiting("writes")]
    public Task<ShiftDto> CashMovement(Guid id, CashMovementInput input, CancellationToken ct) => service.AddCashMovementAsync(id, input, ct);

    [HttpPost("{id:guid}/close")]
    [EnableRateLimiting("writes")]
    public Task<ShiftDto> Close(Guid id, CloseShiftInput input, CancellationToken ct) => service.CloseAsync(id, input, ct);

    [HttpPost("{id:guid}/review")]
    [EnableRateLimiting("writes")]
    public Task<ShiftDto> Review(Guid id, ReviewShiftInput input, CancellationToken ct) => service.ReviewAsync(id, input, ct);
}

[Route("api/inventory")]
public sealed class InventoryController(InventoryService service) : ApiControllerBase
{
    [HttpGet("products")]
    public Task<IReadOnlyList<ProductDto>> Products([FromQuery] string? search, [FromQuery] bool includeInactive = false, CancellationToken ct = default) =>
        service.ProductsAsync(search, includeInactive, ct);

    [HttpPost("products")]
    [EnableRateLimiting("writes")]
    public Task<ProductDto> CreateProduct(ProductInput input, CancellationToken ct) => service.CreateProductAsync(input, ct);

    [HttpPut("products/{id:guid}")] public Task<ProductDto> UpdateProduct(Guid id, ProductInput input, CancellationToken ct) => service.UpdateProductAsync(id, input, ct);

    [HttpPost("receive")]
    [EnableRateLimiting("writes")]
    public Task<ProductDto> Receive(ReceiveStockInput input, CancellationToken ct) => service.ReceiveAsync(input, ct);

    [HttpPost("adjustments")]
    [EnableRateLimiting("writes")]
    public Task<StockMovementDto> Adjust(AdjustmentInput input, CancellationToken ct) => service.AdjustAsync(input, ct);

    [HttpPost("adjustments/{id:guid}/approve")]
    public Task<StockMovementDto> Approve(Guid id, DecisionInput input, CancellationToken ct) => service.DecideAsync(id, true, input, ct);

    [HttpPost("adjustments/{id:guid}/reject")]
    public Task<StockMovementDto> Reject(Guid id, DecisionInput input, CancellationToken ct) => service.DecideAsync(id, false, input, ct);

    [HttpPost("transfers")]
    [EnableRateLimiting("writes")]
    public Task<ProductDto> Transfer(TransferInput input, CancellationToken ct) => service.TransferAsync(input, ct);

    [HttpGet("movements")]
    public Task<IReadOnlyList<StockMovementDto>> Movements([FromQuery] Guid? productId, [FromQuery] Guid? branchId, [FromQuery] string? status, CancellationToken ct) =>
        service.MovementsAsync(productId, branchId, status, ct);

    [HttpGet("reorder-suggestions")]
    public Task<IReadOnlyList<ReorderSuggestionDto>> Reorder([FromQuery] bool onlyNeeded = false, CancellationToken ct = default) => service.ReorderAsync(onlyNeeded, ct);
}
