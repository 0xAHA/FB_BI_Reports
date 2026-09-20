using System.Collections.ObjectModel;
using System.ComponentModel;

namespace FbApiTool.Ui;

/// <summary>One endpoint in the sidebar.</summary>
/// <remarks>
/// A thin wrapper rather than binding straight to ApiEndpoint: the tree wants
/// a couple of display-only things, and the core's record should not grow them.
/// The verb's colours are converters, so nothing here names a brush either.
/// </remarks>
public sealed class EndpointNode(ApiEndpoint endpoint)
{
    public ApiEndpoint Endpoint { get; } = endpoint;

    public string Method => Endpoint.Method.ToUpperInvariant();
    public string Name => Endpoint.Name;
    public string Path => Endpoint.Path;

    /// <summary>What the status bar says when this is selected.</summary>
    public string Summary => Endpoint.Category + " · " + Endpoint.Name;

    public override string ToString() => Method + " " + Path;
}

/// <summary>A category of endpoints, and whether it is open.</summary>
public sealed class CategoryNode(string name, string glyph) : INotifyPropertyChanged
{
    private bool _expanded;

    public string Name { get; } = name;
    public string Glyph { get; } = glyph;
    public ObservableCollection<EndpointNode> Endpoints { get; } = [];

    public string CountLabel => "(" + Endpoints.Count + ")";

    public bool IsExpanded
    {
        get => _expanded;
        set
        {
            if (_expanded == value) return;
            _expanded = value;
            PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(IsExpanded)));
        }
    }

    public event PropertyChangedEventHandler? PropertyChanged;
}
