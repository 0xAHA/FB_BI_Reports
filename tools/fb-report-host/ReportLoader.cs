using System.IO;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace FbReportHost;

/// <summary>Where a report's HTML came from, and what had to be expanded to run it.</summary>
public sealed record LoadedReport(
    string Name,
    string SourcePath,
    string Html,
    IReadOnlyList<string> Expanded,
    IReadOnlyList<string> Missing,
    string? AssetSource);

/// <summary>
/// Turns a dropped .htm (source) or Deployed/*.json (the client's export
/// envelope) into runnable HTML, expanding the shared-asset directives the
/// Fishbowl server would expand at save time.
/// </summary>
public static partial class ReportLoader
{
    // {% Script fb-lib %} / {% Style fb-styles %}
    [GeneratedRegex(@"\{%\s*(Script|Style)\s+([^\s%]+)\s*%\}", RegexOptions.IgnoreCase)]
    private static partial Regex DirectiveRx();

    /// <summary>
    /// Folders that may hold fb-lib.js / fb-styles.css, in priority order:
    ///
    ///   1. the scripts/ folder of a repo above the report — so a report opened
    ///      in place picks up the working-tree copy you are editing;
    ///   2. the library's _shared folder — the only option for a report that has
    ///      been COPIED into the library, which has no repo above it.
    ///
    /// Getting this wrong is what makes a report show its own "fb-lib not
    /// loaded" guard: the directive is left unexpanded and window.FBLib never
    /// exists.
    /// </summary>
    public static List<string> AssetDirs(string reportPath)
    {
        var dirs = new List<string>();
        var repo = FindRepoRoot(reportPath);
        if (repo is not null) dirs.Add(Path.Combine(repo, "scripts"));
        if (Directory.Exists(Library.SharedDir)) dirs.Add(Library.SharedDir);
        return dirs;
    }

    public static LoadedReport Load(string path) => Load(path, AssetDirs(path));

    public static LoadedReport Load(string path, IReadOnlyList<string> assetDirs)
    {
        var ext = Path.GetExtension(path).ToLowerInvariant();
        string html, name;

        if (ext == ".json")
        {
            // Deployed envelope: [ { "name": …, "description": …, "data": <html> } ]
            var node = JsonNode.Parse(File.ReadAllText(path));
            var obj = (node as JsonArray)?.FirstOrDefault()?.AsObject() ?? node?.AsObject()
                      ?? throw new InvalidDataException("Not a Fishbowl export: expected an object or a one-element array.");
            html = obj["data"]?.GetValue<string>()
                   ?? throw new InvalidDataException("Export has no \"data\" field — is this a Page export?");
            name = obj["name"]?.GetValue<string>() ?? Path.GetFileNameWithoutExtension(path);
        }
        else
        {
            html = File.ReadAllText(path);
            name = Path.GetFileNameWithoutExtension(path);
        }

        var (expandedHtml, expanded, missing, source) = ExpandDirectives(html, assetDirs);
        return new LoadedReport(name, path, expandedHtml, expanded, missing, source);
    }

    /// <summary>
    /// Replaces every directive occurrence, exactly as the server does.
    ///
    /// The global replace is faithful on purpose: Fishbowl substitutes the
    /// placeholder EVERYWHERE in the file, including inside comments and string
    /// literals, which is why a report may only mention it once. Expanding just
    /// the first occurrence here would hide that failure until deployment.
    /// </summary>
    public static (string Html, List<string> Expanded, List<string> Missing, string? Source)
        ExpandDirectives(string html, IReadOnlyList<string> assetDirs)
    {
        var expanded = new List<string>();
        var missing = new List<string>();
        string? usedFrom = null;

        var result = DirectiveRx().Replace(html, m =>
        {
            var kind = m.Groups[1].Value;
            var asset = m.Groups[2].Value;
            var ext = kind.Equals("Style", StringComparison.OrdinalIgnoreCase) ? ".css" : ".js";
            var fileName = asset + ext;

            foreach (var dir in assetDirs)
            {
                var file = Path.Combine(dir, fileName);
                if (!File.Exists(file)) continue;
                var label = kind + " " + asset;
                if (!expanded.Contains(label)) expanded.Add(label);
                usedFrom ??= dir;
                return File.ReadAllText(file);
            }

            var miss = kind + " " + asset + " (" + fileName + ")";
            if (!missing.Contains(miss)) missing.Add(miss);
            return m.Value;                 // leave it visible rather than blanking it
        });
        return (result, expanded, missing, usedFrom);
    }

    /// <summary>What the tree's detail pane shows for the selected item.</summary>
    public sealed record ReportInfo(string Name, string? Description, string Kind, long Bytes);

