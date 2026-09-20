using System.Collections;
using System.Globalization;

namespace FbApiTool;

/// <summary>
/// Sorts response rows by what a column actually holds.
///
/// Every cell arrives as a string — the table is built from whatever JSON came
/// back, so there is no typed column to sort on — and sorting those as text
/// gives 10, 15, 2, 20, which is useless on an id or a quantity. So each pair
/// is compared as numbers when both sides are numbers, as dates when both are
/// dates, and as text otherwise.
///
/// Deciding per PAIR rather than per column is deliberate: a column can hold a
/// mix (a quantity column with "N/A" in it), and a column-wide guess made from
/// the first row would then sort the rest wrongly. The mixed case falls back to
/// text for that comparison alone.
/// </summary>
public sealed class RowComparer(string column, bool descending) : IComparer
{
    public int Compare(object? x, object? y)
    {
        var a = Value(x);
        var b = Value(y);
        var result = CompareValues(a, b);
        return descending ? -result : result;
    }

    private string Value(object? row) =>
        row is IDictionary<string, string> d && d.TryGetValue(column, out var v) ? v ?? "" : "";

    /// <summary>Exposed for the self-test: the ordering rule, without the row plumbing.</summary>
    public static int CompareValues(string? left, string? right)
    {
        var a = (left ?? "").Trim();
        var b = (right ?? "").Trim();

        // An empty cell is absence. It sorts to one end rather than mixing in
        // among the values, which is what makes a sorted column scannable.
        var aEmpty = a.Length == 0 || a.Equals("null", StringComparison.OrdinalIgnoreCase);
        var bEmpty = b.Length == 0 || b.Equals("null", StringComparison.OrdinalIgnoreCase);
        if (aEmpty || bEmpty) return aEmpty && bEmpty ? 0 : aEmpty ? -1 : 1;

        if (TryNumber(a, out var na) && TryNumber(b, out var nb)) return na.CompareTo(nb);
        if (TryDate(a, out var da) && TryDate(b, out var db)) return da.CompareTo(db);

        return string.Compare(a, b, StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>
    /// A number, tolerating the shapes a response actually uses: thousands
    /// separators, a leading currency symbol, a trailing percent.
    /// </summary>
    public static bool TryNumber(string s, out double value)
    {
        value = 0;
        if (s.Length == 0) return false;

        var t = s.Trim();
        if (t.Length > 1 && (t[0] == '$' || t[0] == '£' || t[0] == '€')) t = t[1..].Trim();
        if (t.EndsWith('%')) t = t[..^1].Trim();
        if (t.Length == 0) return false;

        // Reject "1.2.3" and "12A" — double.TryParse already does, but a bare
        // sign or separator would otherwise slip through as a number.
        if (!t.Any(char.IsDigit)) return false;

        return double.TryParse(t, NumberStyles.Number, CultureInfo.InvariantCulture, out value)
            || double.TryParse(t, NumberStyles.Number, CultureInfo.CurrentCulture, out value);
    }

    /// <summary>
    /// A date, ISO first because that is what the REST layer returns
    /// ("2026-02-26T13:59:53.171-0700").
    /// </summary>
    public static bool TryDate(string s, out DateTime value)
    {
        // A bare integer is a number, not a year: DateTime.TryParse would take
        // "2024" as a date and sort an id column by imaginary years.
        if (s.Length < 6) { value = default; return false; }

        return DateTime.TryParse(s, CultureInfo.InvariantCulture,
                                 DateTimeStyles.RoundtripKind | DateTimeStyles.AllowWhiteSpaces, out value)
            || DateTime.TryParse(s, CultureInfo.CurrentCulture, DateTimeStyles.AllowWhiteSpaces, out value);
    }
}
