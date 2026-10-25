using System.Security.Claims;
using System.Threading.RateLimiting;
using KasiFlow.Api.Configuration;
using KasiFlow.Api.Data;
using KasiFlow.Api.Middleware;
using KasiFlow.Api.Repositories;
using KasiFlow.Api.Services;
using KasiFlow.Api.Services.Automation;
using KasiFlow.Api.Services.Barbershop;
using KasiFlow.Api.Services.Integrations;
using KasiFlow.Core.Common;
using KasiFlow.Core.Growth;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Diagnostics.HealthChecks;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.Extensions.Diagnostics.HealthChecks;
using Microsoft.Extensions.Options;
using Npgsql;

var builder = WebApplication.CreateBuilder(args);
var config = builder.Configuration;

// ---------------------------------------------------------------- configuration
builder.Services.Configure<DatabaseOptions>(config.GetSection(DatabaseOptions.Section));
builder.Services.Configure<AuthOptions>(config.GetSection(AuthOptions.Section));
builder.Services.Configure<CorsOptions>(config.GetSection(CorsOptions.Section));
builder.Services.Configure<AppOptions>(config.GetSection(AppOptions.Section));
builder.Services.Configure<AutomationOptions>(config.GetSection(AutomationOptions.Section));

var dbOptions = config.GetSection(DatabaseOptions.Section).Get<DatabaseOptions>() ?? new DatabaseOptions();
var authOptions = config.GetSection(AuthOptions.Section).Get<AuthOptions>() ?? new AuthOptions();
var corsOptions = config.GetSection(CorsOptions.Section).Get<CorsOptions>() ?? new CorsOptions();

if (string.IsNullOrWhiteSpace(dbOptions.ConnectionString))
    throw new InvalidOperationException("Database:ConnectionString is not configured. Set the Database__ConnectionString environment variable or use dotnet user-secrets.");
if (string.IsNullOrWhiteSpace(authOptions.SupabaseUrl) && string.IsNullOrWhiteSpace(authOptions.Issuer))
    throw new InvalidOperationException("Auth:SupabaseUrl (or Auth:Issuer) is not configured.");
if (builder.Environment.IsProduction() && corsOptions.AllowedOrigins.Any(o => o.Contains("localhost", StringComparison.OrdinalIgnoreCase) || o == "*"))
    throw new InvalidOperationException("Production CORS origins must not include localhost or wildcards.");

// ---------------------------------------------------------------- data
DapperSetup.Configure();
builder.Services.AddSingleton(_ => NpgsqlDataSource.Create(dbOptions.ConnectionString));
builder.Services.AddSingleton<IDbConnectionFactory, NpgsqlConnectionFactory>();

// ---------------------------------------------------------------- domain & application services
builder.Services.AddSingleton<IClock, SouthAfricaClock>();
builder.Services.AddSingleton(GrowthEngine.CreateDefault());
builder.Services.AddSingleton<FinancialSnapshotService>();
builder.Services.AddSingleton<IPaymentVerificationProvider, NoPaymentVerificationProvider>();
builder.Services.AddHttpContextAccessor();
builder.Services.AddScoped<ICurrentUser, HttpCurrentUser>();
builder.Services.AddScoped<IBusinessRepository, BusinessRepository>();
builder.Services.AddScoped<IBusinessContext, BusinessContext>();
builder.Services.AddScoped<BusinessService>();
builder.Services.AddScoped<TransactionService>();
builder.Services.AddScoped<ContactService>();
builder.Services.AddScoped<ReceivableService>();
builder.Services.AddScoped<PayableService>();
builder.Services.AddScoped<GrowthService>();
builder.Services.AddScoped<DashboardService>();
builder.Services.AddScoped<ReportService>();
builder.Services.AddScoped<ReadinessService>();
builder.Services.AddScoped<PublicProfileService>();
builder.Services.AddScoped<OpportunityService>();
builder.Services.AddScoped<FraudService>();

// ---------------------------------------------------------------- automation & integrations
// Provider secrets come from configuration (environment variables / secret manager), never from the database.
builder.Services.AddSingleton<IntegrationSecrets>();
builder.Services.AddHttpClient("snapscan", c => c.Timeout = TimeSpan.FromSeconds(20));
builder.Services.AddSingleton<SandboxAdapter>();
builder.Services.AddSingleton<IPaymentProviderAdapter>(sp => sp.GetRequiredService<SandboxAdapter>());
builder.Services.AddSingleton<IPaymentProviderAdapter, SnapScanAdapter>();
builder.Services.AddSingleton<PaymentProviderRegistry>();
builder.Services.AddSingleton<PaymentIngestionService>();
builder.Services.AddSingleton<ProviderSyncService>();
builder.Services.AddSingleton<GrowthRefresher>();
builder.Services.AddSingleton<BriefingBuilder>();
builder.Services.AddScoped<IntegrationService>();
builder.Services.AddScoped<ReconciliationService>();
builder.Services.AddScoped<NotificationService>();
builder.Services.AddScoped<StaffService>();
builder.Services.AddScoped<ShiftService>();
builder.Services.AddScoped<InventoryService>();