    /// <summary>
    /// Read a report's identity WITHOUT loading it.
    ///
    /// Uses a streaming reader rather than JsonNode.Parse because a Deployed
    /// export is mostly one enormous "data" string — 628 KB for Auto PO — and
    /// this runs on every click in the tree. The reader stops as soon as both
    /// fields are in hand and never materialises the HTML.
    /// </summary>
    public static ReportInfo Peek(string path)
    {
        var fi = new FileInfo(path);
        var ext = Path.GetExtension(path).ToLowerInvariant();
        if (ext != ".json")
        {
            return new ReportInfo(Path.GetFileNameWithoutExtension(path), TitleOf(path),
                                  "Source report (" + ext.TrimStart('.') + ")", fi.Exists ? fi.Length : 0);
        }
        var (name, desc) = PeekEnvelope(path);
        return new ReportInfo(name ?? Path.GetFileNameWithoutExtension(path), desc,
                              "Deployed export (.json)", fi.Exists ? fi.Length : 0);
    }

    // "name" : "…"  /  "description" : "…"  — Jackson's pretty printer puts a
    // space either side of the colon, but tolerate any spacing.
    [GeneratedRegex(@"""name""\s*:\s*(""(?:[^""\\]|\\.)*"")", RegexOptions.IgnoreCase)]
    private static partial Regex NameRx();

    [GeneratedRegex(@"""description""\s*:\s*(""(?:[^""\\]|\\.)*"")", RegexOptions.IgnoreCase)]
    private static partial Regex DescRx();

    /// <summary>
    /// The envelope's name and description, read from the HEAD of the file.
    ///
    /// Both sit before the enormous "data" member in every export Fishbowl
    /// writes, so 64 KB is ample and this never materialises the HTML — which
    /// matters because the tree calls it once per JSON report, and Auto PO's
    /// export alone is 628 KB. A file whose head does not carry them falls back
    /// to a full parse rather than silently showing the filename.
    /// </summary>
    private static (string? Name, string? Description) PeekEnvelope(string path)
    {
        try
        {
            string head;
            using (var sr = new StreamReader(path))
            {
                var buf = new char[64 * 1024];
                var n = sr.Read(buf, 0, buf.Length);
                head = new string(buf, 0, n);
            }
            var name = Unescape(NameRx().Match(head));
            var desc = Unescape(DescRx().Match(head));
            if (name is not null) return (name, desc);

            // Head did not contain it — pay for the full parse just this once.
            using var fs = File.OpenRead(path);
            using var doc = JsonDocument.Parse(fs, new JsonDocumentOptions { AllowTrailingCommas = true });
            var el = doc.RootElement;
            if (el.ValueKind == JsonValueKind.Array && el.GetArrayLength() > 0) el = el[0];
            if (el.ValueKind != JsonValueKind.Object) return (null, null);
            return (el.TryGetProperty("name", out var jn) ? jn.GetString() : null,
                    el.TryGetProperty("description", out var jd) ? jd.GetString() : null);
        }
        catch { return (null, null); }      // a malformed export still gets a row
    }

    /// <summary>Turn a captured JSON string token back into its real text.</summary>
    private static string? Unescape(Match m)
    {
        if (!m.Success) return null;
        try { return JsonSerializer.Deserialize<string>(m.Groups[1].Value); }
        catch { return null; }
    }

    /// <summary>
    /// What the tree labels a report. A Deployed export is known by the name
    /// Fishbowl gave it ("- Auto PO"), not by the file it was written to
    /// ("- Auto PO-Page.json") — the filename is an artefact of the exporter.
    /// Cached against the file's write time so an edited export re-reads.
    /// </summary>
    private static readonly Dictionary<string, (DateTime Stamp, string Label)> _labels = new(StringComparer.OrdinalIgnoreCase);

    public static string LabelFor(string path)
    {
        var bare = Path.GetFileNameWithoutExtension(path);
        if (!Path.GetExtension(path).Equals(".json", StringComparison.OrdinalIgnoreCase)) return bare;
        try
        {
            var stamp = File.GetLastWriteTimeUtc(path);
            if (_labels.TryGetValue(path, out var hit) && hit.Stamp == stamp) return hit.Label;
            var label = PeekEnvelope(path).Name is { Length: > 0 } n ? n : bare;
            _labels[path] = (stamp, label);
            return label;
        }
        catch { return bare; }
    }

    /// <summary>The &lt;title&gt; of a source report, as a stand-in for a description.</summary>
    private static string? TitleOf(string path)
    {
        try
        {
            // Only the head is needed, and these files run to 340 KB.
            using var sr = new StreamReader(path);
            var buf = new char[8192];
            var n = sr.Read(buf, 0, buf.Length);
            var head = new string(buf, 0, n);
            var m = Regex.Match(head, @"<title>(.*?)</title>", RegexOptions.IgnoreCase | RegexOptions.Singleline);
            return m.Success ? m.Groups[1].Value.Trim() : null;
        }
        catch { return null; }
    }

    /// <summary>Walk up from the report until a folder containing scripts/fb-lib.js appears.</summary>
    public static string? FindRepoRoot(string fromPath)
    {
        var dir = Directory.Exists(fromPath) ? new DirectoryInfo(fromPath) : new FileInfo(fromPath).Directory;
        while (dir is not null)
        {
            if (File.Exists(Path.Combine(dir.FullName, "scripts", "fb-lib.js"))) return dir.FullName;
            dir = dir.Parent;
        }
        return null;
    }
}
