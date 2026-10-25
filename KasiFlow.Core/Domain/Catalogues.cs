namespace KasiFlow.Core.Domain;

/// <summary>String values stored in the database and exchanged over the API.
/// Kept as constants (not C# enums) so the wire format, DB CHECK constraints and code agree exactly.</summary>
public static class TransactionTypes
{
    public const string Income = "income";
    public const string Expense = "expense";
    public static readonly IReadOnlySet<string> All = new HashSet<string> { Income, Expense };
}

public static class TransactionStatuses
{
    /// <summary>The cash movement has happened.</summary>
    public const string Posted = "posted";
    /// <summary>A planned future cash movement. Used by the forecast only.</summary>
    public const string Scheduled = "scheduled";
    /// <summary>Reversed. Kept for audit; excluded from every calculation.</summary>
    public const string Voided = "voided";
    public static readonly IReadOnlySet<string> All = new HashSet<string> { Posted, Scheduled, Voided };
    public static readonly IReadOnlySet<string> Writable = new HashSet<string> { Posted, Scheduled };
}

public static class TransactionSources
{
    public const string Manual = "manual";
    public const string ReceivablePayment = "receivable_payment";
    public const string PayablePayment = "payable_payment";
    public const string ProviderPayment = "provider_payment";
    public const string ProviderRefund = "provider_refund";
    public const string ProviderFee = "provider_fee";
}

public static class PaymentMethods
{
    public const string Cash = "cash";
    public const string Eft = "eft";
    public const string Card = "card";
    public const string MobilePayment = "mobile_payment";
    public const string Other = "other";
    public static readonly IReadOnlySet<string> All = new HashSet<string> { Cash, Eft, Card, MobilePayment, Other };
}

public static class PaymentStatuses
{
    public const string RecordedManually = "recorded_manually";
    public const string AwaitingConfirmation = "awaiting_confirmation";
    /// <summary>Set only by the payment-provider pipeline (verified provider payment or reconciliation). Users cannot set it.</summary>
    public const string ConfirmedExternal = "confirmed_external";
    public const string Failed = "failed";
    public const string Cancelled = "cancelled";

    public static readonly IReadOnlySet<string> All =
        new HashSet<string> { RecordedManually, AwaitingConfirmation, ConfirmedExternal, Failed, Cancelled };

    /// <summary>Values a user may set manually.</summary>
    public static readonly IReadOnlySet<string> UserSettable =
        new HashSet<string> { RecordedManually, AwaitingConfirmation, Failed, Cancelled };

    /// <summary>Payment statuses whose money is treated as real cash in balances and profit.</summary>
    public static readonly IReadOnlySet<string> Counted = new HashSet<string> { RecordedManually, ConfirmedExternal };
}

public static class Categories
{
    public const string DebtCollection = "Debt collection";
    public const string SupplierPayment = "Supplier payment";
    public const string Refunds = "Refunds";
    public const string FeesAndCharges = "Fees & charges";

    public static readonly IReadOnlyList<string> Income = new[] { "Sales", "Services", DebtCollection, "Other income" };

    public static readonly IReadOnlyList<string> Expense = new[]
    {
        "Stock & supplies", "Rent", "Wages", "Transport", "Utilities", "Airtime & data", "Equipment",
        SupplierPayment, "Fees & charges", "Marketing", Refunds, "Other expense"
    };

    public static bool IsValid(string type, string category) => type switch
    {
        TransactionTypes.Income => Income.Contains(category),
        TransactionTypes.Expense => Expense.Contains(category),
        _ => false
    };
}

public static class Provinces
{
    public static readonly IReadOnlyDictionary<string, string> Labels = new Dictionary<string, string>
    {
        ["eastern_cape"] = "Eastern Cape",
        ["free_state"] = "Free State",
        ["gauteng"] = "Gauteng",
        ["kwazulu_natal"] = "KwaZulu-Natal",
        ["limpopo"] = "Limpopo",
        ["mpumalanga"] = "Mpumalanga",
        ["north_west"] = "North West",
        ["northern_cape"] = "Northern Cape",
        ["western_cape"] = "Western Cape",
    };

    public static bool IsValid(string? value) => value is not null && Labels.ContainsKey(value);
}

public static class RegistrationStatuses
{
    public const string NotStarted = "not_started";
    public const string InProgress = "in_progress";
    public const string Registered = "registered";
    public const string NotSure = "not_sure";
    public static readonly IReadOnlySet<string> All = new HashSet<string> { NotStarted, InProgress, Registered, NotSure };
}

public static class ReceivableStatuses
{
    public const string Open = "open";
    public const string Settled = "settled";
    public const string WrittenOff = "written_off";
    public static readonly IReadOnlySet<string> All = new HashSet<string> { Open, Settled, WrittenOff };
}

public static class PayableStatuses
{
    public const string Open = "open";
    public const string Paid = "paid";
    public const string Cancelled = "cancelled";
    public static readonly IReadOnlySet<string> All = new HashSet<string> { Open, Paid, Cancelled };
}

public static class Severities
{
    public const string Informational = "informational";
    public const string Warning = "warning";
    public const string Critical = "critical";
    public static readonly IReadOnlySet<string> All = new HashSet<string> { Informational, Warning, Critical };

    public static int Rank(string severity) => severity switch
    {
        Critical => 3,
        Warning => 2,
        _ => 1
    };
}

public static class RecommendationStatuses
{
    public const string Open = "open";
    public const string Dismissed = "dismissed";
    public const string Resolved = "resolved";
    public static readonly IReadOnlySet<string> All = new HashSet<string> { Open, Dismissed, Resolved };
}

public static class OpportunityTypes
{
    public static readonly IReadOnlySet<string> All = new HashSet<string>
        { "funding", "procurement", "supplier_registration", "training", "market_access", "other" };
}

public static class VerificationStatuses
{
    public const string VerifiedOfficial = "verified_official";
    public const string RequiresVerification = "requires_verification";
    public const string Sample = "sample";
    public static readonly IReadOnlySet<string> All = new HashSet<string> { VerifiedOfficial, RequiresVerification, Sample };
}

public static class ApplicationStatuses
{
    public static readonly IReadOnlySet<string> All = new HashSet<string>
        { "saved", "preparing", "applied", "successful", "unsuccessful", "closed" };
}

public static class FraudIncidentTypes
{
    public static readonly IReadOnlySet<string> All = new HashSet<string>
    {
        "suspicious_payment_request", "fake_proof_of_payment", "bank_detail_change", "impersonation",
        "upfront_fee_scam", "phishing", "urgent_payment_pressure", "credential_request", "other"
    };
}

public static class FraudIncidentStatuses
{
    public static readonly IReadOnlySet<string> All = new HashSet<string> { "open", "monitoring", "resolved" };
}

public static class BankAccountStatuses
{
    public static readonly IReadOnlySet<string> All = new HashSet<string>
        { "has_business_account", "uses_personal_account", "not_applicable" };
}
