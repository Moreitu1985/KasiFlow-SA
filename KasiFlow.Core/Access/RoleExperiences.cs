namespace KasiFlow.Core.Access;

/// <summary>Every screen of the business app. A screen is a whole page (and its sub-pages), not a button.</summary>
public enum Screen
{
    Overview, Floor, Queue, Bookings, Workspace, Earnings, Briefing,
    Payments, Debts, Expenses, Transactions, CashFlow, Reports, Customers, Suppliers,
    Staff, RegisterBarber, Shifts, Inventory, HouseCalls, HouseCallMap, Services, Payroll,
    Growth, Insights, Alerts, FraudGuide, BusinessSetup, Procurement, Funding, BusinessProfile, Integrations, Reconciliation, Settings,
    // Customer app (outside any business)
    CustomerShops, CustomerBookings, CustomerAccount,
}

/// <summary>What the app needs to know to show a screen: where it lives, what it is called, and the permissions that
/// make it usable (any one is enough). A screen whose permissions a role lacks can never be part of that role's app.</summary>
public sealed record ScreenInfo(Screen Screen, string Key, string Path, string Label, string Short, string Group, IReadOnlyList<Permission> AnyOf);

public static class ScreenCatalog
{
    private static ScreenInfo S(Screen s, string path, string label, string shortLabel, string group, params Permission[] anyOf) =>
        new(s, char.ToLowerInvariant(s.ToString()[0]) + s.ToString()[1..], path, label, shortLabel, group, anyOf);

    public static readonly IReadOnlyList<ScreenInfo> All =
    [
        // Business stats and trends are the owner's (ViewBusinessInsights).
        S(Screen.Overview, "/app", "Business overview", "Home", "today", Permission.ViewBusinessInsights),
        S(Screen.Floor, "/floor", "Today on the floor", "Floor", "today", Permission.ManageBookings, Permission.ViewBookings, Permission.ManageStaffSchedules),
        S(Screen.Queue, "/queue", "Walk-in queue", "Queue", "today", Permission.ManageBookings, Permission.WorkOwnBookings),
        S(Screen.Bookings, "/bookings", "Bookings", "Bookings", "today", Permission.ViewBookings, Permission.ManageBookings, Permission.WorkOwnBookings),
        S(Screen.Workspace, "/workspace", "Barber Workspace", "Workspace", "today", Permission.UpdateOwnStatus, Permission.WorkOwnBookings, Permission.ViewTeamStatus, Permission.ManageStaffSchedules),
        S(Screen.Earnings, "/earnings", "My earnings", "Earnings", "today", Permission.WorkOwnBookings),
        S(Screen.Briefing, "/briefing", "Daily briefing", "Briefing", "today", Permission.ViewBusinessInsights),

        S(Screen.Payments, "/payments", "Payments", "Payments", "money", Permission.ViewFinancials, Permission.RecordSales, Permission.RecordDebtPayments, Permission.ViewIntegrations),
        S(Screen.Debts, "/debts", "Debts", "Debts", "money", Permission.ViewFinancials, Permission.RecordDebtPayments),
        S(Screen.Expenses, "/expenses", "Expenses", "Expenses", "money", Permission.ViewFinancials, Permission.RecordExpenses),
        S(Screen.Transactions, "/transactions", "Transactions", "Money", "money", Permission.ViewFinancials, Permission.RecordSales),
        S(Screen.CashFlow, "/cash-flow", "Cash Flow", "Cash", "money", Permission.ViewBusinessInsights),
        S(Screen.Reports, "/reports", "Reports", "Reports", "money", Permission.ViewBusinessInsights),
        S(Screen.Customers, "/customers", "Customers", "Customers", "money", Permission.ViewFinancials),
        S(Screen.Suppliers, "/suppliers", "Suppliers & bills", "Bills", "money", Permission.ViewFinancials),

        S(Screen.Staff, "/staff", "Staff", "Staff", "shop", Permission.ViewStaff),
        S(Screen.RegisterBarber, "/team/register", "Register a barber", "Register", "shop", Permission.ManageStaff),
        S(Screen.Shifts, "/shifts", "Shifts & cash-up", "Shift", "shop", Permission.OperateShift, Permission.ReviewShifts),
        S(Screen.Inventory, "/inventory", "Inventory", "Stock", "shop", Permission.ViewInventory),
        S(Screen.HouseCalls, "/house-calls", "House Calls", "House calls", "shop", Permission.ViewBookings, Permission.ManageBookings),
        S(Screen.HouseCallMap, "/map", "House-call map", "Map", "shop", Permission.ManageBookings, Permission.ViewBookings),
        S(Screen.Payroll, "/payroll", "Barber pay", "Pay", "money", Permission.ViewBusinessInsights),
        S(Screen.Services, "/services", "Services & prices", "Services", "shop", Permission.ManageServices, Permission.ViewBookings, Permission.ManageBookings),

        S(Screen.Growth, "/growth", "Growth Insights", "Growth", "grow", Permission.ViewBusinessInsights),
        S(Screen.Insights, "/insights", "Shop insights", "Insights", "grow", Permission.ViewBusinessInsights),
        S(Screen.Alerts, "/alerts", "Fraud & Alerts", "Alerts", "grow", Permission.ViewAlerts),
        S(Screen.FraudGuide, "/fraud", "Fraud protection", "Fraud", "grow", Permission.ViewFraud),
        S(Screen.BusinessSetup, "/readiness", "Business Setup", "Setup", "grow", Permission.ViewFinancials, Permission.ManageSettings),
        S(Screen.Procurement, "/opportunities", "Procurement", "Tenders", "grow", Permission.ViewFinancials, Permission.ManageSettings),
        S(Screen.Funding, "/funding", "Funding Readiness", "Funding", "grow", Permission.ViewFinancials, Permission.ManageSettings),
        S(Screen.BusinessProfile, "/business-profile", "Business Profile", "Profile", "grow", Permission.ManageSettings),
        S(Screen.Integrations, "/integrations", "Integrations", "Integrations", "grow", Permission.ViewIntegrations),
        S(Screen.Reconciliation, "/reconciliation", "Reconciliation", "Reconcile", "grow", Permission.ManageReconciliation, Permission.ViewIntegrations),
        S(Screen.Settings, "/settings", "Settings", "Settings", "grow", Permission.ManageSettings),
    ];

