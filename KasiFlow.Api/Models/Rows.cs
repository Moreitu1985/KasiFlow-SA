namespace KasiFlow.Api.Models;

// Database row models mapped by Dapper (snake_case columns → PascalCase properties).
// They never leave the API: controllers return DTOs from the DTOs folder.

public sealed class BusinessRow
{
    public Guid Id { get; set; }
    public string Name { get; set; } = "";
    public string BusinessType { get; set; } = "";
    public string OwnerName { get; set; } = "";
    public string ContactEmail { get; set; } = "";
    public string? ContactPhone { get; set; }
    public string Province { get; set; } = "";
    public string? Town { get; set; }
    public string RegistrationStatus { get; set; } = "";
    public string Currency { get; set; } = "ZAR";
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
    public string Role { get; set; } = "owner";
    public bool IsDemo { get; set; }
}

public sealed class MembershipRow
{
    public string Role { get; set; } = "";
    public bool IsActive { get; set; }
    public bool IsDemo { get; set; }
    public Guid[] BranchIds { get; set; } = Array.Empty<Guid>();
}

public sealed class SettingsRow
{
    public Guid BusinessId { get; set; }
    public long OpeningCashBalanceCents { get; set; }
    public DateOnly? OpeningBalanceDate { get; set; }
    public long CashBufferCents { get; set; }
    public int ForecastDays { get; set; }
    public decimal LargeTxMultiplier { get; set; } = 3.0m;
    public long CashupVarianceThresholdCents { get; set; } = 5000;
    public int ReorderSafetyDays { get; set; } = 3;
    public int ReorderCoverDays { get; set; } = 14;
    public int DefaultLeadTimeDays { get; set; } = 7;
}

