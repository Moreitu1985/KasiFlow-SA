using System.Net;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using KasiFlow.Api.Repositories;
using KasiFlow.Core.Integrations;

namespace KasiFlow.Api.Services.Integrations;

public sealed record CapabilityDto(string Key, string Label, bool Supported, string? Note = null);

public sealed record ProviderCardDto(string Key, string Name, string Category, string Availability, string Environment,
    string Summary, IReadOnlyList<CapabilityDto> Capabilities, IReadOnlyList<string> SetupSteps, string? DocsUrl, string? Notes,
    bool CanConnect);

public sealed record ConnectionTestResult(bool Ok, string Status, string? Error, string? Hint);

public sealed record WebhookParseResult(bool SignatureValid, IReadOnlyList<NormalizedEvent> Events, string Verification, string? Error);

/// <summary>A payment provider adapter implements only what that provider genuinely supports.</summary>
public interface IPaymentProviderAdapter
{
    string Key { get; }
    bool SupportsWebhooks { get; }
    bool SupportsPolling { get; }
    bool ConfirmsWebhooksViaApi { get; }
    Task<ConnectionTestResult> TestAsync(ConnectionRow connection, CancellationToken ct);
    WebhookParseResult ParseWebhook(ConnectionRow connection, byte[] rawBody, IHeaderDictionary headers);
    Task<IReadOnlyList<NormalizedEvent>> FetchSinceAsync(ConnectionRow connection, DateTimeOffset since, CancellationToken ct);
    Task<NormalizedEvent?> ConfirmPaymentAsync(ConnectionRow connection, string externalPaymentId, CancellationToken ct);
}

/// <summary>Reads provider secrets from configuration / environment / a secret manager. Secrets never go into the database;
/// a connection stores only the <c>credential_ref</c> naming which configured secret to use.</summary>
public sealed class IntegrationSecrets(IConfiguration config, ILogger<IntegrationSecrets> logger)
{
    private readonly Lazy<byte[]> _sandboxKey = new(() =>
    {
        var configured = config["Integrations:SandboxSigningKey"];
        if (!string.IsNullOrWhiteSpace(configured) && configured.Length >= 32) return Encoding.UTF8.GetBytes(configured);
        logger.LogWarning("Integrations:SandboxSigningKey is not set; using a random per-process sandbox key.");
        return RandomNumberGenerator.GetBytes(32);
    });

    /// <summary>Per-connection sandbox webhook key derived from the server key (never stored).</summary>
    public byte[] SandboxKeyFor(Guid connectionId) => HMACSHA256.HashData(_sandboxKey.Value, connectionId.ToByteArray());

    public string? SnapScanApiKey(string? credentialRef) =>
        credentialRef is null ? null : config[$"Integrations:SnapScan:Credentials:{credentialRef}:ApiKey"];

    public string? SnapScanWebhookKey(string? credentialRef) =>
        credentialRef is null ? null : config[$"Integrations:SnapScan:Credentials:{credentialRef}:WebhookKey"];

    public string SnapScanBaseUrl => config["Integrations:SnapScan:BaseUrl"] ?? "https://pos.snapscan.io/merchant/api/v1/";
}

/// <summary>Clearly labelled demo simulator. Events are signed with a derived sandbox key and processed by the same
/// pipeline as real providers, but they never represent real money and only run on demo businesses.</summary>
public sealed class SandboxAdapter(IntegrationSecrets secrets) : IPaymentProviderAdapter
{
    public const string SignatureHeader = "X-KasiFlow-Sandbox-Signature";
    public string Key => ProviderKeys.Sandbox;
    public bool SupportsWebhooks => true;
    public bool SupportsPolling => false;
    public bool ConfirmsWebhooksViaApi => false;

    public Task<ConnectionTestResult> TestAsync(ConnectionRow c, CancellationToken ct) =>
        Task.FromResult(c.BusinessIsDemo
            ? new ConnectionTestResult(true, "connected", null, null)
            : new ConnectionTestResult(false, "error", "The sandbox only runs on the fictional demo business.", "Load the demo business and connect the sandbox there."));