    /// <summary>The customer app's screens (no business permissions are involved).</summary>
    public static readonly IReadOnlyList<ScreenInfo> Customer =
    [
        S(Screen.CustomerShops, "/c/shops", "Find a barber", "Shops", "customer"),
        S(Screen.CustomerBookings, "/c", "My bookings", "Bookings", "customer"),
        S(Screen.CustomerAccount, "/c/account", "My account", "Account", "customer"),
    ];

    private static readonly IReadOnlyDictionary<Screen, ScreenInfo> ByScreen = All.Concat(Customer).ToDictionary(s => s.Screen);

    public static ScreenInfo Get(Screen screen) => ByScreen[screen];

    /// <summary>The screen a path belongs to (e.g. /bookings/123 → Bookings; /customers/debts/1 → Debts), or null for
    /// paths that are not screens of the business app.</summary>
    public static ScreenInfo? ForPath(string path)
    {
        if (path.StartsWith("/customers/debts", StringComparison.Ordinal)) return ByScreen[Screen.Debts];
        if (path.StartsWith("/reports/business-summary", StringComparison.Ordinal)) return ByScreen[Screen.Reports];
        return All.Where(s => path == s.Path || path.StartsWith(s.Path + "/", StringComparison.Ordinal))
                  .OrderByDescending(s => s.Path.Length).FirstOrDefault();
    }
}

/// <summary>
/// One app in KasiFlow: who it is for, its home, its screens (menu order) and its phone tabs. Subclasses only say what
/// they want; this base class decides what they get through <see cref="Allows"/>, which subclasses may narrow but the
/// rest of the system can only read. Business roles and customers are both apps.
/// </summary>
public abstract class AppExperience
{
    private IReadOnlyList<ScreenInfo>? _screens;

