using System.IO;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace FbApiTool;

/// <summary>One documented request the tool can build a form for.</summary>
public sealed class ApiEndpoint
{
    public string Id { get; set; } = "";
    public string Category { get; set; } = "";
    public string Method { get; set; } = "GET";
    public string Path { get; set; } = "";
    public string Name { get; set; } = "";
    public string Description { get; set; } = "";

    /// <summary>False only for /api/login, which is how you GET a token.</summary>
    public bool RequiresAuth { get; set; } = true;

    /// <summary>The Import endpoint drives a different pane — a file, not a JSON body.</summary>
    public bool IsImport { get; set; }

    public List<string> PathParams { get; set; } = [];
    public List<ApiParam> QueryParams { get; set; } = [];

    /// <summary>A ready-to-edit request body, or null for endpoints that take none.</summary>
    public string? BodySample { get; set; }

    /// <summary>The documented body fields, flattened to dotted/[] paths.</summary>
    public List<ApiAttr> Attributes { get; set; } = [];

    /// <summary>Identity for diffing: two catalogs agree on an endpoint when these match.</summary>
    [JsonIgnore]
    public string Key => Method.ToUpperInvariant() + " " + Normalise(Path);

    [JsonIgnore]
    public string Label => Method + "  " + Path;

    /// <summary>
    /// Path shapes differ between sources — the server writes ":id" and the
    /// curated catalog writes "{id}" — so both collapse to one spelling before
    /// anything is compared, or every endpoint reads as added AND removed.
    /// </summary>
    public static string Normalise(string path)
    {
        var p = (path ?? "").Trim();
        if (!p.StartsWith('/')) p = "/" + p;
        p = System.Text.RegularExpressions.Regex.Replace(p, @":([A-Za-z0-9_]+)", "{$1}");
        return p.Length > 1 ? p.TrimEnd('/') : p;
    }
}

/// <summary>One import/export name, and which directions the server supports for it.</summary>
public sealed class ImportName
{
    public string Name { get; set; } = "";
    /// <summary>"import only", "export only" or "import + export".</summary>
    public string Direction { get; set; } = "";

    public bool CanImport => Direction.Contains("import", StringComparison.OrdinalIgnoreCase);
    public bool CanExport => Direction.Contains("export", StringComparison.OrdinalIgnoreCase);

    public override string ToString() => Name;
}

public sealed class ApiParam
{
    public string Name { get; set; } = "";
    public string Description { get; set; } = "";
}

public sealed class ApiAttr
{
    public string Name { get; set; } = "";
    public string Type { get; set; } = "";
    public bool Optional { get; set; }
    public string Description { get; set; } = "";
}

/// <summary>
/// The endpoint catalog that drives the whole UI.
///
/// The app ships one built from the documentation it was written against, and
/// keeps any updated copy in %LOCALAPPDATA%. Nothing about an endpoint is
/// compiled in: the sidebar, the forms, the schema table and the body template
/// are all rendered from these records, which is what lets a newer server's
/// /apidocs.json add an endpoint without a rebuild.
/// </summary>
public sealed class ApiCatalog
{
    public string Version { get; set; } = "";
    public string? Source { get; set; }
    public string? Generated { get; set; }
    public Dictionary<string, string> CategoryIcons { get; set; } = [];

    /// <summary>
    /// The import/export names the server accepts, with which directions each
    /// supports. Catalog data rather than a compiled list because the set is
    /// server-side and was recovered empirically from the bean registry — a
    /// name that is not on this list is rejected outright, so guessing is worse
    /// than useless.
    /// </summary>
    public List<ImportName> ImportNames { get; set; } = [];

    /// <summary>
    /// Import types whose header template comes from a differently-named
    /// export. Without the alias the pre-fill silently 404s.
    /// </summary>
    public Dictionary<string, string> ImportHeaderAliases { get; set; } = [];

    public List<ApiEndpoint> Endpoints { get; set; } = [];

    /// <summary>The export name to ask for headers with, for a given import name.</summary>
    public string HeaderNameFor(string importName) =>
        ImportHeaderAliases.TryGetValue(importName, out var alias) ? alias : importName;

    public static readonly JsonSerializerOptions Json = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
        WriteIndented = true,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    };

    public static string DataDir { get; } = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "FbApiTool");

    /// <summary>Where an updated catalog is kept. Absent until the first update is applied.</summary>
    public static string UserFile => Path.Combine(DataDir, "catalog.json");

    /// <summary>The copy that shipped with this build — the fallback, and the "reset" target.</summary>
    public static string ShippedFile => Path.Combine(AppContext.BaseDirectory, "assets", "catalog.json");

    public bool IsUserCopy { get; private set; }

    /// <summary>The updated catalog if one has been applied, otherwise the shipped one.</summary>
    public static ApiCatalog Load()
    {
        if (File.Exists(UserFile))
        {
            try
            {
                var c = Read(UserFile);
                c.IsUserCopy = true;
                return c;
            }
            catch { /* a corrupt update must not brick the tool — fall back */ }
        }
        return LoadShipped();
    }

    public static ApiCatalog LoadShipped() => Read(ShippedFile);

    public static ApiCatalog Read(string path) =>
        JsonSerializer.Deserialize<ApiCatalog>(File.ReadAllText(path), Json)
        ?? throw new InvalidDataException("Catalog is empty: " + path);

    public void Save()
    {
        Directory.CreateDirectory(DataDir);
        File.WriteAllText(UserFile, JsonSerializer.Serialize(this, Json));
        IsUserCopy = true;
    }

    /// <summary>Throw the updated catalog away and go back to what shipped.</summary>
    public static void ResetToShipped()
    {
        if (File.Exists(UserFile)) File.Delete(UserFile);
    }

    public string IconFor(string category) =>
        CategoryIcons.TryGetValue(category, out var i) ? i : "\U0001F4C1";

    public IEnumerable<string> Categories =>
        Endpoints.Select(e => e.Category).Distinct().OrderBy(c => c, StringComparer.OrdinalIgnoreCase);

    public ApiEndpoint? ById(string id) => Endpoints.FirstOrDefault(e => e.Id == id);
}
