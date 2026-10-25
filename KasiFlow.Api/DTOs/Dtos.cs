namespace KasiFlow.Api.DTOs;

// Request/response contracts. See docs/API.md. Money is always integer cents.

public sealed record PagedResult<T>(IReadOnlyList<T> Items, int Page, int PageSize, long TotalCount, int TotalPages)
{
    public static PagedResult<T> Create(IReadOnlyList<T> items, int page, int pageSize, long total) =>
        new(items, page, pageSize, total, total == 0 ? 0 : (int)((total + pageSize - 1) / pageSize));
}

public sealed record PeriodDto(DateOnly From, DateOnly To, string Label);

// ---- Businesses ----
public sealed record BusinessDto(Guid Id, string Name, string BusinessType, string OwnerName, string ContactEmail,
    string? ContactPhone, string Province, string? Town, string RegistrationStatus, string Currency, DateTime CreatedAt, DateTime UpdatedAt,
    string Role, IReadOnlyList<string> Permissions, bool IsDemo, ExperienceDto? Experience = null);

/// <summary>The app this member sees: its home, its screens (menu order) and its phone tabs. Screens outside this list
/// are not shown; the API still checks every request.</summary>
public sealed record ExperienceDto(string Role, string Title, string Purpose, string HomePath, IReadOnlyList<ScreenDto> Screens, IReadOnlyList<string> MobileTabs);

public sealed record ScreenDto(string Key, string Path, string Label, string Short, string Group);

public sealed record BusinessInput(string? Name, string? BusinessType, string? OwnerName, string? ContactEmail,
    string? ContactPhone, string? Province, string? Town, string? RegistrationStatus);

public sealed record MeDto(Guid UserId, string? Email, IReadOnlyList<BusinessDto> Businesses);

public sealed record SettingsDto(long OpeningCashBalanceCents, DateOnly? OpeningBalanceDate, long CashBufferCents, int ForecastDays,
    // Automation thresholds: omitted (null) on update means "keep the current value".
    decimal? LargeTxMultiplier = null, long? CashupVarianceThresholdCents = null, int? ReorderSafetyDays = null, int? ReorderCoverDays = null,
    int? DefaultLeadTimeDays = null);

// ---- Transactions ----
public sealed record TransactionDto(Guid Id, string Type, string Description, long AmountCents, string Category,
    DateOnly TransactionDate, string PaymentMethod, string PaymentStatus, string Status, string Source, string? Reference,
    string? Notes, string? VoidReason, DateTime? VoidedAt, DateTime CreatedAt, DateTime UpdatedAt, Guid? ReceivableId,
    Guid? PayableId, string? CounterpartyName, string Origin, Guid? BranchId, string? BranchName, Guid? ShiftId,
    Guid? ProviderPaymentId, string? ProviderKey, string? ProviderStatus);

public sealed record LineItemInput(Guid? ProductId, int? Quantity);

public sealed record TransactionInput(string? Type, string? Description, long? AmountCents, string? Category,
    DateOnly? TransactionDate, string? PaymentMethod, string? PaymentStatus, string? Status, string? Reference, string? Notes,
    Guid? BranchId = null, IReadOnlyList<LineItemInput>? LineItems = null);

public sealed record VoidInput(string? Reason);

public sealed record TransactionQuery(string? Type, string? Category, string? Status, DateOnly? From, DateOnly? To,
    string? Search, int Page = 1, int PageSize = 20, Guid? BranchId = null, string? Origin = null, Guid[]? AllowedBranches = null);

public sealed record CategoriesDto(IReadOnlyList<string> Income, IReadOnlyList<string> Expense);

// ---- Customers / suppliers ----
public sealed record ContactInput(string? Name, string? Phone, string? Email, string? Notes, bool? IsArchived);

public sealed record CustomerDto(Guid Id, string Name, string? Phone, string? Email, string? Notes, bool IsArchived,
    long OutstandingCents, long OpenDebts, DateTime CreatedAt);

public sealed record SupplierDto(Guid Id, string Name, string? Phone, string? Email, string? Notes, bool IsArchived,
    long OutstandingCents, long OpenBills, DateTime CreatedAt);

