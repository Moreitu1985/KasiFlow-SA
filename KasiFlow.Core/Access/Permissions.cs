namespace KasiFlow.Core.Access;

/// <summary>Roles a person can hold in one business. Stored as these exact strings.</summary>
public static class Roles
{
    public const string Owner = "owner";
    public const string BusinessAdmin = "business_admin";
    public const string BranchManager = "branch_manager";
    public const string Cashier = "cashier";
    public const string Staff = "staff";
    public const string Accountant = "accountant";

    public static readonly IReadOnlyList<string> All = new[] { Owner, BusinessAdmin, BranchManager, Cashier, Staff, Accountant };

    /// <summary>Roles that may be given through invitations or role changes. Ownership cannot be assigned.</summary>
    public static readonly IReadOnlySet<string> Assignable = new HashSet<string> { BusinessAdmin, BranchManager, Cashier, Staff, Accountant };

    public static string Label(string role) => role switch
    {
        Owner => "Owner",
        BusinessAdmin => "Business administrator",
        BranchManager => "Business manager",
        Cashier => "Cashier / receptionist",
        Staff => "Barber / employee",
        Accountant => "Accountant / adviser (read-only)",
        _ => role
    };

    /// <summary>Branch-scoped roles only see records of the branches they are assigned to.</summary>
    public static bool IsBranchScoped(string role) => role is BranchManager or Cashier or Staff;
}

/// <summary>Every permission the API checks. The frontend only mirrors these to hide controls;
/// the backend is the authority.</summary>
public enum Permission
{
    ViewFinancials,          // dashboard, reports, growth engine, debts, bills, cash flow
    ManageFinancials,        // create/edit business-wide transactions, debts, bills, recommendations
    RecordSales,             // record sales / paid-outs at an assigned branch
    VoidTransactions,
    ExportData,
    ManageSettings,          // business profile, cash settings, public profile, readiness, opportunities
    ViewFraud,
    ManageFraud,
    ViewIntegrations,
    ManageIntegrations,
    ManageReconciliation,
    ViewStaff,
    ManageStaff,
    ManageBranches,
    OperateShift,
    ReviewShifts,
    ViewPerformance,
    ViewInventory,
    ManageInventory,         // products, goods received, transfers
    RecordStockAdjustment,   // request an adjustment (needs approval unless the user can approve)
    ApproveStockAdjustment,
    ViewAudit,
    // Barbershop platform
    ViewBookings,            // all bookings at the user's branches
    ManageBookings,          // create, confirm, reschedule, cancel any booking; see house-call addresses
    WorkOwnBookings,         // see and update bookings assigned to the user's own staff profile
    UpdateOwnStatus,         // set the user's own availability status, hours and time off
    ViewTeamStatus,
    ManageServices,          // service catalogue and prices
    ManageStaffSchedules,    // other people's hours, time off and status
    RecordExpenses,          // record business expenses at an assigned branch
    RecordDebtPayments,      // take payments against customer debts
    ConfigureDebtPolicy,     // owner only: the debt-charge policy
    ViewAlerts,
    ManageAlerts,            // review, resolve or mark alerts as false positives
    VerifySupplierBankDetails,
    TakeBookingPayments,     // take payment for a booking the user is allowed to complete (barbers: their own visits only)
    ViewBusinessInsights,    // OWNER ONLY: business stats and trends — overview, money summary, reports, forecast, growth engine, staff performance
}

