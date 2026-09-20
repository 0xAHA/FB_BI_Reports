using System.IO;
using System.Reflection;

namespace FbApiTool;

/// <summary>
/// The files the tool ships with — the endpoint catalog and the two guides.
///
/// Both are embedded in the executable AND written beside it in <c>assets\</c>.
/// The folder copy is what gets read, so the catalog stays readable, diffable
/// and hand-editable; the embedded copy is the safety net, so a bare
/// FbApiTool.exe someone copied on its own still starts and still shows the
/// documentation instead of failing with a missing-file error.
/// </summary>
public static class Assets
{
    private const string CatalogResource = "FbApiTool.assets.catalog.json";
    private const string GuideResource = "FbApiTool.assets.guide.html";
    private const string ToolGuideResource = "FbApiTool.assets.tool-guide.built.html";

    /// <summary>
    /// The catalog: an applied update first, then the folder copy, then the
    /// copy baked into the exe.
    /// </summary>
    public static ApiCatalog LoadCatalog()
    {
        if (File.Exists(ApiCatalog.UserFile))
        {
            try { return ApiCatalog.Read(ApiCatalog.UserFile); }
            catch { /* a corrupt update must not brick the tool — fall through */ }
        }
        if (File.Exists(ApiCatalog.ShippedFile)) return ApiCatalog.Read(ApiCatalog.ShippedFile);

        var json = Read(CatalogResource)
                   ?? throw new FileNotFoundException("No catalog on disk and none embedded.", ApiCatalog.ShippedFile);
        return System.Text.Json.JsonSerializer.Deserialize<ApiCatalog>(json, ApiCatalog.Json)
               ?? throw new InvalidDataException("The embedded catalog is empty.");
    }

    /// <summary>
    /// This tool's own documentation, screenshots and all.
    ///
    /// The BUILT page, not the authored one: tools/build-help.js lifts the
    /// pictures out of the Word guide and inlines them, so the document that
    /// ships is a single self-contained file. Inlined rather than written
    /// beside it because this page is served from two different places — a
    /// folder next to the exe, or unpacked from inside it — and a relative
    /// image path only resolves in one of them.
    /// </summary>
    public static string ToolGuidePath() => DocPath("tool-guide.built.html", ToolGuideResource);

    /// <summary>The Fishbowl API guide, exactly as shipped.</summary>
    public static string GuidePath() => DocPath("guide.html", GuideResource);

    /// <summary>
    /// A path WebView2 can navigate to. Prefers the copy beside the exe, so an
    /// edited document is picked up; otherwise unpacks the embedded one.
    /// </summary>
    private static string DocPath(string file, string resource)
    {
        var beside = Path.Combine(AppContext.BaseDirectory, "assets", file);
        if (File.Exists(beside)) return beside;

        var html = Read(resource)
                   ?? throw new FileNotFoundException(file + " is neither beside the exe nor embedded.", beside);

        // Rewrite when it differs, not only when it is missing: a copy unpacked
        // by an older build would otherwise outlive the document it came from.
        var unpacked = Path.Combine(ApiCatalog.DataDir, file);
        try
        {
            if (!File.Exists(unpacked) || File.ReadAllText(unpacked) != html)
            {
                Directory.CreateDirectory(ApiCatalog.DataDir);
                File.WriteAllText(unpacked, html);
            }
        }
        catch { /* if it cannot be written, the existing copy still opens */ }

        return unpacked;
    }

    private static string? Read(string resource)
    {
        using var s = Assembly.GetExecutingAssembly().GetManifestResourceStream(resource);
        if (s is null) return null;
        using var r = new StreamReader(s);
        return r.ReadToEnd();
    }
}
