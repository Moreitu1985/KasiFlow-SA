using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Web;

namespace KasiFlow.Core.Integrations;

public static class WebhookSignatures
{
    public static string HmacHex(byte[] key, byte[] body) =>
        Convert.ToHexString(HMACSHA256.HashData(key, body)).ToLowerInvariant();

    private static bool FixedTimeEqualsHex(string expectedHex, string? providedHex)
    {
        if (string.IsNullOrEmpty(providedHex)) return false;
        var a = Encoding.ASCII.GetBytes(expectedHex);
        var b = Encoding.ASCII.GetBytes(providedHex.Trim().ToLowerInvariant());
        return a.Length == b.Length && CryptographicOperations.FixedTimeEquals(a, b);
    }

    /// <summary>SnapScan: <c>Authorization: SnapScan signature=&lt;hex HMAC-SHA256 of the raw body&gt;</c>, keyed with the
    /// merchant's Webhook Authentication Key (https://developer.getsnapscan.co.za/docs/webhooks/).</summary>
    public static bool VerifySnapScan(string webhookAuthKey, byte[] rawBody, string? authorizationHeader)
    {
        const string prefix = "SnapScan signature=";
        if (string.IsNullOrEmpty(webhookAuthKey) || authorizationHeader is null || !authorizationHeader.StartsWith(prefix, StringComparison.Ordinal))
            return false;
        var expected = HmacHex(Encoding.UTF8.GetBytes(webhookAuthKey), rawBody);
        return FixedTimeEqualsHex(expected, authorizationHeader[prefix.Length..]);
    }

    /// <summary>KasiFlow sandbox: <c>X-KasiFlow-Sandbox-Signature: sha256=&lt;hex&gt;</c>.</summary>
    public static bool VerifySandbox(byte[] key, byte[] rawBody, string? header)
    {
        const string prefix = "sha256=";
        if (key.Length == 0 || header is null || !header.StartsWith(prefix, StringComparison.Ordinal)) return false;
        return FixedTimeEqualsHex(HmacHex(key, rawBody), header[prefix.Length..]);
    }

    public static string SignSandbox(byte[] key, byte[] rawBody) => "sha256=" + HmacHex(key, rawBody);
}

/// <summary>Maps SnapScan payment objects (https://developer.snapscan.co.za/docs/payment-object/) to normalized events.
/// Documented facts relied on: amounts are integer cents; status is completed | error | pending;
/// transactionType is payment | refund; statementReference appears once the payment has settled.
/// SnapScan does not provide fee or net settlement amounts, staff or line items.</summary>
public static class SnapScanMapper
{
    public static NormalizedEvent FromPayment(JsonElement p)
    {
        var id = p.GetProperty("id").GetRawText().Trim('"');
        var rawStatus = Str(p, "status") ?? "pending";
        var status = rawStatus switch
        {
            "completed" => ProviderPaymentStatuses.Completed,
            "error" => ProviderPaymentStatuses.Failed,
            _ => ProviderPaymentStatuses.Pending
        };
        var kind = Str(p, "transactionType") == "refund" ? PaymentKinds.Refund : PaymentKinds.Payment;
        DateTimeOffset? date = DateTimeOffset.TryParse(Str(p, "date"), CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var d) ? d : null;
        var statement = Str(p, "statementReference");
        return new NormalizedEvent(
            // The statement reference appears once SnapScan settles the payment, so it is part of the event identity:
            // the settled version of a payment is a new event, while plain repeats stay duplicates.
            ExternalEventId: statement is null ? $"payment:{id}:{rawStatus}" : $"payment:{id}:{rawStatus}:stmt:{statement}",
            EventType: EventTypes.Payment,
            ExternalPaymentId: id,
            Kind: kind,
            Method: string.IsNullOrEmpty(Str(p, "deviceSerialNumber")) ? "qr" : "card",
            Status: status,
            GrossCents: Long(p, "totalAmount"),
            TipCents: Long(p, "tipAmount"),
            FeeCents: null,
            NetCents: null,
            MerchantReference: Str(p, "merchantReference"),
            UserReference: Str(p, "userReference"),
            StatementReference: statement,
            OccurredAt: date,
            DeviceId: Str(p, "deviceSerialNumber"));
    }

    /// <summary>Webhook bodies are <c>application/x-www-form-urlencoded</c> with the JSON under <c>payload</c>.</summary>
    public static NormalizedEvent FromWebhookBody(byte[] rawBody)
    {
        var form = HttpUtility.ParseQueryString(Encoding.UTF8.GetString(rawBody));
        var payload = form["payload"] ?? throw new FormatException("Missing 'payload' field.");
        using var doc = JsonDocument.Parse(payload);
        return FromPayment(doc.RootElement);
    }

    private static string? Str(JsonElement e, string name) =>
        e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    private static long Long(JsonElement e, string name) =>
        e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Number ? v.GetInt64() : 0;
}

/// <summary>The sandbox simulator's wire format (JSON). Same normalisation pipeline as real providers.</summary>
public static class SandboxPayload
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public static byte[] Serialize(NormalizedEvent e) => JsonSerializer.SerializeToUtf8Bytes(e, Json);

    public static NormalizedEvent Deserialize(byte[] body) =>
        JsonSerializer.Deserialize<NormalizedEvent>(body, Json) ?? throw new FormatException("Empty sandbox payload.");
}
