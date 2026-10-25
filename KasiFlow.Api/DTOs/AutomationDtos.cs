namespace KasiFlow.Api.DTOs;

// ---- Integrations ----

public sealed record ConnectionDto(Guid Id, string ProviderKey, string Environment, string Status, string DisplayName,
    string? CredentialRef, Guid? DefaultBranchId, DateTime? ConnectedAt, DateTime? LastTestAt, bool? LastTestOk,
    DateTime? LastSyncAt, DateTime? LastSuccessAt, string? LastError, string? LastErrorHint, string WebhookPath,
    bool IsSandbox, ConnectionHealthDto Health);

public sealed record ConnectionHealthDto(string State, string Label, int EventsLast24h, int FailedEvents, int DuplicateEvents,
    int PendingJobs, int DeadJobs, DateTime? LastEventAt);

public sealed record IntegrationsOverviewDto(IReadOnlyList<Services.Integrations.ProviderCardDto> Catalogue,
    IReadOnlyList<ConnectionDto> Connections, bool IsDemoBusiness, bool CanManage);

public sealed record ConnectInput(string? ProviderKey, string? DisplayName, string? CredentialRef, Guid? DefaultBranchId);

public sealed record ConnectionTestDto(bool Ok, string Status, string? Error, string? Hint, ConnectionDto Connection);

public sealed record ActivityDto(string Kind, Guid? Id, DateTime At, string Status, string Summary, string? Detail);

public sealed record ProviderPaymentDto(Guid Id, Guid ConnectionId, string ConnectionName, string ProviderKey, string Environment,
    string ExternalPaymentId, string Kind, string Method, string Status, long GrossCents, long TipCents, long? FeeCents, long? NetCents,
    string? MerchantReference, string? StatementReference, DateTime OccurredAt, DateTime? CompletedAt, Guid? SettlementId,
    Guid? TransactionId, string ReconciliationStatus, Guid? BranchId, bool CountsAsIncome, string SourceLabel);

public sealed record SettlementDto(Guid Id, Guid ConnectionId, string ExternalSettlementId, DateOnly SettledOn, long GrossCents,
    long? FeeCents, long? NetCents, int PaymentCount, Guid? FeeTransactionId, string Environment);

public sealed record JobDto(Guid Id, string JobType, string Status, int Attempts, int MaxAttempts, DateTime RunAfter,
    string? LastError, DateTime CreatedAt, DateTime UpdatedAt, DateTime? CompletedAt);

public sealed record SimulateInput(string? Scenario, long? AmountCents, string? Reference, string? Method, Guid? PaymentId,
    long? FeeCents, string? Sku, int? Quantity);

public sealed record SimulateResultDto(string Scenario, string Message, IReadOnlyList<SimulatedDeliveryDto> Deliveries);

public sealed record SimulatedDeliveryDto(string ExternalEventId, int HttpStatus, string Outcome);

public sealed record SandboxResetDto(int PaymentsRemoved, int TransactionsRemoved, int StockMovementsReversed);

// ---- Reconciliation ----

public sealed record ReconciliationSummaryDto(int NeedsReview, int Unmatched, int AutoMatched, int Matched, int CreatedSales, int Ignored,
    long PendingCents, int PendingCount, long UnsettledCents, int SettlementsCount);

public sealed record MatchSuggestionDto(Guid Id, Guid TransactionId, string Description, long AmountCents, DateOnly Date,
    string? Reference, string Method, decimal Confidence, string Reason, string Status);

public sealed record ReconciliationItemDto(ProviderPaymentDto Payment, IReadOnlyList<MatchSuggestionDto> Suggestions);

public sealed record MatchInput(Guid? TransactionId, string? Note);

public sealed record ReconcileActionInput(string? Note);

// ---- Notifications ----

public sealed record NotificationDto(Guid Id, string Kind, string Severity, string Title, string Body, string? Link, DateTime CreatedAt, DateTime? ReadAt);

public sealed record NotificationListDto(IReadOnlyList<NotificationDto> Items, int UnreadCount);

public sealed record NotificationPreferencesDto(string BriefingTime, bool InApp, bool Email, bool CriticalCash, bool Cashup,
    bool LowStock, bool Integrations, bool EmailAvailable);

public sealed record BriefingDto(DateOnly Date, string Greeting, long CashBalanceCents, long YesterdayIncomeCents, long YesterdayExpensesCents,
    int YesterdaySalesCount, DashboardForecastDto? Forecast, IReadOnlyList<BriefingItemDto> Items, IReadOnlyList<string> DataNotes);

public sealed record BriefingItemDto(string Kind, string Severity, string Title, string Detail, string? Link);

// ---- Branches & staff ----

public sealed record BranchDto(Guid Id, string Name, string? Area, bool IsActive, DateTime CreatedAt);

public sealed record BranchInput(string? Name, string? Area, bool? IsActive);