public sealed record PaymentRecordDto(Guid Id, Guid TransactionId, long AmountCents, DateOnly PaymentDate,
    string PaymentMethod, string? Reference, bool IsVoided);

public sealed record ReceivableDto(Guid Id, Guid CustomerId, string CustomerName, string Description, long OriginalAmountCents,
    long PaidCents, long WrittenOffCents, long RemainingCents, DateOnly IssueDate, DateOnly? DueDate, string Status,
    bool IsOverdue, int DaysOverdue, string? Notes, DateTime CreatedAt, long PrincipalOutstandingCents = 0, long ChargesOutstandingCents = 0,
    long ProposedChargesCents = 0, string DebtStatus = "outstanding", bool Disputed = false, string? Reference = null, bool ChargeTermsDisclosed = false);

public sealed record ReceivableDetailDto(Guid Id, Guid CustomerId, string CustomerName, string Description, long OriginalAmountCents,
    long PaidCents, long WrittenOffCents, long RemainingCents, DateOnly IssueDate, DateOnly? DueDate, string Status,
    bool IsOverdue, int DaysOverdue, string? Notes, DateTime CreatedAt, IReadOnlyList<PaymentRecordDto> Payments,
    long PrincipalOutstandingCents = 0, long ChargesOutstandingCents = 0, long ProposedChargesCents = 0, string DebtStatus = "outstanding",
    bool Disputed = false, string? DisputeReason = null, string? Reference = null, string? ChargeTermsSnapshot = null);

public sealed record ReceivableInput(Guid? CustomerId, string? Description, long? OriginalAmountCents, DateOnly? IssueDate,
    DateOnly? DueDate, string? Notes, string? Reference = null, bool ChargeTermsDisclosed = false);

public sealed record PaymentInput(long? AmountCents, DateOnly? PaymentDate, string? PaymentMethod, string? Reference, bool ConfirmDuplicate = false);

public sealed record ReasonInput(string? Reason);

public sealed record TopDebtorDto(Guid CustomerId, string CustomerName, long OutstandingCents);

public sealed record ReceivableSummaryDto(long TotalOutstandingCents, long OverdueCents, long UpcomingCents, long OpenCount,
    IReadOnlyList<TopDebtorDto> TopDebtors);

public sealed record PayableDto(Guid Id, Guid SupplierId, string SupplierName, string Description, string Category,
    long OriginalAmountCents, long PaidCents, long RemainingCents, DateOnly BillDate, DateOnly DueDate, string Status,
    bool IsOverdue, int DaysUntilDue, string? Reference, string? Notes, DateTime CreatedAt);

public sealed record PayableDetailDto(Guid Id, Guid SupplierId, string SupplierName, string Description, string Category,
    long OriginalAmountCents, long PaidCents, long RemainingCents, DateOnly BillDate, DateOnly DueDate, string Status,
    bool IsOverdue, int DaysUntilDue, string? Reference, string? Notes, DateTime CreatedAt, IReadOnlyList<PaymentRecordDto> Payments);

public sealed record PayableInput(Guid? SupplierId, string? Description, string? Category, long? OriginalAmountCents,
    DateOnly? BillDate, DateOnly? DueDate, string? Reference, string? Notes);

public sealed record PayableSummaryDto(long TotalOutstandingCents, long OverdueCents, long DueNext7DaysCents,
    long DueNext30DaysCents, long OpenCount);

// ---- Growth ----
public sealed record ForecastEventDto(string Kind, string SourceType, Guid SourceId, string Description, string? Counterparty,
    long AmountCents, bool IsExpected, bool IsOverdueCarryForward);

public sealed record ForecastDayDto(DateOnly Date, long OpeningBalanceCents, long ScheduledInflowsCents, long ExpectedInflowsCents,
    long OutflowsCents, long ExpectedClosingCents, long ConservativeClosingCents, bool BelowBuffer, bool BelowZero,
    IReadOnlyList<ForecastEventDto> Events, long OptimisticClosingCents = 0);

public sealed record BalancePointDto(DateOnly Date, long BalanceCents);

public sealed record ForecastTotalsDto(long ScheduledInflowsCents, long ExpectedInflowsCents, long OutflowsCents);

public sealed record ExcludedItemDto(string SourceType, Guid SourceId, string Description, long AmountCents, string Reason);