    /// <summary>Stable key, e.g. "staff" or "customer".</summary>
    public abstract string Key { get; }

    /// <summary>Short name of the app, e.g. "Barber app".</summary>
    public abstract string Title { get; }

    /// <summary>One sentence saying what this person does in KasiFlow.</summary>
    public abstract string Purpose { get; }

    /// <summary>The screens this kind of person needs, in menu order.</summary>
    protected abstract IEnumerable<Screen> Wanted();

    /// <summary>Preferred landing screen.</summary>
    protected abstract Screen PreferredHome { get; }

    /// <summary>Preferred bottom tabs on phones (at most four are used).</summary>
    protected virtual IEnumerable<Screen> PreferredTabs => Wanted();

    /// <summary>The gate every wanted screen must pass.</summary>
    protected abstract bool Allows(ScreenInfo screen);

    public IReadOnlyList<ScreenInfo> Screens => _screens ??= Wanted().Distinct().Select(ScreenCatalog.Get).Where(Allows).ToList();

    public ScreenInfo Home => Screens.FirstOrDefault(s => s.Screen == PreferredHome) ?? Screens.First();

    public IReadOnlyList<ScreenInfo> MobileTabs => PreferredTabs.Where(CanOpen).Select(ScreenCatalog.Get).Take(4).ToList();

    public bool CanOpen(Screen screen) => Screens.Any(s => s.Screen == screen);
}

/// <summary>
/// The app a business role sees. A role can never get a screen its permissions do not allow, so a mistake in a
/// subclass can only hide a screen, never leak one. The API remains the authority on data — this decides what is
/// shown, and the server still checks every request.
/// </summary>
public abstract class RoleExperience : AppExperience
{
    public abstract string Role { get; }

    public override string Key => Role;

    protected sealed override bool Allows(ScreenInfo screen) => screen.AnyOf.Any(p => RolePermissions.Has(Role, p));

    /// <summary>False for any business screen path this role does not have; true for paths that are not business screens.</summary>
    public bool CanOpenPath(string path) => ScreenCatalog.ForPath(path) is not { } s || CanOpen(s.Screen);
}

/// <summary>Customers: find a shop, book, follow their bookings and keep their details. No business screens at all.</summary>
public sealed class CustomerExperience : AppExperience
{
    public static readonly CustomerExperience Instance = new();
    public override string Key => "customer";
    public override string Title => "Customer app";
    public override string Purpose => "Find a barber, see prices and their work, book a visit or a house call, and follow your bookings.";
    protected override Screen PreferredHome => Screen.CustomerBookings;
    protected override IEnumerable<Screen> Wanted() => [Screen.CustomerShops, Screen.CustomerBookings, Screen.CustomerAccount];
    protected override bool Allows(ScreenInfo screen) => ScreenCatalog.Customer.Contains(screen);
}

public sealed class OwnerExperience : RoleExperience
{
    public override string Role => Roles.Owner;
    public override string Title => "Owner app";
    public override string Purpose => "Run the whole shop: money, bookings, team, safety, growth and settings.";
    protected override Screen PreferredHome => Screen.Overview;
    protected override IEnumerable<Screen> Wanted() => ScreenCatalog.All.Select(x => x.Screen).Where(s => s != Screen.FraudGuide);
    protected override IEnumerable<Screen> PreferredTabs => [Screen.Overview, Screen.Bookings, Screen.Transactions, Screen.Debts];
}

/// <summary>Same app as the owner (the API keeps the debt-charge policy owner-only).</summary>
public sealed class AdminExperience : RoleExperience
{
    private readonly OwnerExperience _owner = new();
    public override string Role => Roles.BusinessAdmin;
    public override string Title => "Administrator app";
    public override string Purpose => "Run the shop for the owner. Business stats and the debt-charge policy stay with the owner.";
    protected override Screen PreferredHome => Screen.Floor;
    protected override IEnumerable<Screen> Wanted() => _owner.Screens.Select(s => s.Screen);
    protected override IEnumerable<Screen> PreferredTabs => [Screen.Floor, Screen.Bookings, Screen.Transactions, Screen.Debts];
}

