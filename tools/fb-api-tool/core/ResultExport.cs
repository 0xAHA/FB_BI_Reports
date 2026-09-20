using System.Text;

namespace FbApiTool;

/// <summary>
/// Writes a result out in the shape the next tool wants.
///
/// JSON is what came back and is what another API call or a script will take.
/// CSV is what a spreadsheet will take, which is where a query result usually
/// ends up — so a tabular result is offered as both rather than being saved as
/// JSON and converted by hand afterwards.
/// </summary>
public static class ResultExport
{
    /// <summary>
    /// A result as CSV: a header row, then one row per record, every field
    /// quoted.
    ///
    /// Quoting everything rather than only the fields that need it keeps a
    /// value that looks numeric — a part number like 00123, an order number
    /// with a leading zero — from being read as a number and losing its zeros
    /// on the way into a spreadsheet.
    /// </summary>
    public static string ToCsv(IReadOnlyList<string> columns, IReadOnlyList<Dictionary<string, string>> rows)
    {
        var sb = new StringBuilder();
        sb.Append(string.Join(",", columns.Select(Quote))).Append("\r\n");

        foreach (var row in rows)
        {
            sb.Append(string.Join(",", columns.Select(c =>
                Quote(row.TryGetValue(c, out var v) ? v ?? "" : ""))));
            sb.Append("\r\n");
        }
        return sb.ToString();
    }

    /// <summary>
    /// One CSV field. Doubles any embedded quote, and keeps newlines inside the
    /// quotes rather than escaping them — that is what RFC 4180 says and what
    /// every spreadsheet reads back correctly.
    /// </summary>
    private static string Quote(string value) =>
        "\"" + (value ?? "").Replace("\"", "\"\"") + "\"";

    /// <summary>A filename that will not be rejected, built from the endpoint's name.</summary>
    public static string SuggestName(string endpointName, string extension)
    {
        var clean = new string((endpointName ?? "result")
            .Select(c => char.IsLetterOrDigit(c) || c is '-' or '_' or ' ' ? c : '-').ToArray())
            .Trim();
        if (clean.Length == 0) clean = "result";
        return clean + " " + DateTime.Now.ToString("yyyy-MM-dd HHmm") + "." + extension;
    }
}