public sealed record StaffMemberDto(Guid UserId, string? DisplayName, string? Email, string Role, string RoleLabel, bool IsActive,
    IReadOnlyList<Guid> BranchIds, DateTime JoinedAt, bool IsYou);

public sealed record InvitationDto(Guid Id, string Email, string Role, IReadOnlyList<Guid> BranchIds, string Status, DateTime ExpiresAt, DateTime CreatedAt);

public sealed record StaffOverviewDto(IReadOnlyList<StaffMemberDto> Members, IReadOnlyList<InvitationDto> Invitations,
    IReadOnlyList<BranchDto> Branches, IReadOnlyList<RoleInfoDto> Roles);

public sealed record RoleInfoDto(string Key, string Label, bool BranchScoped, IReadOnlyList<string> Permissions);

public sealed record InvitationInput(string? Email, string? Role, IReadOnlyList<Guid>? BranchIds);

/// <summary>The token is returned once, to the inviter, so they can share the link. Only its hash is stored.</summary>
public sealed record InvitationCreatedDto(InvitationDto Invitation, string Token, string AcceptPath, string Note);

public sealed record AcceptInvitationInput(string? Token);

public sealed record RoleChangeInput(string? Role, IReadOnlyList<Guid>? BranchIds);

public sealed record StaffPerformanceDto(DateOnly From, DateOnly To, IReadOnlyList<StaffPerformanceRowDto> Rows, IReadOnlyList<string> Caveats);

public sealed record StaffPerformanceRowDto(Guid UserId, string Name, string Role, int SalesCount, long SalesCents, long AverageSaleCents,
    int VoidedCount, int ShiftsClosed, int CashUpsNeedingReview, long NetCashVarianceCents);

// ---- Shifts ----

public sealed record ShiftDto(Guid Id, Guid BranchId, string BranchName, Guid StaffUserId, string StaffName, DateTime OpenedAt,
    long OpeningFloatCents, DateTime? ClosedAt, long? CountedCashCents, long? ExpectedCashCents, long? VarianceCents, bool NeedsReview,
    string Status, string? CloseNote, string? ReviewNote, DateTime? ReviewedAt, ShiftBreakdownDto Breakdown);

public sealed record ShiftBreakdownDto(long CashSalesCents, int CashSalesCount, long CashRefundsCents, long PaidOutsCents,
    long CashDropsCents, long FloatTopUpsCents, long NonCashSalesCents, long ExpectedNowCents);

public sealed record OpenShiftInput(Guid? BranchId, long? OpeningFloatCents);

public sealed record CashMovementInput(string? Kind, long? AmountCents, string? Note);

public sealed record CloseShiftInput(long? CountedCashCents, string? Note);

public sealed record ReviewShiftInput(string? Note);

public sealed record BusinessSummaryForJoinDto(Guid BusinessId, string BusinessName, string Role, string RoleLabel);

// ---- Inventory ----

public sealed record StockLevelDto(Guid BranchId, string BranchName, int Quantity, bool IsLow);

public sealed record ProductDto(Guid Id, string Sku, string? Barcode, string Name, string Kind, long UnitPriceCents, long UnitCostCents,
    int MinStockQty, int? LeadTimeDays, Guid? SupplierId, string? SupplierName, bool IsActive, int TotalQuantity,
    IReadOnlyList<StockLevelDto> Levels);

public sealed record ProductInput(string? Sku, string? Barcode, string? Name, string? Kind, long? UnitPriceCents, long? UnitCostCents,
    int? MinStockQty, int? LeadTimeDays, Guid? SupplierId, bool? IsActive);

public sealed record ReceiveStockInput(Guid? ProductId, Guid? BranchId, int? Quantity, long? UnitCostCents, string? Note);

public sealed record AdjustmentInput(Guid? ProductId, Guid? BranchId, string? Type, int? QuantityDelta, string? Reason);

public sealed record TransferInput(Guid? ProductId, Guid? FromBranchId, Guid? ToBranchId, int? Quantity, string? Note);

public sealed record DecisionInput(string? Note);

public sealed record StockMovementDto(Guid Id, Guid ProductId, string ProductName, Guid BranchId, string BranchName, string MovementType,
    int QuantityDelta, long? UnitCostCents, string Status, string? Reason, string Source, Guid? TransactionId, Guid? ProviderPaymentId,
    Guid? CreatedBy, string? CreatedByName, Guid? ApprovedBy, DateTime CreatedAt);

public sealed record ReorderSuggestionDto(Guid ProductId, string Sku, string Name, Guid BranchId, string BranchName, int OnHand, int MinStock,
    decimal AverageDailySales, int LeadTimeDays, int ReorderPoint, int SuggestedQuantity, long EstimatedCostCents, bool IsLowStock,
    bool InsufficientHistory, string? SupplierName, IReadOnlyList<string> Assumptions);
