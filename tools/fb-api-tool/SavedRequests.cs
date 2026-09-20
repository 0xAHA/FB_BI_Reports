using System.IO;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace FbApiTool;

/// <summary>A filled-in request, kept by name.</summary>
public sealed class SavedRequest
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N")[..8];
    public string Name { get; set; } = "";
    public string EndpointId { get; set; } = "";
    public string Method { get; set; } = "";
    public string Path { get; set; } = "";
    public DateTime SavedAt { get; set; } = DateTime.Now;

    public Dictionary<string, string> PathValues { get; set; } = [];
    public List<NameValue> Query { get; set; } = [];
    public List<NameValue> Headers { get; set; } = [];
    public string? Body { get; set; }
    public string? ContentType { get; set; }

    /// <summary>Where to put values from the response, so the next call can use them.</summary>
    public List<CaptureRule> Captures { get; set; } = [];

    [JsonIgnore]
    public string When => SavedAt.ToString("d MMM HH:mm");

    [JsonIgnore]
    public string Summary => Method + "  " + Path;

    public override string ToString() => Name.Length > 0 ? Name : Summary;
}

public sealed class NameValue
{
    public string Name { get; set; } = "";
    public string Value { get; set; } = "";
}

/// <summary>Take <see cref="Path"/> out of the response and put it in <see cref="Variable"/>.</summary>
public sealed class CaptureRule
{
    /// <summary>A path into the response: <c>id</c>, <c>results[0].num</c>.</summary>
    public string Path { get; set; } = "";

    /// <summary>The variable name, without the braces.</summary>
    public string Variable { get; set; } = "";

    public override string ToString() => Path + "  →  {{" + Variable + "}}";
}

/// <summary>
/// Requests kept by name.
///
/// History already holds the last 60 calls, but it dies with the process and is
/// ordered by accident. This is the other thing: the half-dozen requests you
/// run every day, with their parameters filled in and their capture rules
/// attached — saved with the variables still written as {{placeholders}}, so
/// one saved request works against every server rather than being welded to the
/// one it was recorded on.
/// </summary>
public static class SavedRequests
{
    private static string File_ => Path.Combine(ApiCatalog.DataDir, "requests.json");

    private static readonly JsonSerializerOptions Json = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
        WriteIndented = true,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    public static List<SavedRequest> Load()
    {
        try
        {
            if (!System.IO.File.Exists(File_)) return [];
            var all = JsonSerializer.Deserialize<List<SavedRequest>>(System.IO.File.ReadAllText(File_), Json) ?? [];
            return [.. all.OrderBy(r => r.Name, StringComparer.OrdinalIgnoreCase)];
        }
        catch { return []; }
    }

    public static void Save(IEnumerable<SavedRequest> all)
    {
        try
        {
            Directory.CreateDirectory(ApiCatalog.DataDir);
            System.IO.File.WriteAllText(File_, JsonSerializer.Serialize(all, Json));
        }
        catch { }
    }

    /// <summary>Add, or replace one already saved under the same name.</summary>
    public static List<SavedRequest> Put(SavedRequest request)
    {
        var all = Load();
        var existing = all.FirstOrDefault(r =>
            r.Name.Equals(request.Name, StringComparison.OrdinalIgnoreCase));
        if (existing is not null) all.Remove(existing);
        all.Add(request);
        Save(all);
        return Load();
    }

    public static List<SavedRequest> Remove(string id)
    {
        var all = Load();
        all.RemoveAll(r => r.Id == id);
        Save(all);
        return Load();
    }
}
