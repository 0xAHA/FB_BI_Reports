using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace FbApiTool;

/// <summary>
/// The two shapes <c>/api/import/{name}</c> accepts, and the conversions
/// between them.
///
/// Both carry the SAME thing — a header row followed by data rows — so the
/// format toggle can convert what is already typed instead of discarding it.
/// The JSON form is a 2-D array, NOT an array of objects: the first inner array
/// is the header row. Sending objects is the usual first mistake.
/// </summary>
public static class ImportPayload
{
    public const string CsvContentType = "text/plain";
    public const string JsonContentType = "application/json";

    /// <summary>Split one CSV line, honouring quotes and the doubled-quote escape.</summary>
    public static List<string> ParseRow(string line)
    {
        var outp = new List<string>();
        var cur = new StringBuilder();
        var inQuotes = false;

        for (var i = 0; i < line.Length; i++)
        {
            var c = line[i];
            if (c == '"')
            {
                if (inQuotes && i + 1 < line.Length && line[i + 1] == '"') { cur.Append('"'); i++; }
                else inQuotes = !inQuotes;
            }
            else if (c == ',' && !inQuotes) { outp.Add(cur.ToString()); cur.Clear(); }
            else cur.Append(c);
        }
        outp.Add(cur.ToString());
        return outp;
    }

    public static string Quote(string v) => "\"" + (v ?? "").Replace("\"", "\"\"") + "\"";

    public static string CsvToJson(string csv)
    {
        var rows = csv.Replace("\r\n", "\n").Split('\n')
                      .Where(l => l.Trim().Length > 0)
                      .Select(ParseRow)
                      .ToList();
        var arr = new JsonArray();
        foreach (var r in rows)
        {
            var inner = new JsonArray();
            foreach (var cell in r) inner.Add(cell);
            arr.Add(inner);
        }
        return arr.ToJsonString(new JsonSerializerOptions { WriteIndented = true });
    }

    public static string JsonToCsv(string json)
    {
        var node = JsonNode.Parse(json);
        if (node is not JsonArray arr || arr.Count == 0) return "";

        // The documented shape: an array of row arrays.
        if (arr[0] is JsonArray)
        {
            return string.Join("\n", arr.OfType<JsonArray>()
                .Select(row => string.Join(",", row.Select(c => Quote(c?.ToString() ?? "")))));
        }

        // An array of objects is not what the endpoint takes, but people paste
        // it often enough that converting is friendlier than refusing.
        var objs = arr.OfType<JsonObject>().ToList();
        if (objs.Count == 0) return "";
        var headers = objs[0].Select(kv => kv.Key).ToList();
        var lines = new List<string> { string.Join(",", headers.Select(Quote)) };
        lines.AddRange(objs.Select(o =>
            string.Join(",", headers.Select(h => Quote(o[h]?.ToString() ?? "")))));
        return string.Join("\n", lines);
    }

    /// <summary>A header row plus one blank data row, ready to fill in.</summary>
    public static string Template(IReadOnlyList<string> headers, bool json)
    {
        if (!json) return string.Join(",", headers.Select(Quote)) + "\n";
        var arr = new JsonArray();
        var head = new JsonArray();
        foreach (var h in headers) head.Add(h);
        var blank = new JsonArray();
        foreach (var _ in headers) blank.Add("");
        arr.Add(head);
        arr.Add(blank);
        return arr.ToJsonString(new JsonSerializerOptions { WriteIndented = true });
    }

    /// <summary>The header names out of an export endpoint's CSV response.</summary>
    public static List<string> HeadersFrom(string csv)
    {
        var first = csv.Replace("\r\n", "\n").Split('\n').FirstOrDefault(l => l.Trim().Length > 0);
        return first is null ? [] : ParseRow(first.Trim());
    }

    /// <summary>Does this text look like JSON rather than CSV?</summary>
    public static bool LooksJson(string content)
    {
        var t = content.TrimStart();
        return t.Length > 0 && (t[0] == '[' || t[0] == '{');
    }
}