// ---------------------------------------------------------------- barbershop platform
builder.Services.AddSingleton<BookingEngine>();
builder.Services.AddScoped<TeamService>();
builder.Services.AddScoped<WorkspaceService>();
builder.Services.AddScoped<ServiceCatalogService>();
builder.Services.AddScoped<PolicyService>();
builder.Services.AddScoped<BookingService>();
builder.Services.AddScoped<PublicBookingService>();
builder.Services.AddScoped<CustomerAccountService>();
builder.Services.AddScoped<PortfolioService>();
builder.Services.AddScoped<HouseCallSafetyService>();
builder.Services.AddScoped<CustomerSafetyService>();
builder.Services.AddScoped<FloorService>();
builder.Services.AddScoped<ShopDirectoryService>();
builder.Services.AddScoped<QueueService>();
builder.Services.AddScoped<PayService>();
builder.Services.AddScoped<HouseCallMapService>();
builder.Services.AddScoped<ShopInsightsService>();
builder.Services.AddScoped<DebtService>();
builder.Services.AddScoped<MoneyService>();
builder.Services.AddScoped<AlertService>();
builder.Services.AddScoped<PaymentProofService>();
builder.Services.AddScoped<SupplierBankService>();
builder.Services.AddSingleton<JobWorker>();
builder.Services.AddHostedService(sp => sp.GetRequiredService<JobWorker>());

// ---------------------------------------------------------------- authentication (Supabase access tokens)
builder.Services.AddHttpClient("jwks", c => c.Timeout = TimeSpan.FromSeconds(10));
builder.Services.AddSingleton<JwksKeyProvider>();
builder.Services.AddHostedService(sp => sp.GetRequiredService<JwksKeyProvider>());
builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme).AddJwtBearer(_ => { });
builder.Services.AddOptions<JwtBearerOptions>(JwtBearerDefaults.AuthenticationScheme)
    .Configure<JwksKeyProvider, IOptions<AuthOptions>>((options, jwks, auth) =>
    {
        options.MapInboundClaims = false;
        options.RequireHttpsMetadata = !builder.Environment.IsDevelopment();
        options.IncludeErrorDetails = builder.Environment.IsDevelopment();
        options.TokenValidationParameters = AuthSetup.BuildValidationParameters(auth.Value, jwks.Resolve);
    });
builder.Services.AddAuthorization(o =>
{
    // Every endpoint requires an authenticated user with a user id, unless it opts out with [AllowAnonymous].
    o.FallbackPolicy = new Microsoft.AspNetCore.Authorization.AuthorizationPolicyBuilder()
        .RequireAuthenticatedUser()
        .RequireClaim("sub")
        // Supabase anonymous sign-ins also carry aud=authenticated; KasiFlow requires a real account.
        .RequireAssertion(ctx => ctx.User.FindFirst("is_anonymous")?.Value != "true")
        .Build();
    o.DefaultPolicy = o.FallbackPolicy;
});

// ---------------------------------------------------------------- rate limiting
builder.Services.AddRateLimiter(o =>
{
    o.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    static string UserOrIp(HttpContext c) =>
        c.User.FindFirst("sub")?.Value ?? c.Connection.RemoteIpAddress?.ToString() ?? "unknown";

    o.GlobalLimiter = PartitionedRateLimiter.Create<HttpContext, string>(c =>
        RateLimitPartition.GetFixedWindowLimiter(UserOrIp(c), _ => new FixedWindowRateLimiterOptions
        { PermitLimit = 300, Window = TimeSpan.FromMinutes(1), QueueLimit = 0 }));
    o.AddPolicy("writes", c => RateLimitPartition.GetFixedWindowLimiter(UserOrIp(c), _ => new FixedWindowRateLimiterOptions
        { PermitLimit = 60, Window = TimeSpan.FromMinutes(1), QueueLimit = 0 }));
    o.AddPolicy("exports", c => RateLimitPartition.GetFixedWindowLimiter(UserOrIp(c), _ => new FixedWindowRateLimiterOptions
        { PermitLimit = 20, Window = TimeSpan.FromMinutes(1), QueueLimit = 0 }));
    // Provider webhooks: per source IP, generous enough for bursts and retries.
    o.AddPolicy("webhooks", c => RateLimitPartition.GetFixedWindowLimiter(c.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        _ => new FixedWindowRateLimiterOptions { PermitLimit = 600, Window = TimeSpan.FromMinutes(1), QueueLimit = 0 }));
    o.AddPolicy("public", c => RateLimitPartition.GetFixedWindowLimiter(c.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        _ => new FixedWindowRateLimiterOptions { PermitLimit = 60, Window = TimeSpan.FromMinutes(1), QueueLimit = 0 }));
});

// ---------------------------------------------------------------- web
builder.Services.AddCors(o => o.AddDefaultPolicy(p => p
    .WithOrigins(corsOptions.AllowedOrigins)
    .WithHeaders("Authorization", "Content-Type", "Idempotency-Key", BusinessContext.HeaderName)
    .WithMethods("GET", "POST", "PUT", "PATCH", "DELETE")
    .WithExposedHeaders("Content-Disposition")
    .SetPreflightMaxAge(TimeSpan.FromMinutes(10))));
