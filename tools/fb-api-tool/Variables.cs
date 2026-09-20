using System.ComponentModel;
using System.IO;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace FbApiTool;

/// <summary>One named value, substituted wherever {{name}} appears.</summary>
public sealed class Variable : INotifyPropertyChanged
{
    private string _name = "";
    private string _value = "";

    public string Name
    {
        get => _name;
        set { _name = Clean(value); Changed(nameof(Name)); }
    }

    /// <summary>
    /// The name without its braces.
    ///
    /// The braces are how a variable is REFERENCED, not part of what it is
    /// called, but every hint in the window shows the reference form, so
    /// typing "{{soId}}" into the Name column is the obvious mistake to make.
    /// Stored literally it can never match — the lookup is on "soId" — and the
    /// only symptom is a request that quietly refuses to send. Taking them off
    /// costs nothing and makes both spellings mean the same thing.
    /// </summary>
    private static string Clean(string? raw)
    {
        var n = (raw ?? "").Trim();
        while (n.StartsWith("{{", StringComparison.Ordinal) && n.EndsWith("}}", StringComparison.Ordinal))
            n = n[2..^2].Trim();
        return n;
    }

    public string Value
    {
        get => _value;
        set { _value = value; Changed(nameof(Value)); }
    }

    /// <summary>Where it came from — a capture rule, or typed by hand.</summary>
    public string? Note { get; set; }

    private void Changed(string p) => PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(p));
    public event PropertyChangedEventHandler? PropertyChanged;

    public override string ToString() => "{{" + Name + "}} = " + Value;
}

/// <summary>
/// Named values, and the rules that pull them out of a response.
///
/// Fishbowl's own contracts force multi-step work — create a manufacture order,
/// read back its id, issue it; create a sales order, then add a memo to it —
/// and the id in the middle only exists in the response you just got. Without
/// somewhere to put it, every such sequence means copying numbers between tabs
/// by hand, which is where the mistakes come from.
/// </summary>
public static partial class Variables
{
    [GeneratedRegex(@"\{\{\s*([A-Za-z_][A-Za-z0-9_.\-]*)\s*\}\}")]
    private static partial Regex Placeholder();

    private static string File_ => Path.Combine(ApiCatalog.DataDir, "variables.json");

