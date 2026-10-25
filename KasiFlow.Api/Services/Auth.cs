using System.Security.Claims;
using System.Text;
using KasiFlow.Api.Configuration;
using KasiFlow.Api.Middleware;
using KasiFlow.Api.Repositories;
using KasiFlow.Core.Access;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;

namespace KasiFlow.Api.Services;

/// <summary>
/// Caches the Supabase project's public signing keys (JWKS) for ES256/RS256 access tokens.
/// Keys are refreshed periodically and on demand when a token presents an unknown key id.
/// </summary>
public sealed class JwksKeyProvider(IHttpClientFactory httpClientFactory, IOptions<AuthOptions> options, ILogger<JwksKeyProvider> logger)
    : BackgroundService
{
    private volatile IReadOnlyList<SecurityKey> _keys = Array.Empty<SecurityKey>();
    private DateTimeOffset _lastRefresh = DateTimeOffset.MinValue;
    private readonly SemaphoreSlim _gate = new(1, 1);
    private static readonly TimeSpan RefreshInterval = TimeSpan.FromMinutes(10);
    private static readonly TimeSpan MinOnDemandInterval = TimeSpan.FromSeconds(30);

    public IReadOnlyList<SecurityKey> Keys => _keys;

    public IEnumerable<SecurityKey> Resolve(string? kid)
    {
        var keys = _keys;
        if (!string.IsNullOrEmpty(kid) && keys.All(k => k.KeyId != kid) && DateTimeOffset.UtcNow - _lastRefresh > MinOnDemandInterval)
        {
            // Unknown key id (e.g. key rotation): refresh in the background; this request may fail once.
            _ = RefreshAsync(CancellationToken.None);
        }
        return string.IsNullOrEmpty(kid) ? keys : keys.Where(k => k.KeyId == kid);
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (options.Value.DisableJwks || string.IsNullOrWhiteSpace(options.Value.SupabaseUrl) && string.IsNullOrWhiteSpace(options.Value.Issuer))
            return;
        while (!stoppingToken.IsCancellationRequested)
        {
            await RefreshAsync(stoppingToken);
            try { await Task.Delay(RefreshInterval, stoppingToken); }
            catch (OperationCanceledException) { return; }
        }
    }

    public async Task RefreshAsync(CancellationToken ct)
    {
        if (!await _gate.WaitAsync(0, ct)) return;
        try
        {
            _lastRefresh = DateTimeOffset.UtcNow;
            var client = httpClientFactory.CreateClient("jwks");
            var json = await client.GetStringAsync(options.Value.JwksUrl, ct);
            var set = new JsonWebKeySet(json);
            var keys = set.GetSigningKeys().ToList();
            _keys = keys;
            logger.LogInformation("Loaded {Count} JWT signing key(s) from JWKS", keys.Count);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogWarning("Could not refresh JWKS: {Message}", ex.Message);
        }
        finally
        {
            _gate.Release();
        }
    }
}

public static class AuthSetup
{
    public static TokenValidationParameters BuildValidationParameters(AuthOptions auth, Func<string?, IEnumerable<SecurityKey>> jwksResolver)
    {
        SecurityKey? symmetric = null;
        if (!string.IsNullOrWhiteSpace(auth.JwtSecret))
        {
            if (auth.JwtSecret.Length < 32)
                throw new InvalidOperationException("Auth:JwtSecret must be at least 32 characters.");
            symmetric = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(auth.JwtSecret));
        }

        return new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidIssuer = auth.ResolvedIssuer,
            ValidateAudience = true,
            ValidAudience = auth.Audience,
            ValidateLifetime = true,
            RequireExpirationTime = true,
            RequireSignedTokens = true,
            ValidateIssuerSigningKey = true,
            ClockSkew = TimeSpan.FromSeconds(30),
            ValidAlgorithms = new[] { "ES256", "RS256", "HS256" },
            NameClaimType = "sub",
            RoleClaimType = "role",
            IssuerSigningKeyResolver = (_, _, kid, _) =>
            {
                var keys = new List<SecurityKey>(auth.DisableJwks ? Array.Empty<SecurityKey>() : jwksResolver(kid));
                if (symmetric is not null) keys.Add(symmetric);
                return keys;
            }
        };
    }
}