public sealed record ForecastDto(DateOnly AsOf, int HorizonDays, long OpeningBalanceCents, long CashBufferCents,
    bool OpeningBalanceConfigured, IReadOnlyList<ForecastDayDto> Days, BalancePointDto LowestExpected,
    BalancePointDto LowestConservative, DateOnly? FirstShortageDate, DateOnly? FirstBelowBufferDate,
    DateOnly? FirstConservativeShortageDate, ForecastTotalsDto Totals, IReadOnlyList<ExcludedItemDto> Excluded,
    IReadOnlyList<string> Assumptions, BalancePointDto? LowestOptimistic = null, long TotalOptimisticExtraCents = 0,
    bool IsPreliminary = false, string? PreliminaryReason = null, IReadOnlyList<ScenarioDto>? Scenarios = null);

public sealed record ScenarioDto(string Key, string Name, string Assumption);

public sealed record EvidenceDto(string SourceType, Guid? SourceId, string Label, long? AmountCents, DateOnly? Date, string? Detail);

public sealed record RelevantDateDto(string Label, DateOnly Date);

public sealed record RecommendationDto(Guid Id, string RuleCode, string Title, string Severity, string Explanation,
    IReadOnlyList<EvidenceDto> Evidence, IReadOnlyList<RelevantDateDto> RelevantDates, IReadOnlyList<string> Actions,
    long? EstimatedImpactCents, string Status, string? ResolutionNote, DateTime CreatedAt, DateTime UpdatedAt);

public sealed record RecommendationStatusInput(string? Status, string? Note);

public sealed record RefreshResultDto(int Created, int Updated, int AutoResolved);

public sealed record GrowthRuleDto(string Code, string Name, string Description, string Severity);

// ---- Dashboard ----
public sealed record DashboardForecastDto(int HorizonDays, long LowestExpectedBalanceCents, DateOnly LowestExpectedBalanceDate,
    long ClosingExpectedBalanceCents, DateOnly? FirstShortageDate, DateOnly? FirstBelowBufferDate,
    bool IsPreliminary = false, string? PreliminaryReason = null, long LowestConservativeBalanceCents = 0, long LowestOptimisticBalanceCents = 0);

public sealed record ForecastPointDto(DateOnly Date, long ExpectedBalanceCents, long ConservativeBalanceCents, long OptimisticBalanceCents = 0);

public sealed record RecommendationCountsDto(int Total, int Critical, int Warning, int Informational);

public sealed record MonthlyIncomeExpenseDto(string Month, string Label, long IncomeCents, long ExpensesCents);

public sealed record ObligationDto(Guid PayableId, string SupplierName, string Description, DateOnly DueDate, long RemainingCents, bool IsOverdue);

public sealed record DashboardSummaryDto(PeriodDto Period, bool HasAnyTransactions, bool OpeningBalanceConfigured,
    long CashBalanceCents, long AwaitingConfirmationCents, long IncomeCents, long ExpensesCents, long NetResultCents,
    long OutstandingReceivablesCents, long OverdueReceivablesCents, long UpcomingPayablesCents, long OverduePayablesCents,
    DashboardForecastDto Forecast, IReadOnlyList<ForecastPointDto> ForecastSeries, RecommendationCountsDto OpenRecommendations,
    int FundingReadinessPercent, int RegistrationProgressPercent, IReadOnlyList<MonthlyIncomeExpenseDto> IncomeVsExpenses,
    IReadOnlyList<ObligationDto> UpcomingObligations, IReadOnlyList<RecommendationDto> PriorityActions);

// ---- Reports ----
public sealed record CategoryBreakdownDto(string Type, string Category, long TotalCents, int Count, decimal SharePercent);

public sealed record MonthlyRowDto(string Month, string Label, long IncomeCents, long ExpensesCents, long NetCents);

public sealed record FinancialSummaryDto(PeriodDto Period, long IncomeCents, long ExpensesCents, long NetResultCents,
    int TransactionCount, IReadOnlyList<CategoryBreakdownDto> CategoryBreakdown, IReadOnlyList<MonthlyRowDto> Monthly);

public sealed record SummaryBusinessDto(string Name, string BusinessType, string Province, string? Town, string RegistrationStatus);