public sealed class TransactionRow
{
    public Guid Id { get; set; }
    public Guid BusinessId { get; set; }
    public string Type { get; set; } = "";
    public string Description { get; set; } = "";
    public long AmountCents { get; set; }
    public string Category { get; set; } = "";
    public DateOnly TransactionDate { get; set; }
    public string PaymentMethod { get; set; } = "";
    public string PaymentStatus { get; set; } = "";
    public string Status { get; set; } = "";
    public string Source { get; set; } = "";
    public string? Reference { get; set; }
    public string? Notes { get; set; }
    public string? VoidReason { get; set; }
    public DateTime? VoidedAt { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
    public Guid? ReceivableId { get; set; }
    public Guid? PayableId { get; set; }
    public string? CounterpartyName { get; set; }
    public string Origin { get; set; } = "staff_recorded";
    public Guid? BranchId { get; set; }
    public string? BranchName { get; set; }
    public Guid? ShiftId { get; set; }
    public Guid? ProviderPaymentId { get; set; }
    public string? ProviderKey { get; set; }
    public string? ProviderStatus { get; set; }
    public Guid? CreatedBy { get; set; }
    public long TotalCount { get; set; }
}

public sealed class PartyRow
{
    public Guid Id { get; set; }
    public string Name { get; set; } = "";
    public string? Phone { get; set; }
    public string? Email { get; set; }
    public string? Notes { get; set; }
    public bool IsArchived { get; set; }
    public long OutstandingCents { get; set; }
    public long OpenItems { get; set; }
    public DateTime CreatedAt { get; set; }
}

public sealed class ReceivableRow
{
    public Guid Id { get; set; }
    public Guid CustomerId { get; set; }
    public string CustomerName { get; set; } = "";
    public string Description { get; set; } = "";
    public long OriginalAmountCents { get; set; }
    public long PaidCents { get; set; }
    public long WrittenOffCents { get; set; }
    public DateOnly IssueDate { get; set; }
    public DateOnly? DueDate { get; set; }
    public string Status { get; set; } = "";
    public string? Notes { get; set; }
    public DateTime CreatedAt { get; set; }
    public long TotalCount { get; set; }
    public long AppliedChargesCents { get; set; }
    public long ProposedChargesCents { get; set; }
    public bool Disputed { get; set; }
    public string? DisputeReason { get; set; }
    public string? Reference { get; set; }
    public Guid? BookingId { get; set; }
    public DateTime? ChargeTermsDisclosedAt { get; set; }
    public string? ChargeTermsSnapshot { get; set; }
    public long? ChargeAmountCents { get; set; }
    public int? ChargeOverdueDays { get; set; }
    public int? ChargePolicyVersion { get; set; }
}

public sealed class PayableRow
{
    public Guid Id { get; set; }
    public Guid SupplierId { get; set; }
    public string SupplierName { get; set; } = "";
    public string Description { get; set; } = "";
    public string Category { get; set; } = "";
    public long OriginalAmountCents { get; set; }
    public long PaidCents { get; set; }
    public DateOnly BillDate { get; set; }
    public DateOnly DueDate { get; set; }
    public string Status { get; set; } = "";
    public string? Reference { get; set; }
    public string? Notes { get; set; }
    public DateTime CreatedAt { get; set; }
    public long TotalCount { get; set; }
}

public sealed class PaymentRow
{
    public Guid Id { get; set; }
    public Guid TransactionId { get; set; }
    public long AmountCents { get; set; }
    public DateOnly PaymentDate { get; set; }
    public string PaymentMethod { get; set; } = "";
    public string? Reference { get; set; }
    public bool IsVoided { get; set; }
}

public sealed class RecommendationRow
{
    public Guid Id { get; set; }
    public string RuleCode { get; set; } = "";
    public string Fingerprint { get; set; } = "";
    public string Title { get; set; } = "";
    public string Severity { get; set; } = "";
    public string Explanation { get; set; } = "";
    public string Evidence { get; set; } = "[]";
    public string RelevantDates { get; set; } = "[]";
    public string Actions { get; set; } = "[]";
    public long? EstimatedImpactCents { get; set; }
    public string Status { get; set; } = "";
    public string? ResolutionNote { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}

public sealed class ChecklistRow
{
    public string ItemKey { get; set; } = "";
    public bool Completed { get; set; }
    public string? Notes { get; set; }
    public DateTime UpdatedAt { get; set; }
}

public sealed class FundingProfileRow
{
    public string? FundingPurpose { get; set; }
    public long? AmountRequestedCents { get; set; }
    public string? BusinessBankAccountStatus { get; set; }
}

public sealed class PublicProfileRow
{
    public Guid BusinessId { get; set; }
    public string Slug { get; set; } = "";
    public bool IsPublished { get; set; }
    public string? Description { get; set; }
    public string? Category { get; set; }
    public string? ProductsServices { get; set; }
    public bool ShowPhone { get; set; }
    public bool ShowEmail { get; set; }
    public bool ShowTown { get; set; }
    public string? ServiceArea { get; set; }
    public string? OpeningHours { get; set; }
    public string? ImageUrl { get; set; }
    // Joined business fields (used only for the public projection after opt-in filtering)
    public string BusinessName { get; set; } = "";
    public string Province { get; set; } = "";
    public string? Town { get; set; }
    public string? ContactPhone { get; set; }
    public string ContactEmail { get; set; } = "";
}

public sealed class OpportunityRow
{
    public Guid Id { get; set; }
    public Guid? BusinessId { get; set; }
    public string Title { get; set; } = "";
    public string Description { get; set; } = "";
    public string Organisation { get; set; } = "";
    public string OpportunityType { get; set; } = "";
    public string Industry { get; set; } = "";
    public string EligibilityCriteria { get; set; } = "";
    public string RequiredDocuments { get; set; } = "[]";
    public DateOnly? ApplicationDeadline { get; set; }
    public string? SourceUrl { get; set; }
    public string GeographicScope { get; set; } = "";
    public string VerificationStatus { get; set; } = "";
    public DateOnly? LastCheckedOn { get; set; }
    public Guid? TrackingId { get; set; }
    public string? ApplicationStatus { get; set; }
    public string? TrackingNotes { get; set; }
    public DateOnly? PersonalDeadline { get; set; }
    public DateTime? TrackingUpdatedAt { get; set; }
}

public sealed class FraudIncidentRow
{
    public Guid Id { get; set; }
    public string IncidentType { get; set; } = "";
    public string Description { get; set; } = "";
    public DateOnly IncidentDate { get; set; }
    public Guid? RelatedTransactionId { get; set; }
    public string Status { get; set; } = "";
    public string? ActionTaken { get; set; }
    public string? PrivateNotes { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}
