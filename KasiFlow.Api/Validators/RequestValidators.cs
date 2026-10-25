using KasiFlow.Api.DTOs;
using KasiFlow.Core.Common;
using KasiFlow.Core.Domain;
using KasiFlow.Core.Forecasting;
using KasiFlow.Core.Readiness;
using KasiFlow.Core.Validation;

namespace KasiFlow.Api.Validators;

/// <summary>Server-side validation for every write request. Field names match the JSON contract.</summary>
public static class RequestValidators
{
    public static ValidationErrors Business(BusinessInput i)
    {
        var e = new ValidationErrors()
            .Required("name", i.Name, 2, 120)
            .Required("businessType", i.BusinessType, 2, 60)
            .Required("ownerName", i.OwnerName, 2, 120)
            .Email("contactEmail", i.ContactEmail, required: true)
            .Phone("contactPhone", i.ContactPhone)
            .Optional("contactPhone", i.ContactPhone, 20)
            .Optional("town", i.Town, 120)
            .OneOf("registrationStatus", i.RegistrationStatus, RegistrationStatuses.All);
        if (!Provinces.IsValid(i.Province)) e.Add("province", "Select a valid South African province.");
        return e;
    }

    public static ValidationErrors Settings(SettingsDto i, DateOnly today)
    {
        var e = new ValidationErrors();
        if (Math.Abs(i.OpeningCashBalanceCents) > ValidationErrors.MaxAmountCents) e.Add("openingCashBalanceCents", "Amount is too large.");
        if (i.CashBufferCents < 0) e.Add("cashBufferCents", "The safety buffer cannot be negative.");
        if (i.CashBufferCents > ValidationErrors.MaxAmountCents) e.Add("cashBufferCents", "Amount is too large.");
        if (i.ForecastDays is < CashFlowForecaster.MinHorizon or > CashFlowForecaster.MaxHorizon)
            e.Add("forecastDays", $"Choose between {CashFlowForecaster.MinHorizon} and {CashFlowForecaster.MaxHorizon} days.");
        e.DateNotAfter("openingBalanceDate", i.OpeningBalanceDate, today, "The opening balance date cannot be in the future.");
        e.DateNotBefore("openingBalanceDate", i.OpeningBalanceDate, ValidationErrors.MinDate, "Enter a realistic date.");
        if (i.LargeTxMultiplier is < 1.5m or > 20m) e.Add("largeTxMultiplier", "Choose a multiplier between 1.5 and 20.");
        if (i.CashupVarianceThresholdCents < 0 || i.CashupVarianceThresholdCents > ValidationErrors.MaxAmountCents) e.Add("cashupVarianceThresholdCents", "Enter a valid amount.");
        if (i.ReorderSafetyDays is < 0 or > 60) e.Add("reorderSafetyDays", "Choose between 0 and 60 days.");
        if (i.ReorderCoverDays is < 1 or > 120) e.Add("reorderCoverDays", "Choose between 1 and 120 days.");
        if (i.DefaultLeadTimeDays is < 0 or > 120) e.Add("defaultLeadTimeDays", "Choose between 0 and 120 days.");
        return e;
    }

