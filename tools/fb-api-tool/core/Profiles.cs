using System.IO;
using System.Text.Json;

namespace FbApiTool;

/// <summary>A named server this tool connects to.</summary>
public sealed class ServerProfile
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N")[..8];
    public string Name { get; set; } = "";
    public string BaseUrl { get; set; } = "http://localhost:2456";
    public string? Username { get; set; }
    public string AppName { get; set; } = "Fishbowl Advanced API Tool";
    public int AppId { get; set; } = 101;

    /// <summary>
    /// Marks a server whose data is real. Everything this flag does is a
    /// warning — see <see cref="Profiles"/>.
    /// </summary>
    public bool IsProduction { get; set; }

    public override string ToString() =>
        (IsProduction ? "⚠ " : "") + (Name.Length > 0 ? Name : BaseUrl);
}

/// <summary>
/// The servers this tool knows about.
///
/// The convenience half — switch between dev, staging and a customer's box
/// without retyping a URL — matters less than the safety half. This tool sends
/// real POSTs and DELETEs at real databases, and until now the only thing
/// telling production apart from a sandbox was a URL in an 11px status bar. A
/// profile marked production turns the header red and asks before every write.
/// </summary>
public static class Profiles
{
    private static string File_ => Path.Combine(ApiCatalog.DataDir, "profiles.json");

    private static readonly JsonSerializerOptions Json = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
        WriteIndented = true,
    };

    public static List<ServerProfile> Load()
    {
        try
        {
            if (!System.IO.File.Exists(File_)) return [];
            return JsonSerializer.Deserialize<List<ServerProfile>>(System.IO.File.ReadAllText(File_), Json) ?? [];
        }
        catch { return []; }
    }

    public static void Save(IEnumerable<ServerProfile> profiles)
    {
        try
        {
            Directory.CreateDirectory(ApiCatalog.DataDir);
            System.IO.File.WriteAllText(File_, JsonSerializer.Serialize(profiles, Json));
        }
        catch { }
    }

    /// <summary>
    /// Does this address look like production?
    ///
    /// Only ever used to SUGGEST the flag when a profile is created — never to
    /// decide on its own. A hostname is not evidence: plenty of production
    /// servers are an IP address, and plenty of sandboxes are called
    /// fishbowl-prod-copy. The user ticks the box; this just makes the common
    /// case one less thing to think about.
    /// </summary>
    public static bool LooksLikeProduction(string baseUrl)
    {
        var u = (baseUrl ?? "").ToLowerInvariant();
        if (u.Contains("localhost") || u.Contains("127.0.0.1") || u.Contains("::1")) return false;
        if (u.Contains("dev") || u.Contains("test") || u.Contains("stag") ||
            u.Contains("sandbox") || u.Contains("demo") || u.Contains("uat")) return false;
        return true;
    }

    /// <summary>Verbs that change something and so deserve a second look on production.</summary>
    public static bool IsWrite(string method) =>
        method.ToUpperInvariant() is "POST" or "PUT" or "PATCH" or "DELETE";
}
