namespace KasiFlow.Core.Readiness;

/// <summary>An official source. <paramref name="LastChecked"/> is the date the link was last opened and confirmed to work.</summary>
public sealed record ResourceLink(string Title, string Url, string Purpose, string LastChecked = RegistrationCatalogue.SourcesLastChecked);

public sealed record RegistrationStep(string Key, string Title, string Description, string AppliesTo, IReadOnlyList<ResourceLink> Resources);

/// <summary>
/// South African registration guidance. Links point to official sources and were checked on
/// <see cref="LastChecked"/>. KasiFlow does not register businesses or submit anything to government systems.
/// </summary>
public static class RegistrationCatalogue
{
    /// <summary>Date every official link below was last opened and confirmed to work.</summary>
    public const string SourcesLastChecked = "2026-10-16";

    public static readonly DateOnly LastChecked = new(2026, 10, 16);

    public const string Disclaimer =
        "This guidance is general information, not legal or tax advice. Requirements depend on your business structure " +
        "(for example sole proprietor or private company), your industry, your municipality and your turnover. Always confirm " +
        "requirements with the relevant authority (CIPC, SARS, your municipality or the Department of Employment and Labour). " +
        "KasiFlow does not register your business, verify registration numbers or submit information to any government system.";

    private static readonly ResourceLink BizPortal = new("BizPortal (CIPC)", "https://www.bizportal.gov.za/",
        "CIPC's online platform to register a private company. It also offers linked services such as SARS tax registration, UIF and Compensation Fund registration (if you have employees) and B-BBEE certificates for qualifying micro enterprises.");
    private static readonly ResourceLink GovZaCompany = new("Register your company (gov.za)", "https://www.gov.za/services/register-business-or-organisation/register-your-company",
        "Official government services page explaining company registration.");
    private static readonly ResourceLink SarsSmallBusiness = new("SARS — Small businesses", "https://www.sars.gov.za/businesses-and-employers/small-businesses-taxpayers/",
        "SARS guidance for small businesses: income tax, the elective Turnover Tax system for micro businesses, and VAT thresholds.");
    private static readonly ResourceLink SarsTurnoverTaxTest = new("SARS — Turnover Tax quick test", "https://www.sars.gov.za/types-of-tax/turnover-tax/quick-test-for-individuals-and-companies/",
        "Helps you check whether the simplified Turnover Tax system may apply to your business.");
    private static readonly ResourceLink SarsVat = new("SARS — Small businesses and VAT", "https://www.sars.gov.za/businesses-and-employers/small-businesses/small-businesses-and-vat/",
        "Explains when VAT registration is compulsory or voluntary.");
    private static readonly ResourceLink Csd = new("Central Supplier Database (National Treasury)", "https://secure.csd.gov.za/",
        "Government's supplier register. Businesses that want to sell to national, provincial or local government generally need to register here.");
    private static readonly ResourceLink ETenders = new("eTender Publication Portal", "https://www.etenders.gov.za/",
        "National Treasury's single portal where government tenders are published.");

    public static readonly IReadOnlyList<RegistrationStep> Steps = new[]
    {
        new RegistrationStep("choose_structure", "Choose your business structure",
            "Decide whether to trade as a sole proprietor (you and the business are the same legal person) or register a private company (Pty) Ltd (a separate legal entity). Many funders, corporate buyers and government departments prefer or require a registered entity.",
            "All businesses", new[] { GovZaCompany }),
        new RegistrationStep("register_company", "Register with CIPC (if forming a company)",
            "Register a private company online through CIPC's BizPortal. Have your ID details, proposed business name(s) and director details ready. Keep the registration certificate safely.",
            "Private companies", new[] { BizPortal, GovZaCompany }),
        new RegistrationStep("tax_registration", "Sort out your tax registration",
            "Companies receive an income tax reference number from SARS after CIPC registration. Sole proprietors declare business income on their personal income tax. Check whether the simplified Turnover Tax system suits you.",
            "All businesses", new[] { SarsSmallBusiness, SarsTurnoverTaxTest }),
        new RegistrationStep("vat_check", "Check whether VAT applies",
            "VAT registration becomes compulsory above a turnover threshold and can be voluntary above a lower threshold. SARS's small-business page (checked 16 October 2026) states that from 1 April 2026 the compulsory threshold is R2.3 million and the voluntary threshold R120 000 over 12 months; some older SARS pages still show R1 million and R50 000. Confirm the current figures with SARS or a tax practitioner before deciding.",
            "Businesses with higher turnover", new[] { SarsVat }),
        new RegistrationStep("business_bank_account", "Open a business bank account",
            "Keeping business money separate from personal money makes your records clearer and is often expected by funders. BizPortal offers links to open a business account with participating banks when registering a company.",
            "Recommended for all", new[] { BizPortal }),
        new RegistrationStep("municipal_licence", "Check municipal trading requirements",
            "Some activities (for example selling food, operating from certain premises or street trading) need a business licence, trading permit or health certificate from your local municipality. Contact your municipality's local economic development or licensing office.",
            "Depends on activity and location", Array.Empty<ResourceLink>()),
        new RegistrationStep("employees", "Register as an employer (if you employ staff)",
            "If you employ people you may need to register for UIF and the Compensation Fund, and possibly PAYE with SARS. BizPortal offers UIF and Compensation Fund registration for companies with employees.",
            "Businesses with employees", new[] { BizPortal, SarsSmallBusiness }),
        new RegistrationStep("csd", "Register on the Central Supplier Database (to sell to government)",
            "If you want to supply goods or services to government, register on the CSD and keep your details and tax compliance up to date. Tenders are published on the eTender portal.",
            "Businesses targeting government work", new[] { Csd, ETenders }),
    };

