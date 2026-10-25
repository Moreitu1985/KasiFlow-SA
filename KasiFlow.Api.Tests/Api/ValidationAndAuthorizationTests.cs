using KasiFlow.Core.Access;
using KasiFlow.Api.DTOs;
using KasiFlow.Api.Middleware;
using KasiFlow.Api.Models;
using KasiFlow.Api.Repositories;
using KasiFlow.Api.Services;
using KasiFlow.Api.Validators;
using Microsoft.AspNetCore.Http;

namespace KasiFlow.Api.Tests.Api;

public class TransactionValidationTests
{
    private static readonly DateOnly Today = new(2026, 10, 16);

    private static TransactionInput Valid() =>
        new("income", "Haircuts", 15_000, "Sales", Today, "cash", null, null, null, null);

    [Fact]
    public void Valid_transaction_passes() => Assert.True(RequestValidators.Transaction(Valid(), Today).IsValid);

    [Theory]
    [InlineData(0L)]
    [InlineData(-1L)]
    [InlineData(-150_000L)]
    public void Zero_or_negative_amounts_are_rejected(long cents)
    {
        var e = RequestValidators.Transaction(Valid() with { AmountCents = cents }, Today);
        Assert.Contains("amountCents", e.ToDictionary().Keys);
    }

    [Fact]
    public void Missing_amount_type_and_date_are_rejected()
    {
        var e = RequestValidators.Transaction(new TransactionInput(null, null, null, null, null, null, null, null, null, null), Today).ToDictionary();
        foreach (var f in new[] { "type", "description", "amountCents", "category", "transactionDate", "paymentMethod" })
            Assert.Contains(f, e.Keys);
    }

    [Fact]
    public void Category_must_match_type() =>
        Assert.Contains("category", RequestValidators.Transaction(Valid() with { Category = "Rent" }, Today).ToDictionary().Keys);

    [Fact]
    public void Posted_cannot_be_future_and_scheduled_cannot_be_past()
    {
        Assert.Contains("transactionDate", RequestValidators.Transaction(Valid() with { TransactionDate = Today.AddDays(1) }, Today).ToDictionary().Keys);
        Assert.True(RequestValidators.Transaction(Valid() with { TransactionDate = Today.AddDays(1), Status = "scheduled" }, Today).IsValid);
        Assert.Contains("transactionDate", RequestValidators.Transaction(Valid() with { TransactionDate = Today.AddDays(-1), Status = "scheduled" }, Today).ToDictionary().Keys);
    }

    [Fact]
    public void Users_cannot_claim_externally_confirmed_payments_or_set_voided()
    {
        Assert.Contains("paymentStatus", RequestValidators.Transaction(Valid() with { PaymentStatus = "confirmed_external" }, Today).ToDictionary().Keys);
        Assert.Contains("status", RequestValidators.Transaction(Valid() with { Status = "voided" }, Today).ToDictionary().Keys);
    }

    [Fact]
    public void Payment_cannot_be_in_future_or_non_positive()
    {
        var e = RequestValidators.Payment(new PaymentInput(0, Today.AddDays(1), "cash", null), Today).ToDictionary();
        Assert.Contains("amountCents", e.Keys);
        Assert.Contains("paymentDate", e.Keys);
    }

    [Fact]
    public void Business_requires_valid_province_and_email()
    {
        var e = RequestValidators.Business(new BusinessInput("Shop", "Spaza shop", "Owner", "not-an-email", null, "atlantis", null, "registered")).ToDictionary();
        Assert.Contains("province", e.Keys);
        Assert.Contains("contactEmail", e.Keys);
    }

    [Fact]
    public void Public_profile_rejects_bad_slug_and_non_https_image()
    {
        var e = RequestValidators.PublicProfile(new PublicProfileInput("Bad Slug!", true, null, null, null, null, null, null, null, null, "http://x.example/a.png")).ToDictionary();
        Assert.Contains("slug", e.Keys);
        Assert.Contains("imageUrl", e.Keys);
    }
}

public class BusinessOwnershipTests
{
    private sealed class FakeUser(Guid id) : ICurrentUser
    {
        public Guid UserId => id;
        public string? Email => "owner@example.com";
    }

    /// <summary>In-memory membership store standing in for the database.</summary>
    private sealed class FakeRepo(Dictionary<(Guid Business, Guid User), MembershipRow> members) : IBusinessRepository
    {
        public Task<Guid?> GetDefaultBusinessIdAsync(Guid userId, CancellationToken ct) =>
            Task.FromResult(members.Where(kv => kv.Key.User == userId && kv.Value.IsActive).Select(kv => (Guid?)kv.Key.Business).FirstOrDefault());
        public Task<MembershipRow?> GetMembershipAsync(Guid businessId, Guid userId, CancellationToken ct) =>
            Task.FromResult(members.TryGetValue((businessId, userId), out var m) ? m : null);
        public Task<IReadOnlyList<BusinessRow>> ListForUserAsync(Guid userId, CancellationToken ct) => throw new NotImplementedException();
        public Task<BusinessRow?> GetForUserAsync(Guid businessId, Guid userId, CancellationToken ct) => throw new NotImplementedException();
        public Task<BusinessRow> CreateAsync(Guid userId, string? email, BusinessInput input, CancellationToken ct) => throw new NotImplementedException();
        public Task<BusinessRow?> UpdateForUserAsync(Guid businessId, Guid userId, BusinessInput input, CancellationToken ct) => throw new NotImplementedException();
        public Task<SettingsRow> GetSettingsAsync(Guid businessId, CancellationToken ct) => throw new NotImplementedException();
        public Task<SettingsRow> UpdateSettingsAsync(Guid businessId, SettingsDto input, CancellationToken ct) => throw new NotImplementedException();
    }