    private static readonly JsonSerializerOptions Json = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
        WriteIndented = true,
    };

    public static List<Variable> Load()
    {
        try
        {
            return System.IO.File.Exists(File_)
                ? JsonSerializer.Deserialize<List<Variable>>(System.IO.File.ReadAllText(File_), Json) ?? []
                : [];
        }
        catch { return []; }
    }

    public static void Save(IEnumerable<Variable> vars)
    {
        try
        {
            Directory.CreateDirectory(ApiCatalog.DataDir);
            System.IO.File.WriteAllText(File_,
                JsonSerializer.Serialize(vars.Where(v => v.Name.Trim().Length > 0), Json));
        }
        catch { /* losing a variable is not worth an exception dialog */ }
    }

    // ── SUBSTITUTION ────────────────────────────────────────────────────

    /// <summary>
    /// Replace every {{name}} with its value.
    ///
    /// An unknown name is left exactly as it is, deliberately. Substituting an
    /// empty string would build a URL that looks valid and quietly asks for the
    /// wrong thing; leaving {{partId}} in place makes the request refuse to
    /// send and say which one is missing.
    /// </summary>
    public static string Expand(string? text, IReadOnlyDictionary<string, string> values)
    {
        if (string.IsNullOrEmpty(text)) return text ?? "";
        return Placeholder().Replace(text, m =>
            values.TryGetValue(m.Groups[1].Value, out var v) ? v : m.Value);
    }

    public static string Expand(string? text, IEnumerable<Variable> vars) =>
        Expand(text, ToMap(vars));

    public static Dictionary<string, string> ToMap(IEnumerable<Variable> vars)
    {
        var map = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var v in vars)
        {
            var name = v.Name.Trim();
            if (name.Length > 0) map[name] = v.Value ?? "";
        }
        return map;
    }

    /// <summary>Every {{name}} mentioned, in order, without duplicates.</summary>
    public static List<string> Referenced(string? text)
    {
        var names = new List<string>();
        if (string.IsNullOrEmpty(text)) return names;
        foreach (Match m in Placeholder().Matches(text))
        {
            var n = m.Groups[1].Value;
            if (!names.Contains(n, StringComparer.OrdinalIgnoreCase)) names.Add(n);
        }
        return names;
    }

    /// <summary>The names used here that have no value — what stops a send.</summary>
    public static List<string> Unresolved(string? text, IReadOnlyDictionary<string, string> values) =>
        [.. Referenced(text).Where(n => !values.ContainsKey(n))];

    // ── CAPTURE ─────────────────────────────────────────────────────────

    /// <summary>
    /// Pull a value out of a response by path: <c>id</c>, <c>customer.name</c>,
    /// <c>results[0].id</c>.
    ///
    /// A path that does not start at an array falls back to looking inside
    /// <c>results</c>, because every Fishbowl search endpoint wraps its rows in
    /// that envelope and writing <c>results[0].</c> in front of every capture
    /// would be noise.
    /// </summary>
    public static string? Capture(string? json, string? path)
    {
        if (string.IsNullOrWhiteSpace(json) || string.IsNullOrWhiteSpace(path)) return null;

        JsonNode? root;
        try { root = JsonNode.Parse(json); } catch { return null; }
        if (root is null) return null;

        var direct = Walk(root, path!);
        if (direct is not null) return direct;

        // The paged envelope, without having to say so.
        if (root is JsonObject o && o["results"] is JsonArray)
            return Walk(root, "results[0]." + path!.TrimStart('.'));

        // A bare array, likewise.
        if (root is JsonArray) return Walk(root, "[0]." + path!.TrimStart('.'));

        return null;
    }

    private static string? Walk(JsonNode? node, string path)
    {
        foreach (var raw in path.Split('.', StringSplitOptions.RemoveEmptyEntries))
        {
            var segment = raw;

            // A leading name, then any number of [n] indices.
            var bracket = segment.IndexOf('[');
            var name = bracket < 0 ? segment : segment[..bracket];

            if (name.Length > 0)
            {
                if (node is not JsonObject obj || !obj.TryGetPropertyValue(name, out node)) return null;
            }

            if (bracket < 0) continue;

            foreach (Match m in Regex.Matches(segment[bracket..], @"\[(\d+)\]"))
            {
                if (node is not JsonArray arr) return null;
                var i = int.Parse(m.Groups[1].Value);
                if (i < 0 || i >= arr.Count) return null;
                node = arr[i];
            }
        }

        return node switch
        {
            null => null,
            JsonValue v => v.ToString(),
            _ => node.ToJsonString(),
        };
    }

    /// <summary>
    /// Paths worth offering for a response — every leaf, shortened through the
    /// <c>results[0]</c> envelope so the list reads the way a capture is
    /// written.
    /// </summary>
    public static List<string> Paths(string? json, int max = 60)
    {
        var found = new List<string>();
        JsonNode? root;
        try { root = JsonNode.Parse(json ?? ""); } catch { return found; }

        var start = root;
        var prefix = "";
        if (root is JsonObject o && o["results"] is JsonArray { Count: > 0 } rs) { start = rs[0]; }
        else if (root is JsonArray { Count: > 0 } a) { start = a[0]; }

        Collect(start, prefix, found, max);
        return found;
    }

    private static void Collect(JsonNode? node, string prefix, List<string> into, int max)
    {
        if (into.Count >= max || node is null) return;

        switch (node)
        {
            case JsonObject obj:
                foreach (var (k, v) in obj)
                {
                    var path = prefix.Length == 0 ? k : prefix + "." + k;
                    if (v is JsonValue) { if (into.Count < max) into.Add(path); }
                    else Collect(v, path, into, max);
                }
                break;

            // One element is enough to show the shape; a 500-row response would
            // otherwise produce 500 near-identical paths.
            case JsonArray { Count: > 0 } arr:
                Collect(arr[0], prefix + "[0]", into, max);
                break;
        }
    }

    /// <summary>A short, readable rendering of a value for the variables list.</summary>
    public static string Preview(string? value, int max = 60)
    {
        var v = (value ?? "").Replace('\n', ' ').Replace('\r', ' ').Trim();
        while (v.Contains("  ", StringComparison.Ordinal)) v = v.Replace("  ", " ");
        return v.Length <= max ? v : v[..max] + "…";
    }

    /// <summary>Used by the request form to show what a field will actually send.</summary>
    public static string Describe(IEnumerable<Variable> vars)
    {
        var sb = new StringBuilder();
        foreach (var v in vars.Where(v => v.Name.Trim().Length > 0))
            sb.Append(sb.Length == 0 ? "" : ", ").Append("{{").Append(v.Name).Append("}}");
        return sb.ToString();
    }
}
