using System.IO;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace FbApiTool;

/// <summary>One kept query result: what was asked, and what came back.</summary>
public sealed class QueryRun
{
    public string Id { get; set; } = "";
    public DateTime SavedAt { get; set; }
    public string Server { get; set; } = "";
    public string Sql { get; set; } = "";
    public int Status { get; set; }
    public long Millis { get; set; }
    public int RowCount { get; set; }
    public long Bytes { get; set; }

    /// <summary>A note the user typed, for telling two similar runs apart.</summary>
    public string? Label { get; set; }

    /// <summary>The response body. Kept in its own file, so null in the index.</summary>
    [JsonIgnore]
    public string? Body { get; set; }

    /// <summary>The first line of the statement, for the list.</summary>
    [JsonIgnore]
    public string Summary
    {
        get
        {
            if (!string.IsNullOrWhiteSpace(Label)) return Label!;
            var line = (Sql ?? "").Replace('\n', ' ').Replace('\r', ' ').Trim();
            while (line.Contains("  ", StringComparison.Ordinal)) line = line.Replace("  ", " ");
            return line.Length <= 70 ? line : line[..70] + "…";
        }
    }

    [JsonIgnore]
    public string When => SavedAt.ToString("ddd HH:mm:ss");

    [JsonIgnore]
    public string Meta => RowCount + (RowCount == 1 ? " row" : " rows") + "  ·  " + Millis + " ms";

    public override string ToString() => When + "   " + Summary;
}

/// <summary>
/// Keeps recent data-query results on disk so they can be looked at again, and
/// compared.
///
/// A query run against a live database cannot be re-run to get the same answer
/// — that is the whole reason for keeping it. "Was this number different an
/// hour ago?" is unanswerable unless the earlier answer was written down.
///
/// The index and the bodies are separate files: the list has to be readable
/// without loading several megabytes of rows, and a body is only wanted when
/// someone actually opens that run.
/// </summary>
public static class QueryHistory
{
    /// <summary>How many runs to keep. Older ones are deleted as new ones arrive.</summary>
    public const int Keep = 40;

    public static string Dir { get; } = Path.Combine(ApiCatalog.DataDir, "queries");

    private static string IndexFile => Path.Combine(Dir, "index.json");
    private static string BodyFile(string id) => Path.Combine(Dir, id + ".json");

    private static readonly JsonSerializerOptions Json = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
        WriteIndented = true,
    };

    /// <summary>Newest first. Entries whose body has gone missing are dropped.</summary>
    public static List<QueryRun> List()
    {
        try
        {
            if (!File.Exists(IndexFile)) return [];
            var all = JsonSerializer.Deserialize<List<QueryRun>>(File.ReadAllText(IndexFile), Json) ?? [];
            return [.. all.Where(r => File.Exists(BodyFile(r.Id))).OrderByDescending(r => r.SavedAt)];
        }
        catch { return []; }          // a corrupt index must not break the pane
    }

    /// <summary>Keep a result. Returns the run as stored, or null if it could not be written.</summary>
    public static QueryRun? Save(string server, string sql, ApiResult result, int rowCount, string? label = null)
    {
        try
        {
            Directory.CreateDirectory(Dir);

            var run = new QueryRun
            {
                Id = DateTime.Now.ToString("yyyyMMdd-HHmmss-fff"),
                SavedAt = DateTime.Now,
                Server = server,
                Sql = sql,
                Status = result.Status,
                Millis = result.Millis,
                RowCount = rowCount,
                Bytes = result.Bytes,
                Label = label,
            };

            File.WriteAllText(BodyFile(run.Id), result.Body);

            var all = List();
            all.Insert(0, run);
            Prune(all);
            WriteIndex(all);
            return run;
        }
        catch { return null; }        // keeping results is a convenience, never a blocker
    }

    /// <summary>The stored body, or null if it has gone.</summary>
    public static string? Body(string id)
    {
        try { return File.Exists(BodyFile(id)) ? File.ReadAllText(BodyFile(id)) : null; }
        catch { return null; }
    }

    public static void Rename(string id, string? label)
    {
        var all = List();
        var run = all.FirstOrDefault(r => r.Id == id);
        if (run is null) return;
        run.Label = string.IsNullOrWhiteSpace(label) ? null : label.Trim();
        WriteIndex(all);
    }

    public static void Delete(string id)
    {
        try { if (File.Exists(BodyFile(id))) File.Delete(BodyFile(id)); } catch { }
        WriteIndex(List().Where(r => r.Id != id).ToList());
    }

    public static void Clear()
    {
        foreach (var r in List()) { try { File.Delete(BodyFile(r.Id)); } catch { } }
        try { if (File.Exists(IndexFile)) File.Delete(IndexFile); } catch { }
    }

    /// <summary>Trim to <see cref="Keep"/>, deleting the bodies that go with it.</summary>
    private static void Prune(List<QueryRun> all)
    {
        if (all.Count <= Keep) return;
        foreach (var gone in all.Skip(Keep))
        {
            try { if (File.Exists(BodyFile(gone.Id))) File.Delete(BodyFile(gone.Id)); } catch { }
        }
        all.RemoveRange(Keep, all.Count - Keep);
    }

    private static void WriteIndex(List<QueryRun> all)
    {
        try
        {
            Directory.CreateDirectory(Dir);
            File.WriteAllText(IndexFile, JsonSerializer.Serialize(all, Json));
        }
        catch { }
    }
}