    public static ValidationErrors Transaction(TransactionInput i, DateOnly today)
    {
        var e = new ValidationErrors()
            .OneOf("type", i.Type, TransactionTypes.All)
            .Required("description", i.Description, 1, 200)
            .PositiveCents("amountCents", i.AmountCents)
            .OneOf("paymentMethod", i.PaymentMethod, PaymentMethods.All)
            .Optional("reference", i.Reference, 80)
            .Optional("notes", i.Notes, 1000);

        if (i.PaymentStatus is not null && !PaymentStatuses.UserSettable.Contains(i.PaymentStatus))
            e.Add("paymentStatus", i.PaymentStatus == PaymentStatuses.ConfirmedExternal
                ? "'Confirmed externally' can only be set by a verified payment provider integration."
                : "Invalid payment status.");
        if (i.Status is not null && !TransactionStatuses.Writable.Contains(i.Status))
            e.Add("status", "Status must be 'posted' or 'scheduled'. Use the void action to void a transaction.");

        if (string.IsNullOrWhiteSpace(i.Category)) e.Add("category", "This field is required.");
        else if (i.Type is not null && TransactionTypes.All.Contains(i.Type) && !Categories.IsValid(i.Type, i.Category))
            e.Add("category", $"'{i.Category}' is not a valid {i.Type} category.");

        if (i.TransactionDate is null) e.Add("transactionDate", "This field is required.");
        else
        {
            e.DateNotBefore("transactionDate", i.TransactionDate, ValidationErrors.MinDate, "Enter a realistic date.");
            var status = i.Status ?? TransactionStatuses.Posted;
            if (status == TransactionStatuses.Posted && i.TransactionDate > today)
                e.Add("transactionDate", "A posted transaction cannot be in the future. Save it as 'scheduled' instead.");
            if (status == TransactionStatuses.Scheduled && i.TransactionDate < today)
                e.Add("transactionDate", "A scheduled transaction must be dated today or later.");
            if (i.TransactionDate > today.AddYears(2)) e.Add("transactionDate", "Date is too far in the future.");
        }
        return e;
    }

    public static ValidationErrors Reason(string? reason) =>
        new ValidationErrors().Required("reason", reason, 3, 300);

    public static ValidationErrors Contact(ContactInput i) =>
        new ValidationErrors()
            .Required("name", i.Name, 1, 120)
            .Phone("phone", i.Phone)
            .Optional("phone", i.Phone, 20)
            .Email("email", i.Email, required: false)
            .Optional("notes", i.Notes, 1000);

    public static ValidationErrors Receivable(ReceivableInput i, DateOnly today)
    {
        var e = new ValidationErrors()
            .Required("description", i.Description, 1, 200)
            .PositiveCents("originalAmountCents", i.OriginalAmountCents)
            .Optional("notes", i.Notes, 1000);
        if (i.CustomerId is null || i.CustomerId == Guid.Empty) e.Add("customerId", "Select a customer.");
        if (i.IssueDate is null) e.Add("issueDate", "This field is required.");
        else
        {
            e.DateNotAfter("issueDate", i.IssueDate, today, "The issue date cannot be in the future.");
            e.DateNotBefore("issueDate", i.IssueDate, ValidationErrors.MinDate, "Enter a realistic date.");
            if (i.DueDate is { } due && due < i.IssueDate) e.Add("dueDate", "The due date cannot be before the issue date.");
        }
        return e;
    }

    public static ValidationErrors Payable(PayableInput i)
    {
        var e = new ValidationErrors()
            .Required("description", i.Description, 1, 200)
            .PositiveCents("originalAmountCents", i.OriginalAmountCents)
            .Optional("reference", i.Reference, 80)
            .Optional("notes", i.Notes, 1000);
        if (i.SupplierId is null || i.SupplierId == Guid.Empty) e.Add("supplierId", "Select a supplier.");
        if (string.IsNullOrWhiteSpace(i.Category) || !Categories.IsValid(TransactionTypes.Expense, i.Category))
            e.Add("category", "Select a valid expense category.");
        if (i.BillDate is null) e.Add("billDate", "This field is required.");
        if (i.DueDate is null) e.Add("dueDate", "This field is required.");
        if (i.BillDate is { } b && i.DueDate is { } d && d < b) e.Add("dueDate", "The due date cannot be before the bill date.");
        e.DateNotBefore("billDate", i.BillDate, ValidationErrors.MinDate, "Enter a realistic date.");
        return e;
    }

    public static ValidationErrors Payment(PaymentInput i, DateOnly today)
    {
        var e = new ValidationErrors()
            .PositiveCents("amountCents", i.AmountCents)
            .OneOf("paymentMethod", i.PaymentMethod, PaymentMethods.All)
            .Optional("reference", i.Reference, 80);
        if (i.PaymentDate is null) e.Add("paymentDate", "This field is required.");
        e.DateNotAfter("paymentDate", i.PaymentDate, today, "A payment cannot be recorded in the future.");
        e.DateNotBefore("paymentDate", i.PaymentDate, ValidationErrors.MinDate, "Enter a realistic date.");
        return e;
    }