builder.Services.AddControllers()
    // Do not echo serializer exception details (type names, positions) to clients.
    .AddJsonOptions(o => o.AllowInputFormatterExceptionMessages = false);
builder.Services.AddProblemDetails(o => o.CustomizeProblemDetails = ctx =>
{
    ctx.ProblemDetails.Extensions["traceId"] = ctx.HttpContext.TraceIdentifier;
    // Never leak exception details to clients.
    ctx.ProblemDetails.Extensions.Remove("exception");
});
builder.Services.AddExceptionHandler<GlobalExceptionHandler>();
builder.Services.AddOpenApi();
builder.Services.AddHealthChecks().AddCheck<DatabaseHealthCheck>("database", tags: new[] { "ready" });
var trustAllProxies = config.GetValue<bool>("App:TrustForwardedHeadersFromAnyProxy");
builder.Services.Configure<ForwardedHeadersOptions>(o =>
{
    o.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
    // By default only loopback proxies are trusted. On platforms where the app is ONLY reachable through the
    // platform's TLS-terminating proxy (Render, Railway, Azure Container Apps, ...), set
    // App__TrustForwardedHeadersFromAnyProxy=true so client IPs (rate limiting) and https detection work.
    if (trustAllProxies)
    {
        o.KnownIPNetworks.Clear();
        o.KnownProxies.Clear();
    }
});

var app = builder.Build();

// ---------------------------------------------------------------- CLI: migrate / seed-demo
if (DatabaseCommands.IsCommand(args))
{
    var logger = app.Services.GetRequiredService<ILoggerFactory>().CreateLogger("KasiFlow.Database");
    return await DatabaseCommands.RunAsync(args, app.Services, app.Environment, logger);
}

// ---------------------------------------------------------------- pipeline
app.UseForwardedHeaders();
app.UseExceptionHandler();
app.UseStatusCodePages();
if (!app.Environment.IsDevelopment())
{
    app.UseHsts();
    app.UseHttpsRedirection();
}
app.UseMiddleware<SecurityHeadersMiddleware>();
app.UseCors();
app.UseAuthentication();
app.UseRateLimiter();
app.UseAuthorization();

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi().AllowAnonymous();
    app.UseSwaggerUI(o =>
    {
        o.SwaggerEndpoint("/openapi/v1.json", "KasiFlow SA API");
        o.RoutePrefix = "swagger";
    });
}

app.MapHealthChecks("/health", new HealthCheckOptions { Predicate = _ => false }).AllowAnonymous();
app.MapHealthChecks("/health/ready", new HealthCheckOptions { Predicate = r => r.Tags.Contains("ready") }).AllowAnonymous();
app.MapControllers();

// Provider webhooks. Anonymous by necessity (providers have no user token); trust comes from the provider's signature,
// checked against a key held only on the server. A minimal endpoint is used so the raw body is read exactly as sent
// (MVC form binding would consume form-encoded bodies such as SnapScan's before the signature can be checked).
app.MapPost("/api/webhooks/{provider}/{connectionId:guid}", async (string provider, Guid connectionId, HttpRequest request,
        PaymentIngestionService ingestion, CancellationToken ct) =>
    {
        if (request.ContentLength is > PaymentIngestionService.MaxWebhookBytes)
            return Results.Json(new { outcome = "rejected", message = "Payload too large." }, statusCode: StatusCodes.Status413PayloadTooLarge);
        using var ms = new MemoryStream();
        var buffer = new byte[8192];
        int read;
        while ((read = await request.Body.ReadAsync(buffer, ct)) > 0)
        {
            ms.Write(buffer, 0, read);
            if (ms.Length > PaymentIngestionService.MaxWebhookBytes) break; // the ingestion service rejects and logs it
        }
        var result = await ingestion.IngestWebhookAsync(provider.ToLowerInvariant(), connectionId, ms.ToArray(), request.Headers, ct);
        return Results.Json(new { outcome = result.Outcome, message = result.Message }, statusCode: result.StatusCode);
    })
    .AllowAnonymous()
    .RequireRateLimiting("webhooks")
    .DisableAntiforgery();

await app.RunAsync();
return 0;

/// <summary>Readiness check: can we reach PostgreSQL? Returns no connection details.</summary>
public sealed class DatabaseHealthCheck(IDbConnectionFactory db) : IHealthCheck
{
    public async Task<HealthCheckResult> CheckHealthAsync(HealthCheckContext context, CancellationToken cancellationToken = default)
    {
        try
        {
            await using var conn = await db.OpenAsync(cancellationToken);
            await using var cmd = conn.CreateCommand();
            cmd.CommandText = "SELECT 1";
            await cmd.ExecuteScalarAsync(cancellationToken);
            return HealthCheckResult.Healthy();
        }
        catch (Exception)
        {
            return HealthCheckResult.Unhealthy("Database unreachable.");
        }
    }
}

public partial class Program;
