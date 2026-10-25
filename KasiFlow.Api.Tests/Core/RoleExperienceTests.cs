using KasiFlow.Core.Access;

namespace KasiFlow.Api.Tests.Core;

public class RoleExperienceTests
{
    [Fact]
    public void Every_role_has_its_own_experience_with_a_home_it_can_open()
    {
        foreach (var role in Roles.All)
        {
            var e = RoleExperiences.For(role);
            Assert.Equal(role, e.Role);
            Assert.True(e.CanOpen(e.Home.Screen), $"{role} cannot open its own home");
            Assert.NotEmpty(e.Screens);
            Assert.True(e.MobileTabs.Count <= 4);
        }
    }

    [Fact]
    public void A_role_never_gets_a_screen_its_permissions_do_not_allow()
    {
        foreach (var e in RoleExperiences.All)
            foreach (var s in e.Screens)
                Assert.True(s.AnyOf.Any(p => RolePermissions.Has(e.Role, p)), $"{e.Role} got {s.Screen} without permission");
    }

    [Fact]
    public void Barber_app_is_only_their_day_and_their_bookings()
    {
        var barber = RoleExperiences.For(Roles.Staff);
        Assert.Equal("workspace,queue,bookings,earnings", string.Join(",", barber.Screens.Select(s => s.Key)));
        Assert.Equal("/workspace", barber.Home.Path);
        foreach (var hidden in new[] { Screen.Overview, Screen.Payments, Screen.Transactions, Screen.Debts, Screen.Inventory, Screen.Shifts,
                     Screen.HouseCalls, Screen.Reports, Screen.Staff, Screen.RegisterBarber, Screen.Settings, Screen.Alerts, Screen.FraudGuide })
            Assert.False(barber.CanOpen(hidden), $"barber can open {hidden}");
        Assert.False(barber.CanOpenPath("/transactions/123"));
        Assert.True(barber.CanOpenPath("/bookings/123"));
        Assert.True(barber.CanOpenPath("/join"));
    }

    [Fact]
    public void Barbers_can_take_payment_for_their_own_visits_but_not_record_shop_sales()
    {
        Assert.True(RolePermissions.Has(Roles.Staff, Permission.TakeBookingPayments));
        Assert.False(RolePermissions.Has(Roles.Staff, Permission.RecordSales));
        Assert.False(RolePermissions.Has(Roles.Staff, Permission.ViewFinancials));
        Assert.False(RolePermissions.Has(Roles.Staff, Permission.OperateShift));
        Assert.False(RolePermissions.Has(Roles.Staff, Permission.ViewInventory));
    }

    [Fact]
    public void Each_role_lands_on_the_right_home()
    {
        Assert.Equal("/app", RoleExperiences.For(Roles.Owner).Home.Path);
        Assert.Equal("/transactions", RoleExperiences.For(Roles.Accountant).Home.Path);
        Assert.Equal("/bookings", RoleExperiences.For(Roles.Cashier).Home.Path);
        Assert.Equal("/floor", RoleExperiences.For(Roles.BranchManager).Home.Path);
        Assert.Equal("/floor", RoleExperiences.For(Roles.BusinessAdmin).Home.Path);
        Assert.Equal("/workspace", RoleExperiences.For(Roles.Staff).Home.Path);
    }

    [Fact]
    public void Front_desk_and_accountant_see_different_apps()
    {
        var desk = RoleExperiences.For(Roles.Cashier);
        var acc = RoleExperiences.For(Roles.Accountant);
        Assert.True(desk.CanOpen(Screen.Bookings) && desk.CanOpen(Screen.Payments) && desk.CanOpen(Screen.Shifts));
        Assert.False(desk.CanOpen(Screen.Reports) || desk.CanOpen(Screen.Overview) || desk.CanOpen(Screen.Settings));
        Assert.True(acc.CanOpen(Screen.Transactions) && acc.CanOpen(Screen.Debts));
        Assert.False(acc.CanOpen(Screen.Bookings) || acc.CanOpen(Screen.Workspace) || acc.CanOpen(Screen.Settings));
    }

    [Fact]
    public void Owner_gets_everything_and_admin_everything_except_business_stats()
    {
        var owner = RoleExperiences.For(Roles.Owner);
        Assert.True(owner.CanOpen(Screen.RegisterBarber) && owner.CanOpen(Screen.Settings) && owner.CanOpen(Screen.Alerts) && owner.CanOpen(Screen.Floor));
        var stats = new[] { Screen.Overview, Screen.Briefing, Screen.CashFlow, Screen.Reports, Screen.Growth, Screen.Payroll, Screen.Insights };
        Assert.Equal(string.Join(",", owner.Screens.Select(s => s.Key).Where(k => !stats.Select(x => ScreenCatalog.Get(x).Key).Contains(k))),
            string.Join(",", RoleExperiences.For(Roles.BusinessAdmin).Screens.Select(s => s.Key)));
    }

    [Fact]
    public void Only_the_owner_sees_business_stats_and_trends()
    {
        foreach (var role in Roles.All)
        {
            var e = RoleExperiences.For(role);
            var owner = role == Roles.Owner;
            Assert.Equal(owner, RolePermissions.Has(role, Permission.ViewBusinessInsights));
            foreach (var s in new[] { Screen.Overview, Screen.Briefing, Screen.CashFlow, Screen.Reports, Screen.Growth, Screen.Payroll, Screen.Insights })
                Assert.Equal(owner, e.CanOpen(s));
        }
    }

    [Fact]
    public void Manager_lands_on_the_floor_without_money_screens()
    {
        var m = RoleExperiences.For(Roles.BranchManager);
        Assert.Equal(Screen.Floor, m.Home.Screen);
        Assert.Equal(Screen.Floor, m.MobileTabs[0].Screen);
        Assert.False(m.CanOpen(Screen.Overview) || m.CanOpen(Screen.Reports) || m.CanOpen(Screen.Growth));
    }

    [Fact]
    public void Customers_get_their_own_app_with_no_business_screens()
    {
        var c = CustomerExperience.Instance;
        Assert.Equal("customer", c.Key);
        Assert.Equal("customerShops,customerBookings,customerAccount", string.Join(",", c.Screens.Select(s => s.Key)));
        Assert.Equal("/c", c.Home.Path);
        Assert.All(c.Screens, s => Assert.True(s.Path.StartsWith("/c", StringComparison.Ordinal)));
        Assert.All(RoleExperiences.All, e => Assert.DoesNotContain(e.Screens, s => s.Path.StartsWith("/c/") || s.Path == "/c"));
    }

    [Fact]
    public void Unknown_roles_get_the_smallest_app() =>
        Assert.Equal(Roles.Staff, RoleExperiences.For("something-new").Role);

    [Fact]
    public void Paths_map_to_their_screen()
    {
        Assert.Equal(Screen.Debts, ScreenCatalog.ForPath("/customers/debts/1")!.Screen);
        Assert.Equal(Screen.RegisterBarber, ScreenCatalog.ForPath("/team/register")!.Screen);
        Assert.Equal(Screen.Reports, ScreenCatalog.ForPath("/reports/business-summary")!.Screen);
        Assert.Null(ScreenCatalog.ForPath("/c/account"));
    }
}
