using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using KasiFlow.Api.Data;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;

namespace KasiFlow.Api.Tests.Integration;

/// <summary>
/// Runs only when KASIFLOW_TEST_DATABASE is set to a connection string for a DISPOSABLE PostgreSQL database
/// (it will be migrated and written to). Example:
///   KASIFLOW_TEST_DATABASE="Host=localhost;Username=postgres;Password=postgres;Database=kasiflow_test" dotnet test
/// </summary>
public sealed class DatabaseFactAttribute : FactAttribute
{
    public DatabaseFactAttribute()
    {
        if (string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable(KasiFlowApiFactory.EnvVar)))
            Skip = $"Set {KasiFlowApiFactory.EnvVar} to run database integration tests.";
    }
}

public sealed class KasiFlowApiFactory : WebApplicationFactory<Program>
{
    public const string EnvVar = "KASIFLOW_TEST_DATABASE";
    public const string Secret = "integration-test-secret-integration-test-secret";
    public const string Issuer = "https://test-project.supabase.co/auth/v1";
    private static readonly SemaphoreSlim MigrateLock = new(1, 1);
    private static bool _migrated;

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Testing");
        builder.UseSetting("Database:ConnectionString", Environment.GetEnvironmentVariable(EnvVar));
        builder.UseSetting("Auth:SupabaseUrl", "https://test-project.supabase.co");
        builder.UseSetting("Auth:JwtSecret", Secret);
        builder.UseSetting("Auth:DisableJwks", "true");
    }

    public async Task EnsureMigratedAsync()
    {
        await MigrateLock.WaitAsync();
        try
        {
            if (_migrated) return;
            var db = Services.GetRequiredService<IDbConnectionFactory>();
            var folder = FindMigrations();
            await DatabaseCommands.MigrateAsync(db, folder, NullLogger.Instance);
            _migrated = true;
        }
        finally { MigrateLock.Release(); }
    }

    private static string FindMigrations()
    {
        for (var d = new DirectoryInfo(AppContext.BaseDirectory); d is not null; d = d.Parent)
        {
            var p = Path.Combine(d.FullName, "database", "migrations");
            if (Directory.Exists(p)) return p;
        }
        throw new DirectoryNotFoundException("database/migrations not found");
    }

    public static string Token(Guid userId, int expiresInSeconds = 3600)
    {
        static string B64(byte[] b) => Convert.ToBase64String(b).TrimEnd('=').Replace('+', '-').Replace('/', '_');
        var header = B64(JsonSerializer.SerializeToUtf8Bytes(new { alg = "HS256", typ = "JWT" }));
        var payload = B64(JsonSerializer.SerializeToUtf8Bytes(new Dictionary<string, object>
        {
            ["sub"] = userId.ToString(), ["aud"] = "authenticated", ["iss"] = Issuer, ["role"] = "authenticated",
            ["email"] = $"{userId:N}@example.com", ["exp"] = DateTimeOffset.UtcNow.AddSeconds(expiresInSeconds).ToUnixTimeSeconds()
        }));
        var sig = B64(HMACSHA256.HashData(Encoding.UTF8.GetBytes(Secret), Encoding.ASCII.GetBytes($"{header}.{payload}")));
        return $"{header}.{payload}.{sig}";
    }

    public HttpClient ClientFor(Guid userId, Guid? businessId = null)
    {
        var c = CreateClient();
        c.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", Token(userId));
        if (businessId is { } b) c.DefaultRequestHeaders.Add("X-Business-Id", b.ToString());
        return c;
    }
}

public sealed class ApiIntegrationTests(KasiFlowApiFactory factory) : IClassFixture<KasiFlowApiFactory>
{
    private static string Today => DateOnly.FromDateTime(DateTime.UtcNow.AddHours(2)).ToString("yyyy-MM-dd");

