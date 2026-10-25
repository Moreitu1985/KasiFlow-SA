using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;

namespace KasiFlow.Core.Common;

public static partial class Slug
{
    [GeneratedRegex("^[a-z0-9]+(-[a-z0-9]+)*$")]
    private static partial Regex ValidRegex();

    public static bool IsValid(string? slug) =>
        slug is not null && slug.Length is >= 3 and <= 80 && ValidRegex().IsMatch(slug);

    /// <summary>Builds a URL-safe slug from a business name, e.g. "Thato's Barber Studio" → "thatos-barber-studio".</summary>
    public static string FromName(string name)
    {
        var normalized = name.Normalize(NormalizationForm.FormD);
        var sb = new StringBuilder();
        var lastDash = true;
        foreach (var ch in normalized)
        {
            if (CharUnicodeInfo.GetUnicodeCategory(ch) == UnicodeCategory.NonSpacingMark) continue;
            var c = char.ToLowerInvariant(ch);
            if (c is >= 'a' and <= 'z' or >= '0' and <= '9')
            {
                sb.Append(c);
                lastDash = false;
            }
            else if (c is '\'' or '’')
            {
                // drop apostrophes entirely: "thato's" → "thatos"
            }
            else if (!lastDash)
            {
                sb.Append('-');
                lastDash = true;
            }
        }
        var slug = sb.ToString().Trim('-');
        if (slug.Length > 60) slug = slug[..60].Trim('-');
        if (slug.Length < 3) slug = (slug + "-business").Trim('-');
        return slug;
    }
}

/// <summary>Minimal RFC 4180 CSV writer with spreadsheet formula-injection protection.</summary>
public sealed class CsvBuilder
{
    private readonly StringBuilder _sb = new();

    public CsvBuilder Row(params string?[] cells)
    {
        for (var i = 0; i < cells.Length; i++)
        {
            if (i > 0) _sb.Append(',');
            _sb.Append(Escape(cells[i]));
        }
        _sb.Append("\r\n");
        return this;
    }

    public CsvBuilder Blank() { _sb.Append("\r\n"); return this; }

    public static string Escape(string? value)
    {
        if (string.IsNullOrEmpty(value)) return "";
        var v = value;
        // Neutralise values a spreadsheet would execute as a formula (=, +, -, @, tab, CR).
        // Negative numbers produced by our own formatting are safe and left as-is.
        if (v[0] is '=' or '+' or '@' or '\t' or '\r' || (v[0] == '-' && !IsPlainNumber(v)))
            v = "'" + v;
        if (v.IndexOfAny(new[] { ',', '"', '\n', '\r' }) >= 0)
            v = "\"" + v.Replace("\"", "\"\"") + "\"";
        return v;
    }

    private static bool IsPlainNumber(string v) =>
        decimal.TryParse(v, NumberStyles.AllowLeadingSign | NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture, out _);

    public override string ToString() => _sb.ToString();
}