    public static bool IsValidKey(string key) => Steps.Any(s => s.Key == key);
}

public sealed record FundingItemDefinition(string Key, string Title, string Description, string HowToComplete, bool Automatic, string? AppRoute);

/// <summary>Funding-readiness checklist. This is an organisation aid — NOT a credit score or assessment.</summary>
public static class FundingReadinessCatalogue
{
    public const string Disclaimer =
        "This checklist helps you organise information before approaching a funder. It is not a credit score, a credit assessment, " +
        "a funding approval or a guarantee that your business qualifies for any loan or grant. Each funder sets its own criteria — " +
        "always check them with the funder directly.";

    public static readonly IReadOnlyList<FundingItemDefinition> Items = new[]
    {
        new FundingItemDefinition("profile_completed", "Business profile completed",
            "Your business name, type, contact details and province are recorded.",
            "Complete every required field in Settings → Business profile.", true, "/settings"),
        new FundingItemDefinition("registration_status_recorded", "Registration status recorded",
            "You know and have recorded whether your business is registered.",
            "Set your registration status in Business Readiness → Registration (choose something other than 'Not sure').", true, "/readiness"),
        new FundingItemDefinition("recent_records", "Recent sales and expense records",
            "At least one sale and one expense recorded in the last 90 days. Funders usually want to see records of your trading.",
            "Record your sales and expenses regularly in Transactions.", true, "/transactions"),
        new FundingItemDefinition("bank_account_status", "Business bank account status recorded",
            "You have recorded whether you use a separate business bank account.",
            "Fill in the bank account status in the funding profile below.", true, null),
        new FundingItemDefinition("business_plan", "Business plan prepared",
            "A short plan explaining what you sell, who your customers are, your costs and how you will grow.",
            "Write or update a simple business plan, then tick this item.", false, null),
        new FundingItemDefinition("forecast_reviewed", "Cash-flow forecast reviewed",
            "You have looked at your projected cash flow and understand upcoming shortfalls.",
            "Open the Growth Engine, review the forecast and recommendations, then tick this item.", false, "/growth"),
        new FundingItemDefinition("funding_purpose", "Funding purpose documented",
            "You have written down exactly what the money will be used for.",
            "Describe the purpose in the funding profile below.", true, null),
        new FundingItemDefinition("amount_requested", "Amount requested documented",
            "You have worked out how much you need, based on real costs or quotes.",
            "Enter the amount in the funding profile below.", true, null),
        new FundingItemDefinition("supporting_documents", "Supporting documents organised",
            "Typical documents include your ID, proof of address, registration documents (if registered), bank statements and quotes. Requirements differ per funder.",
            "Gather the documents your target funder asks for in one safe place, then tick this item.", false, null),
        new FundingItemDefinition("tax_compliance", "Tax and compliance information checked",
            "You have checked your tax registration and compliance status with SARS where it applies to you.",
            "Check your status on SARS eFiling or with a tax practitioner, then tick this item.", false, "/readiness"),
    };

    public static FundingItemDefinition? Find(string key) => Items.FirstOrDefault(i => i.Key == key);
}

/// <summary>Facts used to evaluate automatic funding-readiness items.</summary>
public sealed record FundingFacts(
    bool ProfileComplete,
    string RegistrationStatus,
    bool HasRecentIncome,
    bool HasRecentExpense,
    string? BankAccountStatus,
    string? FundingPurpose,
    long? AmountRequestedCents);

public sealed record FundingItemState(FundingItemDefinition Definition, bool Completed, string? Notes);

public static class FundingReadinessCalculator
{
    public static bool EvaluateAutomatic(string key, FundingFacts f) => key switch
    {
        "profile_completed" => f.ProfileComplete,
        "registration_status_recorded" => f.RegistrationStatus != Domain.RegistrationStatuses.NotSure,
        "recent_records" => f.HasRecentIncome && f.HasRecentExpense,
        "bank_account_status" => !string.IsNullOrWhiteSpace(f.BankAccountStatus),
        "funding_purpose" => !string.IsNullOrWhiteSpace(f.FundingPurpose) && f.FundingPurpose!.Trim().Length >= 10,
        "amount_requested" => f.AmountRequestedCents is > 0,
        _ => false
    };

    public static IReadOnlyList<FundingItemState> Evaluate(FundingFacts facts, IReadOnlyDictionary<string, (bool Completed, string? Notes)> manual)
    {
        return FundingReadinessCatalogue.Items.Select(def =>
        {
            manual.TryGetValue(def.Key, out var m);
            var completed = def.Automatic ? EvaluateAutomatic(def.Key, facts) : m.Completed;
            return new FundingItemState(def, completed, m.Notes);
        }).ToList();
    }

    /// <summary>Transparent percentage: completed items ÷ total items, rounded to a whole number.</summary>
    public static int Percent(int completed, int total) =>
        total == 0 ? 0 : (int)Math.Round(completed * 100m / total, MidpointRounding.AwayFromZero);
}