    public WebhookParseResult ParseWebhook(ConnectionRow c, byte[] rawBody, IHeaderDictionary headers)
    {
        var valid = WebhookSignatures.VerifySandbox(secrets.SandboxKeyFor(c.Id), rawBody, headers[SignatureHeader].ToString());
        if (!valid) return new WebhookParseResult(false, [], VerificationMethods.SandboxSigned, "Invalid sandbox signature.");
        try
        {
            return new WebhookParseResult(true, [SandboxPayload.Deserialize(rawBody)], VerificationMethods.SandboxSigned, null);
        }
        catch (Exception ex) when (ex is JsonException or FormatException)
        {
            return new WebhookParseResult(true, [], VerificationMethods.SandboxSigned, "Malformed sandbox payload.");
        }
    }

    public Task<IReadOnlyList<NormalizedEvent>> FetchSinceAsync(ConnectionRow c, DateTimeOffset since, CancellationToken ct) =>
        Task.FromResult<IReadOnlyList<NormalizedEvent>>([]);

    public Task<NormalizedEvent?> ConfirmPaymentAsync(ConnectionRow c, string externalPaymentId, CancellationToken ct) =>
        Task.FromResult<NormalizedEvent?>(null);

    public (byte[] Body, string Signature) Sign(Guid connectionId, NormalizedEvent e)
    {
        var body = SandboxPayload.Serialize(e);
        return (body, WebhookSignatures.SignSandbox(secrets.SandboxKeyFor(connectionId), body));
    }
}

/// <summary>
/// SnapScan merchant API adapter, written against https://developer.getsnapscan.co.za/ (checked 2026-10-16):
/// HTTP Basic auth with the API key as username; GET /payments (startDate, perPage, page) and GET /payments/{id};
/// webhooks POST form-encoded <c>payload</c> JSON signed with <c>Authorization: SnapScan signature=&lt;HMAC-SHA256 hex&gt;</c>
/// for completed and errored payments only. SnapScan describes webhooks as an unauthenticated stream, so every webhook
/// payment is re-confirmed with GET /payments/{id} before it is trusted. Not tested against a live merchant account.
/// </summary>
public sealed class SnapScanAdapter(IHttpClientFactory http, IntegrationSecrets secrets, ILogger<SnapScanAdapter> logger) : IPaymentProviderAdapter
{
    public string Key => ProviderKeys.SnapScan;
    public bool SupportsWebhooks => true;
    public bool SupportsPolling => true;
    public bool ConfirmsWebhooksViaApi => true;
    private const int MaxPages = 20;

    private HttpClient Client(ConnectionRow c)
    {
        var key = secrets.SnapScanApiKey(c.CredentialRef) ?? throw new InvalidOperationException("SnapScan API key is not configured.");
        var client = http.CreateClient("snapscan");
        client.BaseAddress = new Uri(secrets.SnapScanBaseUrl);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Basic", Convert.ToBase64String(Encoding.ASCII.GetBytes(key + ":")));
        return client;
    }

    public async Task<ConnectionTestResult> TestAsync(ConnectionRow c, CancellationToken ct)
    {
        if (string.IsNullOrEmpty(secrets.SnapScanApiKey(c.CredentialRef)))
            return new ConnectionTestResult(false, "awaiting_credentials", "No SnapScan API key is configured for this connection.",
                $"Ask SnapScan (help@snapscan.co.za) for merchant API access, then set Integrations__SnapScan__Credentials__{c.CredentialRef ?? "<ref>"}__ApiKey and __WebhookKey on the API server.");
        try
        {
            using var res = await Client(c).GetAsync("payments?perPage=1", ct);
            return res.StatusCode switch
            {
                HttpStatusCode.OK => new ConnectionTestResult(true, "connected", null, null),
                HttpStatusCode.Unauthorized => new ConnectionTestResult(false, "error", "SnapScan rejected the API key (401).", "Check the API key configured on the server."),
                _ => new ConnectionTestResult(false, "error", $"SnapScan returned HTTP {(int)res.StatusCode}.", "Try again later or contact SnapScan support.")
            };
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException)
        {
            logger.LogWarning("SnapScan connection test failed: {Message}", ex.Message);
            return new ConnectionTestResult(false, "error", "Could not reach SnapScan.", "Check the server's internet access and try again.");
        }
    }

