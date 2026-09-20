using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Windows;
using System.Windows.Media;

namespace FbApiTool;

/// <summary>A verb's colour, shared by the sidebar badge and the URL bar.</summary>
public static class MethodColours
{
    // fb-styles semantic tokens, not an invented palette: --fb-blue-accent
    // for a read, --fb-success for a write, --fb-negative for a delete, and
    // --acc-purple for anything else.
    public static Brush For(string method) => method.ToUpperInvariant() switch
    {
        "GET" => Make("#1e7bb4"),
        "POST" or "PUT" or "PATCH" => Make("#1B7A46"),
        "DELETE" => Make("#C43046"),
        _ => Make("#845EEB"),
    };

    /// <summary>
    /// The one accent the verbs do not use, for the completion entries that
    /// are not part of the database at all. Keywords, tables, views and
    /// columns have taken purple, blue, red and green between them.
    /// </summary>
    public static Brush Amber => Make("#B26A14");          // --fb-warning
    public static Brush AmberFill => Make("#FBEDC4");      // --acc-yellow-bg

    /// <summary>
    /// The tint a verb sits on — the same accent backgrounds the response
    /// table uses for a status chip, so the window has one chip style rather
    /// than two that happen to share a palette.
    /// </summary>
    public static Brush Fill(string method) => method.ToUpperInvariant() switch
    {
        "GET" => Make("#DEEAF4"),
        "POST" or "PUT" or "PATCH" => Make("#DBE8E1"),
        "DELETE" => Make("#F0D7DD"),
        _ => Make("#D9CEF7"),
    };

    private static readonly Dictionary<string, Brush> _cache = [];

    private static Brush Make(string hex)
    {
        if (_cache.TryGetValue(hex, out var b)) return b;
        var brush = new SolidColorBrush((Color)ColorConverter.ConvertFromString(hex));
        brush.Freeze();                          // shared across threads and templates
        _cache[hex] = brush;
        return brush;
    }
}

public sealed class EndpointNode(ApiEndpoint ep)
{
    public ApiEndpoint Endpoint { get; } = ep;
    public string Name => Endpoint.Name;
    public string Method => Endpoint.Method;
    /// <summary>The chip fill.</summary>
    public Brush MethodBrush => MethodColours.Fill(Endpoint.Method);

    /// <summary>The text on it.</summary>
    public Brush MethodInk => MethodColours.For(Endpoint.Method);
    public string ToolTip => Endpoint.Method + " " + Endpoint.Path;
}

public sealed class CategoryNode(string name, string icon) : INotifyPropertyChanged
{
    public string Name { get; } = name;
    public string Icon { get; } = icon;
    public ObservableCollection<EndpointNode> Endpoints { get; } = [];
    public string CountLabel => "(" + Endpoints.Count + ")";

    private bool _expanded;
    public bool IsExpanded
    {
        get => _expanded;
        set { _expanded = value; PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(IsExpanded))); }
    }

    public event PropertyChangedEventHandler? PropertyChanged;
}

/// <summary>A row of the Schema grid.</summary>
public sealed class SchemaRow(ApiAttr a)
{
    public string Name { get; } = a.Name;
    public string Type { get; } = a.Type;
    public string Description { get; } = a.Description;
    public string RequiredLabel { get; } = a.Optional ? "" : "required";
}