    public static ValidationErrors RecommendationStatus(RecommendationStatusInput i) =>
        new ValidationErrors()
            .OneOf("status", i.Status, RecommendationStatuses.All)
            .Optional("note", i.Note, 500);

    public static ValidationErrors Checklist(ChecklistItemInput i)
    {
        var e = new ValidationErrors().Optional("notes", i.Notes, 1000);
        if (i.Completed is null) e.Add("completed", "This field is required.");
        return e;
    }

    public static ValidationErrors FundingProfile(FundingProfileDto i)
    {
        var e = new ValidationErrors()
            .Optional("fundingPurpose", i.FundingPurpose, 1000)
            .OneOf("businessBankAccountStatus", i.BusinessBankAccountStatus, BankAccountStatuses.All, required: false);
        if (i.AmountRequestedCents is { } a) e.PositiveCents("amountRequestedCents", a);
        return e;
    }

    public static ValidationErrors PublicProfile(PublicProfileInput i)
    {
        var e = new ValidationErrors()
            .Optional("description", i.Description, 1000)
            .Optional("category", i.Category, 60)
            .Optional("productsServices", i.ProductsServices, 1000)
            .Optional("serviceArea", i.ServiceArea, 200)
            .Optional("openingHours", i.OpeningHours, 300)
            .HttpsUrl("imageUrl", i.ImageUrl);
        if (!Slug.IsValid(i.Slug?.Trim()))
            e.Add("slug", "Use 3–80 lowercase letters, numbers and single hyphens (for example 'thatos-barber-studio').");
        return e;
    }

    public static ValidationErrors Opportunity(OpportunityInput i)
    {
        var e = new ValidationErrors()
            .Required("title", i.Title, 3, 200)
            .Optional("description", i.Description, 4000)
            .Required("organisation", i.Organisation, 2, 200)
            .OneOf("opportunityType", i.OpportunityType, OpportunityTypes.All)
            .Optional("industry", i.Industry, 60)
            .Optional("eligibilityCriteria", i.EligibilityCriteria, 4000)
            .Optional("geographicScope", i.GeographicScope, 100)
            .HttpsUrl("sourceUrl", i.SourceUrl);
        if (i.RequiredDocuments is { Count: > 30 }) e.Add("requiredDocuments", "At most 30 documents.");
        if (i.RequiredDocuments?.Any(d => d is { Length: > 200 }) == true) e.Add("requiredDocuments", "Each document name must be at most 200 characters.");
        return e;
    }

    public static ValidationErrors Tracking(TrackingInput i) =>
        new ValidationErrors()
            .OneOf("applicationStatus", i.ApplicationStatus, ApplicationStatuses.All)
            .Optional("notes", i.Notes, 2000);

    public static ValidationErrors Fraud(FraudIncidentInput i, DateOnly today)
    {
        var e = new ValidationErrors()
            .OneOf("incidentType", i.IncidentType, FraudIncidentTypes.All)
            .Required("description", i.Description, 1, 2000)
            .OneOf("status", i.Status ?? "open", FraudIncidentStatuses.All)
            .Optional("actionTaken", i.ActionTaken, 2000)
            .Optional("privateNotes", i.PrivateNotes, 2000);
        if (i.IncidentDate is null) e.Add("incidentDate", "This field is required.");
        e.DateNotAfter("incidentDate", i.IncidentDate, today, "The incident date cannot be in the future.");
        e.DateNotBefore("incidentDate", i.IncidentDate, ValidationErrors.MinDate, "Enter a realistic date.");
        return e;
    }

    public static ValidationErrors Paging(int page, int pageSize)
    {
        var e = new ValidationErrors();
        if (page < 1) e.Add("page", "Page must be 1 or more.");
        if (pageSize is < 1 or > 100) e.Add("pageSize", "Page size must be between 1 and 100.");
        return e;
    }

    public static bool IsRegistrationKey(string key) => RegistrationCatalogue.IsValidKey(key);
}