    public WebhookParseResult ParseWebhook(ConnectionRow c, byte[] rawBody, IHeaderDictionary headers)
    {
        var key = secrets.SnapScanWebhookKey(c.CredentialRef);
        if (string.IsNullOrEmpty(key)) return new WebhookParseResult(false, [], VerificationMethods.SignatureVerified, "Webhook key not configured.");
        if (!WebhookSignatures.VerifySnapScan(key, rawBody, headers.Authorization.ToString()))
            return new WebhookParseResult(false, [], VerificationMethods.SignatureVerified, "Invalid SnapScan signature.");
        try
        {
            return new WebhookParseResult(true, [SnapScanMapper.FromWebhookBody(rawBody)], VerificationMethods.SignatureVerified, null);
        }
        catch (Exception ex) when (ex is JsonException or FormatException or KeyNotFoundException or InvalidOperationException)
        {
            return new WebhookParseResult(true, [], VerificationMethods.SignatureVerified, "Malformed SnapScan payload.");
        }
    }

    public async Task<IReadOnlyList<NormalizedEvent>> FetchSinceAsync(ConnectionRow c, DateTimeOffset since, CancellationToken ct)
    {
        var client = Client(c);
        var list = new List<NormalizedEvent>();
        for (var page = 1; page <= MaxPages; page++)
        {
            using var res = await client.GetAsync($"payments?startDate={Uri.EscapeDataString(since.UtcDateTime.ToString("yyyy-MM-ddTHH:mm:ssZ"))}&perPage=100&page={page}", ct);
            if (res.StatusCode == HttpStatusCode.Unauthorized) throw new InvalidOperationException("SnapScan rejected the API key (401).");
            res.EnsureSuccessStatusCode();
            using var doc = JsonDocument.Parse(await res.Content.ReadAsStringAsync(ct));
            foreach (var p in doc.RootElement.EnumerateArray()) list.Add(SnapScanMapper.FromPayment(p));
            var next = res.Headers.TryGetValues("X-Next-Page", out var v) ? v.FirstOrDefault() : null;
            if (string.IsNullOrWhiteSpace(next)) break;
        }
        return list;
    }

    public async Task<NormalizedEvent?> ConfirmPaymentAsync(ConnectionRow c, string externalPaymentId, CancellationToken ct)
    {
        if (!long.TryParse(externalPaymentId, out _)) return null;
        using var res = await Client(c).GetAsync($"payments/{externalPaymentId}", ct);
        if (res.StatusCode == HttpStatusCode.NotFound) return null;
        res.EnsureSuccessStatusCode();
        using var doc = JsonDocument.Parse(await res.Content.ReadAsStringAsync(ct));
        return SnapScanMapper.FromPayment(doc.RootElement);
    }
}

public sealed class PaymentProviderRegistry(IEnumerable<IPaymentProviderAdapter> adapters)
{
    private readonly Dictionary<string, IPaymentProviderAdapter> _map = adapters.ToDictionary(a => a.Key);

    public IPaymentProviderAdapter? Get(string key) => _map.GetValueOrDefault(key);

