using System.Text.RegularExpressions;

namespace KasiFlow.Core.Validation;

/// <summary>
/// Small, dependency-free validation helper (the project's FluentValidation equivalent).
/// Collects errors per field name (camelCase, matching the JSON contract).
/// </summary>
public sealed partial class ValidationErrors
{
    private readonly Dictionary<string, List<string>> _errors = new(StringComparer.Ordinal);

    public bool IsValid => _errors.Count == 0;

    public IReadOnlyDictionary<string, string[]> ToDictionary() =>
        _errors.ToDictionary(kv => kv.Key, kv => kv.Value.ToArray(), StringComparer.Ordinal);

    public ValidationErrors Add(string field, string message)
    {
        if (!_errors.TryGetValue(field, out var list)) _errors[field] = list = new List<string>();
        list.Add(message);
        return this;
    }

    public ValidationErrors Required(string field, string? value, int min = 1, int max = 200)
    {
        if (string.IsNullOrWhiteSpace(value)) return Add(field, "This field is required.");
        var len = value.Trim().Length;
        if (len < min) Add(field, $"Must be at least {min} characters.");
        if (len > max) Add(field, $"Must be at most {max} characters.");
        return this;
    }

    public ValidationErrors Optional(string field, string? value, int max)
    {
        if (value is not null && value.Trim().Length > max) Add(field, $"Must be at most {max} characters.");
        return this;
    }

    public ValidationErrors OneOf(string field, string? value, IReadOnlySet<string> allowed, bool required = true)
    {
        if (value is null)
        {
            if (required) Add(field, "This field is required.");
            return this;
        }
        if (!allowed.Contains(value)) Add(field, $"'{Truncate(value)}' is not a valid value.");
        return this;
    }

    public ValidationErrors PositiveCents(string field, long? cents, long max = MaxAmountCents)
    {
        if (cents is null) return Add(field, "This field is required.");
        if (cents <= 0) return Add(field, "Amount must be greater than zero.");
        if (cents > max) Add(field, "Amount is too large.");
        return this;
    }

    public ValidationErrors Email(string field, string? value, bool required)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            if (required) Add(field, "This field is required.");
            return this;
        }
        if (value.Length > 254 || !EmailRegex().IsMatch(value.Trim())) Add(field, "Enter a valid email address.");
        return this;
    }

    public ValidationErrors Phone(string field, string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return this;
        if (!PhoneRegex().IsMatch(value.Trim())) Add(field, "Enter a valid phone number (digits, spaces, + and - only).");
        return this;
    }

    public ValidationErrors HttpsUrl(string field, string? value, int max = 500)
    {
        if (string.IsNullOrWhiteSpace(value)) return this;
        if (value.Length > max || !Uri.TryCreate(value, UriKind.Absolute, out var uri) || uri.Scheme != Uri.UriSchemeHttps)
            Add(field, "Must be a valid https:// link.");
        return this;
    }

    public ValidationErrors DateNotBefore(string field, DateOnly? value, DateOnly min, string message)
    {
        if (value is { } v && v < min) Add(field, message);
        return this;
    }

    public ValidationErrors DateNotAfter(string field, DateOnly? value, DateOnly max, string message)
    {
        if (value is { } v && v > max) Add(field, message);
        return this;
    }

    /// <summary>R100 million upper bound per amount — guards against typos and overflow.</summary>
    public const long MaxAmountCents = 10_000_000_000;

    /// <summary>Earliest allowed financial date — guards against obvious typos like year 0202.</summary>
    public static readonly DateOnly MinDate = new(2000, 1, 1);

    private static string Truncate(string v) => v.Length > 40 ? v[..40] + "…" : v;

    [GeneratedRegex(@"^[^\s@]+@[^\s@]+\.[^\s@]{2,}$")]
    private static partial Regex EmailRegex();

    [GeneratedRegex(@"^\+?[0-9][0-9 \-]{6,18}$")]
    private static partial Regex PhoneRegex();
}