public static class RolePermissions
{
    private static readonly IReadOnlyDictionary<string, IReadOnlySet<Permission>> Matrix = new Dictionary<string, IReadOnlySet<Permission>>
    {
        [Roles.Owner] = Enum.GetValues<Permission>().ToHashSet(),
        // Administrators run the shop for the owner, but the debt-charge policy and the business's stats and trends stay with the owner.
        [Roles.BusinessAdmin] = Enum.GetValues<Permission>().Where(p => p is not (Permission.ConfigureDebtPolicy or Permission.ViewBusinessInsights)).ToHashSet(),
        [Roles.BranchManager] = new HashSet<Permission>
        {
            Permission.RecordSales, Permission.VoidTransactions, Permission.OperateShift, Permission.ReviewShifts,
            Permission.ViewStaff, Permission.ViewPerformance, Permission.ViewInventory, Permission.ManageInventory,
            Permission.RecordStockAdjustment, Permission.ApproveStockAdjustment, Permission.ViewFraud, Permission.ManageFraud,
            Permission.ViewBookings, Permission.ManageBookings, Permission.WorkOwnBookings, Permission.UpdateOwnStatus,
            Permission.ViewTeamStatus, Permission.ManageStaffSchedules, Permission.RecordExpenses, Permission.RecordDebtPayments,
            Permission.ManageReconciliation, Permission.ViewIntegrations, Permission.ViewAlerts, Permission.TakeBookingPayments,
        },
        [Roles.Cashier] = new HashSet<Permission>
        {
            Permission.RecordSales, Permission.OperateShift, Permission.ViewInventory, Permission.RecordStockAdjustment, Permission.ViewFraud,
            Permission.ViewBookings, Permission.ManageBookings, Permission.ViewTeamStatus, Permission.RecordDebtPayments, Permission.TakeBookingPayments,
        },
        // Barbers work their own day: own bookings, own status/hours/time off, the team board, and taking payment when
        // they complete one of their own visits. No shop-wide money, stock, cash-up, reports or settings.
        [Roles.Staff] = new HashSet<Permission>
        {
            Permission.WorkOwnBookings, Permission.UpdateOwnStatus, Permission.ViewTeamStatus, Permission.TakeBookingPayments,
        },
        [Roles.Accountant] = new HashSet<Permission>
        {
            Permission.ViewFinancials, Permission.ExportData, Permission.ViewFraud, Permission.ViewIntegrations,
            Permission.ViewStaff, Permission.ViewPerformance, Permission.ViewInventory, Permission.ViewAudit, Permission.ViewAlerts,
        },
    };

    public static bool Has(string role, Permission permission) =>
        Matrix.TryGetValue(role, out var set) && set.Contains(permission);

    public static IReadOnlyList<string> For(string role) =>
        Matrix.TryGetValue(role, out var set)
            ? set.Select(p => char.ToLowerInvariant(p.ToString()[0]) + p.ToString()[1..]).OrderBy(s => s, StringComparer.Ordinal).ToList()
            : Array.Empty<string>();

    /// <summary>Who may change whose role. Nobody changes their own role, nobody can grant ownership,
    /// and only the owner can manage business administrators.</summary>
    public static RoleChangeCheck CanChangeRole(string actorRole, Guid actorUserId, string targetCurrentRole, Guid targetUserId, string newRole)
    {
        if (actorUserId == targetUserId) return RoleChangeCheck.CannotChangeOwnRole;
        if (!Has(actorRole, Permission.ManageStaff)) return RoleChangeCheck.NotAllowed;
        if (!Roles.Assignable.Contains(newRole)) return RoleChangeCheck.RoleNotAssignable;
        if (targetCurrentRole == Roles.Owner) return RoleChangeCheck.CannotChangeOwner;
        if (actorRole != Roles.Owner && (targetCurrentRole == Roles.BusinessAdmin || newRole == Roles.BusinessAdmin))
            return RoleChangeCheck.OnlyOwnerManagesAdmins;
        return RoleChangeCheck.Ok;
    }
}

public enum RoleChangeCheck
{
    Ok,
    NotAllowed,
    CannotChangeOwnRole,
    RoleNotAssignable,
    CannotChangeOwner,
    OnlyOwnerManagesAdmins,
}

/// <summary>The caller's resolved access to one business.</summary>
public sealed record AccessContext(Guid BusinessId, Guid UserId, string Role, IReadOnlySet<Guid> BranchIds, bool IsDemoBusiness)
{
    public bool Can(Permission p) => RolePermissions.Has(Role, p);
    public bool AllBranches => !Roles.IsBranchScoped(Role);
    public bool CanSeeBranch(Guid? branchId) => AllBranches || (branchId is { } b && BranchIds.Contains(b));

    /// <summary>Branch filter for queries: null means "no restriction".</summary>
    public Guid[]? BranchFilter => AllBranches ? null : BranchIds.ToArray();
}
