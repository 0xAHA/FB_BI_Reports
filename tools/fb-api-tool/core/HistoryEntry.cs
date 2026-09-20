namespace FbApiTool;

/// <summary>
/// One past call, so it can be put back in the form.
///
/// A record of what was sent, not of how it looked: the window that lists
/// these is not the only one that might.
/// </summary>
public sealed class HistoryEntry
{
    public string EndpointId { get; init; } = "";
    public string Method { get; init; } = "";
    public string Url { get; init; } = "";
    public string? Body { get; init; }
    public int Status { get; init; }
    public DateTime At { get; init; } = DateTime.Now;

    public override string ToString() =>
        At.ToString("HH:mm:ss") + "  " + Status + "  " + Method + " " + Shorten(Url);

    private static string Shorten(string url)
    {
        var i = url.IndexOf("/api/", StringComparison.OrdinalIgnoreCase);
        return i < 0 ? url : url[i..];
    }
}