    private async Task<(HttpClient Client, Guid BusinessId)> NewOwnerAsync(string name)
    {
        await factory.EnsureMigratedAsync();
        var user = Guid.NewGuid();
        var c = factory.ClientFor(user);
        var res = await c.PostAsJsonAsync("/api/businesses", new
        {
            name, businessType = "Spaza shop", ownerName = "Test Owner", contactEmail = "owner@example.com",
            province = "gauteng", registrationStatus = "not_started"
        });
        Assert.Equal(HttpStatusCode.Created, res.StatusCode);
        var id = (await res.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();
        return (factory.ClientFor(user, id), id);
    }

    [DatabaseFact]
    public async Task Unauthenticated_and_expired_requests_are_rejected()
    {
        await factory.EnsureMigratedAsync();
        Assert.Equal(HttpStatusCode.Unauthorized, (await factory.CreateClient().GetAsync("/api/me")).StatusCode);
        var c = factory.CreateClient();
        c.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", KasiFlowApiFactory.Token(Guid.NewGuid(), -600));
        Assert.Equal(HttpStatusCode.Unauthorized, (await c.GetAsync("/api/me")).StatusCode);
    }

    [DatabaseFact]
    public async Task Transactions_of_another_business_are_not_accessible()
    {
        var (alice, _) = await NewOwnerAsync("Alice Spaza");
        var (bob, _) = await NewOwnerAsync("Bob Spaza");
        var created = await alice.PostAsJsonAsync("/api/transactions", new
        {
            type = "income", description = "Sales", amountCents = 10_000, category = "Sales", transactionDate = Today, paymentMethod = "cash"
        });
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var txId = (await created.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();

        Assert.Equal(HttpStatusCode.NotFound, (await bob.GetAsync($"/api/transactions/{txId}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await bob.PostAsJsonAsync($"/api/transactions/{txId}/void", new { reason = "not mine" })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await alice.GetAsync($"/api/transactions/{txId}")).StatusCode);
    }

    [DatabaseFact]
    public async Task Invalid_transaction_amounts_are_rejected_with_problem_details()
    {
        var (c, _) = await NewOwnerAsync("Validation Spaza");
        var res = await c.PostAsJsonAsync("/api/transactions", new
        {
            type = "expense", description = "Bad", amountCents = -100, category = "Rent", transactionDate = Today, paymentMethod = "cash"
        });
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
        var body = await res.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(body.GetProperty("errors").TryGetProperty("amountCents", out _));
    }

    [DatabaseFact]
    public async Task Partial_debt_payments_update_balance_and_cash_once()
    {
        var (c, _) = await NewOwnerAsync("Debt Spaza");
        var cust = await (await c.PostAsJsonAsync("/api/customers", new { name = "Mama Joy" })).Content.ReadFromJsonAsync<JsonElement>();
        var debt = await (await c.PostAsJsonAsync("/api/receivables", new
        {
            customerId = cust.GetProperty("id").GetGuid(), description = "Groceries", originalAmountCents = 60_000, issueDate = Today
        })).Content.ReadFromJsonAsync<JsonElement>();
        var debtId = debt.GetProperty("id").GetGuid();

        var dash0 = await c.GetFromJsonAsync<JsonElement>("/api/dashboard/summary");
        Assert.Equal(0, dash0.GetProperty("incomeCents").GetInt64()); // owing is not income

        var p1 = await c.PostAsJsonAsync($"/api/receivables/{debtId}/payments", new { amountCents = 25_000, paymentDate = Today, paymentMethod = "cash" });
        Assert.Equal(35_000, (await p1.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("remainingCents").GetInt64());

        var over = await c.PostAsJsonAsync($"/api/receivables/{debtId}/payments", new { amountCents = 35_001, paymentDate = Today, paymentMethod = "cash" });
        Assert.Equal(HttpStatusCode.Conflict, over.StatusCode);

        var p2 = await c.PostAsJsonAsync($"/api/receivables/{debtId}/payments", new { amountCents = 35_000, paymentDate = Today, paymentMethod = "cash" });
        Assert.Equal("settled", (await p2.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("status").GetString());

        var dash = await c.GetFromJsonAsync<JsonElement>("/api/dashboard/summary");
        Assert.Equal(60_000, dash.GetProperty("incomeCents").GetInt64());
        Assert.Equal(0, dash.GetProperty("outstandingReceivablesCents").GetInt64());
    }

    [DatabaseFact]
    public async Task Growth_refresh_does_not_duplicate_recommendations()
    {
        var (c, _) = await NewOwnerAsync("Growth Spaza");
        var sup = await (await c.PostAsJsonAsync("/api/suppliers", new { name = "Wholesaler" })).Content.ReadFromJsonAsync<JsonElement>();
        await c.PostAsJsonAsync("/api/payables", new
        {
            supplierId = sup.GetProperty("id").GetGuid(), description = "Stock", category = "Stock & supplies",
            originalAmountCents = 50_000, billDate = Today, dueDate = Today
        });
        var first = await c.GetFromJsonAsync<JsonElement>("/api/growth/recommendations");
        var second = await c.GetFromJsonAsync<JsonElement>("/api/growth/recommendations");
        Assert.Equal(first.GetArrayLength(), second.GetArrayLength());
        Assert.Contains(first.EnumerateArray(), r => r.GetProperty("ruleCode").GetString() == "CASH_SHORTFALL");
        var refresh = await (await c.PostAsync("/api/growth/refresh", null)).Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(0, refresh.GetProperty("created").GetInt32());
    }
}