    private static readonly Guid Alice = Guid.NewGuid(), Bob = Guid.NewGuid(), Carol = Guid.NewGuid(), Dave = Guid.NewGuid();
    private static readonly Guid AliceShop = Guid.NewGuid(), BobShop = Guid.NewGuid(), Till1 = Guid.NewGuid(), Till2 = Guid.NewGuid();
    private static readonly FakeRepo Repo = new(new()
    {
        [(AliceShop, Alice)] = new MembershipRow { Role = Roles.Owner, IsActive = true },
        [(BobShop, Bob)] = new MembershipRow { Role = Roles.Owner, IsActive = true },
        // Carol is a cashier at Alice's first till only; Dave was a member but has been deactivated.
        [(AliceShop, Carol)] = new MembershipRow { Role = Roles.Cashier, IsActive = true, BranchIds = [Till1] },
        [(AliceShop, Dave)] = new MembershipRow { Role = Roles.BusinessAdmin, IsActive = false },
    });

    private static BusinessContext ContextFor(Guid user, string? header)
    {
        var http = new DefaultHttpContext();
        if (header is not null) http.Request.Headers[BusinessContext.HeaderName] = header;
        return new BusinessContext(new HttpContextAccessor { HttpContext = http }, new FakeUser(user), Repo);
    }

    [Fact]
    public async Task Owner_can_access_own_business() =>
        Assert.Equal(AliceShop, await ContextFor(Alice, AliceShop.ToString()).GetBusinessIdAsync());

    [Fact]
    public async Task Another_users_business_is_reported_as_not_found() =>
        await Assert.ThrowsAsync<NotFoundException>(() => ContextFor(Bob, AliceShop.ToString()).GetBusinessIdAsync());

    [Fact]
    public async Task Unknown_business_is_not_found() =>
        await Assert.ThrowsAsync<NotFoundException>(() => ContextFor(Alice, Guid.NewGuid().ToString()).GetBusinessIdAsync());

    [Fact]
    public async Task Malformed_header_is_a_bad_request() =>
        await Assert.ThrowsAsync<BadRequestException>(() => ContextFor(Alice, "1 OR 1=1").GetBusinessIdAsync());

    [Fact]
    public async Task Missing_header_defaults_to_callers_own_business() =>
        Assert.Equal(BobShop, await ContextFor(Bob, null).GetBusinessIdAsync());

    [Fact]
    public async Task User_without_business_gets_not_found() =>
        await Assert.ThrowsAsync<NotFoundException>(() => ContextFor(Guid.NewGuid(), null).GetBusinessIdAsync());

    [Fact]
    public async Task Cashier_is_forbidden_from_financial_management_in_the_backend() =>
        await Assert.ThrowsAsync<ForbiddenException>(() => ContextFor(Carol, AliceShop.ToString()).RequireAsync(Permission.ManageFinancials));

    [Fact]
    public async Task Cashier_may_record_sales_only_at_assigned_branch()
    {
        var access = await ContextFor(Carol, AliceShop.ToString()).RequireAsync(Permission.RecordSales);
        Assert.True(access.CanSeeBranch(Till1));
        Assert.False(access.CanSeeBranch(Till2));
        Assert.Equal(Till1, Assert.Single(access.BranchFilter!));
    }

    [Fact]
    public async Task Owner_sees_all_branches() =>
        Assert.Null((await ContextFor(Alice, AliceShop.ToString()).GetAccessAsync()).BranchFilter);

    [Fact]
    public async Task Deactivated_member_is_treated_as_not_a_member() =>
        await Assert.ThrowsAsync<NotFoundException>(() => ContextFor(Dave, AliceShop.ToString()).GetBusinessIdAsync());
}

public class PublicProfileProjectionTests
{
    [Fact]
    public void Only_opted_in_contact_fields_are_public()
    {
        var row = new PublicProfileRow
        {
            Slug = "demo", BusinessName = "Demo", Province = "gauteng", Town = "Soweto",
            ContactPhone = "+27 00 000 0000", ContactEmail = "private@example.com",
            ShowPhone = true, ShowEmail = false, ShowTown = false
        };
        var dto = PublicProfileService.ToPublic(row);
        Assert.Equal("+27 00 000 0000", dto.Phone);
        Assert.Null(dto.Email);
        Assert.Null(dto.Town);
        // The public DTO type has no financial or owner fields at all.
        var names = typeof(PublicProfileDto).GetProperties().Select(p => p.Name.ToLowerInvariant()).ToList();
        Assert.DoesNotContain(names, n => n.Contains("cents") || n.Contains("owner") || n.Contains("businessid"));
    }
}

public class ReceivableSummaryTests
{
    [Fact]
    public void Summary_separates_overdue_and_upcoming()
    {
        var today = new DateOnly(2026, 10, 16);
        var c = Guid.NewGuid();
        var open = new List<KasiFlow.Core.Forecasting.OpenReceivable>
        {
            new(Guid.NewGuid(), c, "A", "x", 40_000, today.AddDays(-20), today.AddDays(-10)),
            new(Guid.NewGuid(), c, "A", "y", 10_000, today.AddDays(-2), today.AddDays(5)),
            new(Guid.NewGuid(), Guid.NewGuid(), "B", "z", 25_000, today.AddDays(-2), null),
        };
        var s = ReceivableService.Summarise(open, today);
        Assert.Equal(75_000, s.TotalOutstandingCents);
        Assert.Equal(40_000, s.OverdueCents);
        Assert.Equal(10_000, s.UpcomingCents);
        Assert.Equal("A", s.TopDebtors[0].CustomerName);
        Assert.Equal(50_000, s.TopDebtors[0].OutstandingCents);
    }
}
