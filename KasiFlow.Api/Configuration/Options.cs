namespace KasiFlow.Api.Configuration;

public sealed class DatabaseOptions
{
    public const string Section = "Database";

    /// <summary>PostgreSQL connection string. Supply via environment variable
    /// <c>Database__ConnectionString</c> or user-secrets; never commit it.</summary>
    public string ConnectionString { get; set; } = "";
}

public sealed class AuthOptions
{
    public const string Section = "Auth";

    /// <summary>Supabase project URL, e.g. https://abcd.supabase.co. Used to derive the issuer and JWKS URL.</summary>
    public string SupabaseUrl { get; set; } = "";

    /// <summary>Expected token issuer. Defaults to {SupabaseUrl}/auth/v1.</summary>
    public string? Issuer { get; set; }

    /// <summary>Expected audience. Supabase user access tokens use "authenticated".</summary>
    public string Audience { get; set; } = "authenticated";

    /// <summary>Optional legacy HS256 JWT secret (Supabase "Legacy JWT secret"). Prefer asymmetric signing keys.
    /// Also used by automated tests. Must be at least 32 characters when set.</summary>
    public string? JwtSecret { get; set; }

    /// <summary>When false (default) the API fetches the project's public JWKS for ES256/RS256 tokens.</summary>
    public bool DisableJwks { get; set; }

    public string ResolvedIssuer => !string.IsNullOrWhiteSpace(Issuer)
        ? Issuer!.TrimEnd('/')
        : SupabaseUrl.TrimEnd('/') + "/auth/v1";

    public string JwksUrl => ResolvedIssuer + "/.well-known/jwks.json";
}

public sealed class CorsOptions
{
    public const string Section = "Cors";

    /// <summary>Exact origins allowed to call the API, e.g. https://kasiflow.vercel.app. No wildcards.</summary>
    public string[] AllowedOrigins { get; set; } = Array.Empty<string>();
}

public sealed class AppOptions
{
    public const string Section = "App";

    /// <summary>Public web app origin used to build shareable public-profile links.</summary>
    public string PublicWebBaseUrl { get; set; } = "";

    /// <summary>When true, signed-in users can load the fictional demo business with one click
    /// (POST /api/demo/load). On by default only in appsettings.Development.json.</summary>
    public bool EnableDemoData { get; set; }
}