public sealed record SummaryForecastDto(int HorizonDays, long LowestExpectedBalanceCents, DateOnly LowestExpectedBalanceDate,
    long ClosingExpectedBalanceCents);

public sealed record BusinessSummaryDto(DateTime GeneratedAt, SummaryBusinessDto Business, PeriodDto Period, long IncomeCents,
    long ExpensesCents, long NetResultCents, IReadOnlyList<CategoryBreakdownDto> CategoryBreakdown, IReadOnlyList<MonthlyRowDto> Monthly,
    long CashBalanceCents, long OutstandingReceivablesCents, long OutstandingPayablesCents, SummaryForecastDto Forecast,
    int ReadinessPercent, string? FundingPurpose, long? AmountRequestedCents, string Disclaimer);

// ---- Readiness ----
public sealed record ResourceDto(string Title, string Url, string Purpose, string? LastChecked = null);

public sealed record RegistrationStepDto(string Key, string Title, string Description, string AppliesTo,
    IReadOnlyList<ResourceDto> Resources, bool Completed, string? Notes, DateTime? UpdatedAt);

public sealed record RegistrationDto(string RegistrationStatus, int ProgressPercent, int CompletedCount, int TotalCount,
    string Disclaimer, IReadOnlyList<RegistrationStepDto> Steps);

public sealed record ChecklistItemInput(bool? Completed, string? Notes);

public sealed record RegistrationStatusInput(string? RegistrationStatus);

public sealed record FundingProfileDto(string? FundingPurpose, long? AmountRequestedCents, string? BusinessBankAccountStatus);

public sealed record FundingItemDto(string Key, string Title, string Description, string HowToComplete, string Mode,
    bool Completed, string? Notes, string? AppRoute);

public sealed record FundingReadinessDto(int Percent, int CompletedCount, int TotalCount, string Disclaimer,
    FundingProfileDto Profile, IReadOnlyList<FundingItemDto> Items);

// ---- Public profile ----
public sealed record PublicProfileSettingsDto(bool Exists, string Slug, bool IsPublished, string? Description, string? Category,
    string? ProductsServices, bool ShowPhone, bool ShowEmail, bool ShowTown, string? ServiceArea, string? OpeningHours,
    string? ImageUrl, string? PublicUrlPath);

public sealed record PublicProfileInput(string? Slug, bool? IsPublished, string? Description, string? Category,
    string? ProductsServices, bool? ShowPhone, bool? ShowEmail, bool? ShowTown, string? ServiceArea, string? OpeningHours,
    string? ImageUrl);

public sealed record PublicProfileDto(string Slug, string BusinessName, string? Description, string? Category,
    string? ProductsServices, string Province, string? Town, string? ServiceArea, string? OpeningHours, string? ImageUrl,
    string? Phone, string? Email);

// ---- Opportunities ----
public sealed record TrackingDto(Guid Id, string ApplicationStatus, string? Notes, DateOnly? PersonalDeadline, DateTime UpdatedAt);

public sealed record OpportunityDto(Guid Id, string Title, string Description, string Organisation, string OpportunityType,
    string Industry, string EligibilityCriteria, IReadOnlyList<string> RequiredDocuments, DateOnly? ApplicationDeadline,
    string? SourceUrl, string GeographicScope, string VerificationStatus, DateOnly? LastCheckedOn, bool IsPrivate,
    TrackingDto? Tracking);

public sealed record OpportunityInput(string? Title, string? Description, string? Organisation, string? OpportunityType,
    string? Industry, string? EligibilityCriteria, IReadOnlyList<string>? RequiredDocuments, DateOnly? ApplicationDeadline,
    string? SourceUrl, string? GeographicScope);

public sealed record TrackingInput(string? ApplicationStatus, string? Notes, DateOnly? PersonalDeadline);

// ---- Fraud ----
public sealed record FraudIncidentDto(Guid Id, string IncidentType, string Description, DateOnly IncidentDate,
    Guid? RelatedTransactionId, string Status, string? ActionTaken, string? PrivateNotes, DateTime CreatedAt, DateTime UpdatedAt);

public sealed record FraudIncidentInput(string? IncidentType, string? Description, DateOnly? IncidentDate,
    Guid? RelatedTransactionId, string? Status, string? ActionTaken, string? PrivateNotes);