    /// <summary>The Integrations Centre catalogue. Availability is stated honestly.</summary>
    public static IReadOnlyList<ProviderCardDto> Catalogue(bool isDemoBusiness) =>
    [
        new(ProviderKeys.Sandbox, "KasiFlow sandbox (demo simulator)", "payment", "sandbox_only", "sandbox",
            "Simulates POS sales, QR payments, failures, refunds, settlements and duplicate webhooks through the real processing pipeline. Never real money.",
            [new("payments", "Payments (pending, completed, failed, reversed)", true), new("refunds", "Refunds", true),
             new("settlements", "Settlements with fees", true), new("line_items", "Product line items (stock)", true),
             new("webhooks", "Signed webhooks", true), new("polling", "Scheduled sync", false)],
            ["Load the demo business (Settings → Load demo data).", "Connect the sandbox here.", "Use the simulator buttons to send events."],
            null, isDemoBusiness ? "Available on this demo business." : "Only available on the fictional demo business, to keep simulated data out of real records.",
            isDemoBusiness),
        new(ProviderKeys.SnapScan, "SnapScan", "payment", "available", "production",
            "QR and card payments through SnapScan's merchant API. Payments are fetched on a schedule and webhooks are verified, then re-confirmed through the API.",
            [new("payments", "Retrieve payments and status", true), new("webhooks", "Webhooks for completed and failed payments", true, "Signed with your Webhook Authentication Key"),
             new("refunds", "Refunds", true, "Reported as payments with transactionType 'refund'"),
             new("settlements", "Settlement grouping", true, "By statement reference; SnapScan does not return fees or net amounts"),
             new("cash_up", "Cash-up periods", false, "Available in SnapScan's API; not used by KasiFlow yet"),
             new("line_items", "Product line items", false, "Not provided by SnapScan"), new("staff", "Staff member per sale", false, "Not provided by SnapScan")],
            ["Ask SnapScan (help@snapscan.co.za) for merchant API access and a Webhook Authentication Key.",
             "Choose a short credential name here (for example 'main').",
             "On the API server, set Integrations__SnapScan__Credentials__<name>__ApiKey and __WebhookKey (never in the browser or the database).",
             "Ask SnapScan to send webhooks to the URL shown after you connect.", "Press Test connection. It shows Connected only after SnapScan accepts the key."],
            "https://developer.getsnapscan.co.za/", "Built against SnapScan's published documentation. Not yet tested with a live merchant account.", true),
        new(ProviderKeys.Yoco, "Yoco", "payment", "planned", "production",
            "Card machine and online payments.",
            [new("payments", "Payments", false, "Awaiting provider access")],
            ["Yoco requires an integration/partnership request; production access needs the app to be live with Yoco merchants."],
            "https://support.yoco.help/en/articles/764452-integrations-partnerships-at-yoco", "Planned — awaiting provider access.", false),
        new("pos_generic", "Other POS systems", "pos", "planned", "production",
            "Point-of-sale systems that can send sales with product lines.",
            [new("line_items", "Sales with product lines", false, "Planned")], ["Not available yet."], null, "Planned.", false),
        new("csv_export", "Accounting export (CSV)", "accounting", "available", "production",
            "Export transactions, debts, bills and summaries for your accountant or accounting software.",
            [new("export", "CSV export", true)], ["Go to Reports → Export CSV."], null, "Built in. No connection needed.", false),
        new("accounting_sync", "Xero / QuickBooks sync", "accounting", "planned", "production",
            "Automatic sync with accounting software.", [new("sync", "Two-way sync", false, "Planned")], ["Not available yet."], null, "Planned.", false),
        new("barcode", "Barcode scanner / camera", "inventory_device", "planned", "production",
            "Scan barcodes to find products.", [new("scan", "Camera or USB scanner input", false, "Planned — barcodes can be stored on products now")],
            ["Not available yet. Payment terminals cannot be used as barcode scanners."], null, "Planned.", false),
        new("in_app", "In-app notifications", "notification", "available", "production",
            "Alerts and the daily briefing inside KasiFlow.", [new("in_app", "In-app alerts", true)], ["On by default. Change preferences under Notifications."], null, "Active.", false),
        new("messaging", "Email / SMS / WhatsApp notifications", "notification", "planned", "production",
            "Send alerts outside the app.", [new("send", "Send messages", false, "No messaging provider configured")],
            ["Not configured. KasiFlow never sends messages through an unconfigured service."], null, "Planned.", false),
    ];
}