public interface ICurrentUser
{
    Guid UserId { get; }
    string? Email { get; }
    /// <summary>The phone number Supabase verified with a one-time SMS code (null when the account has none).</summary>
    string? Phone => null;
}

/// <summary>Identity derived ONLY from the validated access token ("sub" claim). Never from request data.</summary>
public sealed class HttpCurrentUser(IHttpContextAccessor accessor) : ICurrentUser
{
    private ClaimsPrincipal Principal => accessor.HttpContext?.User ?? throw new InvalidOperationException("No HTTP context.");

    public Guid UserId
    {
        get
        {
            var sub = Principal.FindFirst("sub")?.Value ?? Principal.FindFirst(ClaimTypes.NameIdentifier)?.Value;
            if (sub is null || !Guid.TryParse(sub, out var id))
                throw new UnauthorizedAccessException("The access token does not identify a user.");
            return id;
        }
    }

    public string? Email => Principal.FindFirst("email")?.Value is { Length: > 0 } e ? e : Principal.FindFirst(ClaimTypes.Email)?.Value;

    public string? Phone => Principal.FindFirst("phone")?.Value is { Length: > 0 } p ? p : null;
}

public interface IBusinessContext
{
    /// <summary>Returns the business the caller is acting on, after verifying active membership.
    /// Throws <see cref="NotFoundException"/> when the business does not exist or is not the caller's.</summary>
    Task<Guid> GetBusinessIdAsync(CancellationToken ct = default);

    /// <summary>The caller's role, branches and permissions in the active business.</summary>
    Task<AccessContext> GetAccessAsync(CancellationToken ct = default);

    /// <summary>Resolves access and requires at least one of the given permissions (403 otherwise).</summary>
    Task<AccessContext> RequireAsync(params Permission[] anyOf);
}

/// <summary>Resolves the active business from the <c>X-Business-Id</c> header, checks that the authenticated
/// user is an active member and loads their role and branches. Prevents insecure direct object references
/// across businesses; role permissions are enforced here, centrally, not only in the frontend.</summary>
public sealed class BusinessContext(IHttpContextAccessor accessor, ICurrentUser user, IBusinessRepository businesses) : IBusinessContext
{
    public const string HeaderName = "X-Business-Id";
    private AccessContext? _access;

    public async Task<Guid> GetBusinessIdAsync(CancellationToken ct = default) => (await GetAccessAsync(ct)).BusinessId;

    public async Task<AccessContext> GetAccessAsync(CancellationToken ct = default)
    {
        if (_access is not null) return _access;
        var header = accessor.HttpContext?.Request.Headers[HeaderName].ToString();
        Guid businessId;
        if (string.IsNullOrWhiteSpace(header))
        {
            businessId = await businesses.GetDefaultBusinessIdAsync(user.UserId, ct)
                         ?? throw new NotFoundException("No business profile found. Create your business profile first.");
        }
        else if (!Guid.TryParse(header, out businessId))
        {
            throw new BadRequestException($"The {HeaderName} header must be a valid id.");
        }
        var m = await businesses.GetMembershipAsync(businessId, user.UserId, ct);
        if (m is null || !m.IsActive) throw new NotFoundException("Business not found.");
        _access = new AccessContext(businessId, user.UserId, m.Role, m.BranchIds.ToHashSet(), m.IsDemo);
        return _access;
    }

    public async Task<AccessContext> RequireAsync(params Permission[] anyOf)
    {
        var access = await GetAccessAsync();
        if (anyOf.Length > 0 && !anyOf.Any(access.Can))
            throw new ForbiddenException($"Your role ({Roles.Label(access.Role)}) does not allow this action.");
        return access;
    }
}
