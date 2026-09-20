using System.ComponentModel;

namespace FbApiTool;

public enum ChangeKind
{
    /// <summary>On the server, not in the catalog — scaffold it.</summary>
    Added,
    /// <summary>In both, but the documented shape moved.</summary>
    Changed,
    /// <summary>In the catalog, not in this server's documentation.</summary>
    MissingFromServer,
}

/// <summary>One proposed edit, individually approvable.</summary>
/// <remarks>
/// Partial so the WPF half — the badge colour — lives with the other view
/// concerns. This half stays free of any UI reference, which is what lets the
/// self-test compile the real diff engine rather than a copy of it.
/// </remarks>
public sealed partial class CatalogChange : INotifyPropertyChanged
{
    public ChangeKind Kind { get; init; }
    public string Key { get; init; } = "";
    public string Category { get; init; } = "";
    public string Name { get; init; } = "";
    public string Method { get; init; } = "";
    public string Path { get; init; } = "";

    /// <summary>What would change, in words — one line per difference.</summary>
    public List<string> Details { get; init; } = [];

    public ApiEndpoint? Incoming { get; init; }
    public ApiEndpoint? Current { get; init; }

    private bool _apply;
    /// <summary>
    /// Whether to carry this one out. Additions and shape changes default on;
    /// a removal never does — see <see cref="CatalogDiff.Compare"/>.
    /// </summary>
    public bool Apply
    {
        get => _apply;
        set { _apply = value; PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(Apply))); }
    }

    public string KindLabel => Kind switch
    {
        ChangeKind.Added => "NEW",
        ChangeKind.Changed => "CHANGED",
        _ => "NOT ON SERVER",
    };

    public string DetailText => Details.Count == 0 ? "" : string.Join("\n", Details);
    public string Header => Method + "  " + Path;

    public event PropertyChangedEventHandler? PropertyChanged;
}

public sealed class CatalogDiffResult
{
    public string CurrentVersion { get; init; } = "";
    public string IncomingVersion { get; init; } = "";
    public List<CatalogChange> Changes { get; init; } = [];

    public bool VersionDiffers =>
        !string.Equals(CurrentVersion.Trim(), IncomingVersion.Trim(), StringComparison.OrdinalIgnoreCase);

    public int AddedCount => Changes.Count(c => c.Kind == ChangeKind.Added);
    public int ChangedCount => Changes.Count(c => c.Kind == ChangeKind.Changed);
    public int MissingCount => Changes.Count(c => c.Kind == ChangeKind.MissingFromServer);

    /// <summary>True when there is something worth prompting about.</summary>
    public bool HasWork => AddedCount > 0 || ChangedCount > 0;

    public string Summary =>
        AddedCount + " new, " + ChangedCount + " changed, " + MissingCount + " not on this server";
}

/// <summary>
/// Works out what a server's documentation would change in the catalog, and
/// applies whatever the user approves.
///
/// The bias throughout is non-destructive. The shipped catalog is curated —
/// it carries notes that are not in the published documentation (which call
/// consumes a number, which access right is really needed, which field is a
/// trap) and it expands templated endpoints the server publishes only once.
/// So a change is a PROPOSAL, never an automatic overwrite, and anything the
/// server does not mention is reported rather than deleted: an endpoint absent
/// from one server's docs is usually a curated extra or an older server, not a
/// retired endpoint.
/// </summary>
public static class CatalogDiff
{
    public static CatalogDiffResult Compare(ApiCatalog current, ApiCatalog incoming)
    {
        var mine = current.Endpoints.ToDictionary(e => e.Key, StringComparer.OrdinalIgnoreCase);
        var theirs = new Dictionary<string, ApiEndpoint>(StringComparer.OrdinalIgnoreCase);
        foreach (var e in incoming.Endpoints) theirs[e.Key] = e;      // last wins on a duplicate

        var changes = new List<CatalogChange>();

        foreach (var (key, inc) in theirs)
        {
            if (!mine.TryGetValue(key, out var cur))
            {
                changes.Add(new CatalogChange
                {
                    Kind = ChangeKind.Added,
                    Key = key,
                    Category = inc.Category,
                    Name = inc.Name,
                    Method = inc.Method,
                    Path = inc.Path,
                    Incoming = inc,
                    Apply = true,
                    Details = Describe(inc),
                });
                continue;
            }

            var details = Differences(cur, inc);
            if (details.Count == 0) continue;

            changes.Add(new CatalogChange
            {
                Kind = ChangeKind.Changed,
                Key = key,
                Category = cur.Category,
                Name = cur.Name,
                Method = cur.Method,
                Path = cur.Path,
                Incoming = inc,
                Current = cur,
                Apply = true,
                Details = details,
            });
        }

        foreach (var (key, cur) in mine)
        {
            if (theirs.ContainsKey(key)) continue;
            changes.Add(new CatalogChange
            {
                Kind = ChangeKind.MissingFromServer,
                Key = key,
                Category = cur.Category,
                Name = cur.Name,
                Method = cur.Method,
                Path = cur.Path,
                Current = cur,
                Apply = false,          // never remove unless asked, explicitly
                Details = ["This server's documentation does not list it. It may be a curated addition, " +
                           "or this server may be older than the one the catalog was built from. " +
                           "Tick only if you want it removed."],
            });
        }

        return new CatalogDiffResult
        {
            CurrentVersion = current.Version,
            IncomingVersion = incoming.Version,
            Changes = [.. changes.OrderBy(c => c.Kind).ThenBy(c => c.Category, StringComparer.OrdinalIgnoreCase)
                                 .ThenBy(c => c.Path, StringComparer.OrdinalIgnoreCase)],
        };
    }