public sealed class ManagerExperience : RoleExperience
{
    public override string Role => Roles.BranchManager;
    public override string Title => "Manager app";
    public override string Purpose => "Run the floor: who is free, today's chairs, booking requests, house-call safety, cash-up and alerts. Business stats stay with the owner.";
    protected override Screen PreferredHome => Screen.Floor;
    protected override IEnumerable<Screen> Wanted() =>
    [
        Screen.Floor, Screen.Queue, Screen.Bookings, Screen.Workspace, Screen.Earnings, Screen.HouseCalls, Screen.HouseCallMap, Screen.Payments, Screen.Debts, Screen.Expenses, Screen.Transactions,
        Screen.Staff, Screen.Shifts, Screen.Inventory, Screen.Services, Screen.Alerts, Screen.Integrations, Screen.Reconciliation,
    ];
    protected override IEnumerable<Screen> PreferredTabs => [Screen.Floor, Screen.Queue, Screen.Bookings, Screen.Shifts];
}

public sealed class ReceptionExperience : RoleExperience
{
    public override string Role => Roles.Cashier;
    public override string Title => "Front desk app";
    public override string Purpose => "Welcome customers: bookings, who is free, taking payments and debt payments, and your cash drawer.";
    protected override Screen PreferredHome => Screen.Bookings;
    protected override IEnumerable<Screen> Wanted() =>
        [Screen.Queue, Screen.Bookings, Screen.Workspace, Screen.Payments, Screen.Debts, Screen.Transactions, Screen.Shifts, Screen.Inventory, Screen.FraudGuide];
    protected override IEnumerable<Screen> PreferredTabs => [Screen.Queue, Screen.Bookings, Screen.Payments, Screen.Shifts];
}

public sealed class BarberExperience : RoleExperience
{
    public override string Role => Roles.Staff;
    public override string Title => "Barber app";
    public override string Purpose => "Your day: your status, your customers, your hours and time off, house-call safety and your work photos.";
    protected override Screen PreferredHome => Screen.Workspace;
    protected override IEnumerable<Screen> Wanted() => [Screen.Workspace, Screen.Queue, Screen.Bookings, Screen.Earnings];
}

public sealed class AccountantExperience : RoleExperience
{
    public override string Role => Roles.Accountant;
    public override string Title => "Accountant app (read-only)";
    public override string Purpose => "Read the books: money in and out, debts, bills and alerts. Nothing can be changed. Business stats stay with the owner.";
    protected override Screen PreferredHome => Screen.Transactions;
    protected override IEnumerable<Screen> Wanted() =>
    [
        Screen.Overview, Screen.Transactions, Screen.Payments, Screen.Debts, Screen.Expenses, Screen.CashFlow, Screen.Reports, Screen.Customers,
        Screen.Suppliers, Screen.Growth, Screen.Alerts, Screen.Staff, Screen.Inventory, Screen.Integrations, Screen.Reconciliation, Screen.BusinessSetup, Screen.Funding,
    ];
    protected override IEnumerable<Screen> PreferredTabs => [Screen.Transactions, Screen.Payments, Screen.Debts, Screen.Expenses];
}

public static class RoleExperiences
{
    private static readonly IReadOnlyDictionary<string, RoleExperience> ByRole = new RoleExperience[]
    {
        new OwnerExperience(), new AdminExperience(), new ManagerExperience(), new ReceptionExperience(), new BarberExperience(), new AccountantExperience(),
    }.ToDictionary(e => e.Role);

    /// <summary>The experience for a role. Unknown roles get the barber app (the smallest one) rather than more.</summary>
    public static RoleExperience For(string role) => ByRole.TryGetValue(role, out var e) ? e : ByRole[Roles.Staff];

    public static IEnumerable<RoleExperience> All => ByRole.Values;
}