    private static List<string> Describe(ApiEndpoint e)
    {
        var d = new List<string> { e.Category + " · " + e.Name };
        if (e.PathParams.Count > 0) d.Add("path parameters: " + string.Join(", ", e.PathParams));
        if (e.QueryParams.Count > 0) d.Add(e.QueryParams.Count + " query parameter(s): " +
                                           string.Join(", ", e.QueryParams.Take(8).Select(q => q.Name)) +
                                           (e.QueryParams.Count > 8 ? ", …" : ""));
        if (e.Attributes.Count > 0) d.Add(e.Attributes.Count + " documented body field(s)");
        if (e.BodySample is not null) d.Add("a request body template was generated");
        return d;
    }

    /// <summary>
    /// What moved between the catalog's copy and the server's.
    ///
    /// Deliberately about SHAPE — parameters, fields, body — and never about
    /// prose. Measured against a same-version server, wording alone accounted
    /// for 44 of 44 reported changes, every one of them a paraphrase: the
    /// catalog's descriptions are tightened rewrites carrying facts the
    /// published text does not (that next-number 404s on servers older than
    /// 26.7, say), and 26.9 even publishes a mojibake em dash. Adopting that
    /// automatically would be a downgrade, and burying two real field changes
    /// under 44 rewordings would make the whole prompt not worth reading.
    ///
    /// The server's own wording is never more than a click away — the
    /// Documentation tab, and the live /apidocs page.
    /// </summary>
    private static List<string> Differences(ApiEndpoint cur, ApiEndpoint inc)
    {
        var d = new List<string>();

        Diff("query parameter", cur.QueryParams.Select(q => q.Name), inc.QueryParams.Select(q => q.Name), d);
        Diff("body field", cur.Attributes.Select(x => x.Name), inc.Attributes.Select(x => x.Name), d);

        var retyped = (from x in cur.Attributes
                       join y in inc.Attributes on x.Name equals y.Name
                       where !string.Equals(x.Type, y.Type, StringComparison.OrdinalIgnoreCase)
                       select x.Name + ": " + x.Type + " → " + y.Type).ToList();
        if (retyped.Count > 0)
            d.Add("field type change: " + string.Join(", ", retyped.Take(5)) + (retyped.Count > 5 ? ", …" : ""));

        if (cur.BodySample is null && inc.BodySample is not null) d.Add("a request body template is now available");

        // Worth knowing, never worth acting on by itself.
        if (d.Count > 0)
        {
            var a = (cur.Description ?? "").Trim();
            var b = (inc.Description ?? "").Trim();
            if (b.Length > 0 && a.Length > 0 && a != b && !a.StartsWith(b, StringComparison.Ordinal))
                d.Add("(the server words this differently — the catalog's description is kept)");
        }

        return d;
    }

    private static void Diff(string noun, IEnumerable<string> cur, IEnumerable<string> inc, List<string> into)
    {
        var a = cur.ToHashSet(StringComparer.OrdinalIgnoreCase);
        var b = inc.ToHashSet(StringComparer.OrdinalIgnoreCase);
        var added = b.Except(a).OrderBy(x => x).ToList();
        var gone = a.Except(b).OrderBy(x => x).ToList();
        if (added.Count > 0) into.Add("new " + noun + "(s): " + Join(added));
        if (gone.Count > 0) into.Add(noun + "(s) no longer documented: " + Join(gone));
    }

    private static string Join(List<string> xs) =>
        string.Join(", ", xs.Take(8)) + (xs.Count > 8 ? ", … (" + xs.Count + " total)" : "");

    /// <summary>
    /// Build the updated catalog from the approved changes.
    ///
    /// For an endpoint that exists in both, only the machine-derived parts are
    /// replaced — query parameters, body fields, body template. Its id, its
    /// category and the sidebar name stay as they are, so an approved update
    /// never reshuffles the sidebar or renames something the user knows.
    /// </summary>
    public static ApiCatalog Apply(ApiCatalog current, CatalogDiffResult diff)
    {
        var next = new ApiCatalog
        {
            Version = diff.IncomingVersion,
            Source = "apidocs.json (merged into the shipped catalog)",
            Generated = DateTime.Now.ToString("yyyy-MM-dd"),
            CategoryIcons = new Dictionary<string, string>(current.CategoryIcons),
            // Carried forward, never re-derived: the import names and their
            // header aliases are not in /apidocs.json at all — they came out of
            // the server's bean registry — so an update must not drop them.
            ImportNames = current.ImportNames.Select(n => new ImportName { Name = n.Name, Direction = n.Direction }).ToList(),
            ImportHeaderAliases = new Dictionary<string, string>(current.ImportHeaderAliases),
            Endpoints = current.Endpoints.Select(Clone).ToList(),
        };

        var byKey = next.Endpoints.ToDictionary(e => e.Key, StringComparer.OrdinalIgnoreCase);

        foreach (var c in diff.Changes.Where(c => c.Apply))
        {
            switch (c.Kind)
            {
                case ChangeKind.Added when c.Incoming is not null:
                    next.Endpoints.Add(Clone(c.Incoming));
                    break;

                case ChangeKind.Changed when c.Incoming is not null && byKey.TryGetValue(c.Key, out var cur):
                    cur.QueryParams = c.Incoming.QueryParams.Select(q => new ApiParam { Name = q.Name, Description = q.Description }).ToList();
                    cur.Attributes = c.Incoming.Attributes.Select(Clone).ToList();
                    cur.PathParams = [.. c.Incoming.PathParams];
                    if (c.Incoming.BodySample is not null) cur.BodySample = c.Incoming.BodySample;
                    // An empty description is a gap worth filling; a written one
                    // is curation and is never overwritten. See Differences().
                    if (string.IsNullOrWhiteSpace(cur.Description)) cur.Description = c.Incoming.Description;
                    break;

                case ChangeKind.MissingFromServer:
                    next.Endpoints.RemoveAll(e => string.Equals(e.Key, c.Key, StringComparison.OrdinalIgnoreCase));
                    break;
            }
        }

        // A scaffolded category still needs a sidebar icon.
        foreach (var cat in next.Endpoints.Select(e => e.Category).Distinct())
            if (!next.CategoryIcons.ContainsKey(cat))
                next.CategoryIcons[cat] = "\U0001F517";

        next.Endpoints = [.. next.Endpoints.OrderBy(e => e.Category, StringComparer.OrdinalIgnoreCase)
                                           .ThenBy(e => e.Path, StringComparer.OrdinalIgnoreCase)];
        return next;
    }

    private static ApiEndpoint Clone(ApiEndpoint e) => new()
    {
        Id = e.Id, Category = e.Category, Method = e.Method, Path = e.Path, Name = e.Name,
        Description = e.Description, RequiresAuth = e.RequiresAuth, IsImport = e.IsImport,
        PathParams = [.. e.PathParams],
        QueryParams = e.QueryParams.Select(q => new ApiParam { Name = q.Name, Description = q.Description }).ToList(),
        BodySample = e.BodySample,
        Attributes = e.Attributes.Select(Clone).ToList(),
    };

    private static ApiAttr Clone(ApiAttr a) => new()
    {
        Name = a.Name, Type = a.Type, Optional = a.Optional, Description = a.Description,
    };
}
