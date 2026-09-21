using System.Collections.ObjectModel;
using Avalonia.Controls;
using Avalonia.Layout;
using Avalonia.Media;
using Avalonia.Threading;

namespace FbApiTool.Ui;

/// <summary>
/// Opening endpoints into tabs, and the context every pane is handed.
/// </summary>
public partial class MainWindow
{
    private readonly ApiRunner _runner = new();
    private readonly ObservableCollection<Variable> _vars = [];
    private readonly ObservableCollection<HistoryEntry> _history = [];

    /// <summary>
    /// What a request pane is allowed to ask of the window.
    ///
    /// Built fresh per pane rather than held as a field: every member is a
    /// delegate that reads current state, so a stale copy would be a pane
    /// talking about the connection it opened under.
    /// </summary>
    private RequestContext Context => new()
    {
        Catalog = _catalog,
        Runner = _runner,
        BaseUrl = () => _fb.BaseUrl,
        Token = () => _token,
        Status = s => Dispatcher.UIThread.Post(() => TxtStatus.Text = s),
        Setting = Get,
        SetSetting = Set,
        Variables = _vars,
        SetVariable = SetVariable,
        Rights = () => _fb.IsLoggedIn ? _fb.Rights : null,
        Authenticated = () => !string.IsNullOrEmpty(_token),
        ConfirmSend = ConfirmWriteAsync,
        Store = StoreRequest,
        Schema = () => null,
        LoadSchema = _ => Task.FromResult<DbSchema.Snapshot?>(null),
        Ask = (title, label, initial) => Dialogs.AskAsync(this, title, label, initial),
        Record = h => Dispatcher.UIThread.Post(() =>
        {
            _history.Insert(0, h);
            while (_history.Count > 60) _history.RemoveAt(_history.Count - 1);
        }),
    };

    private void SetVariable(string name, string value, string? note)
    {
        var existing = _vars.FirstOrDefault(v =>
            string.Equals(v.Name, name, StringComparison.OrdinalIgnoreCase));

        if (existing is not null) { existing.Value = value; existing.Note = note; }
        else _vars.Add(new Variable { Name = name, Value = value, Note = note });

        Variables.Save(_vars);
    }

    private void StoreRequest(SavedRequest r) => SavedRequests.Put(r);

    // ── TABS ────────────────────────────────────────────────────────────

    /// <summary>
    /// Open an endpoint, or bring its tab forward if it is already open.
    ///
    /// Reopening rather than duplicating: two tabs on one endpoint look
    /// identical on the strip and the second one silently loses whatever was
    /// typed into the first.
    /// </summary>
    private void OpenEndpoint(ApiEndpoint ep)
    {
        foreach (var existing in Tabs.Items.OfType<TabItem>())
        {
            if (existing.Content is RequestView v && v.Endpoint.Key == ep.Key)
            {
                Tabs.SelectedItem = existing;
                return;
            }
        }

        var view = new RequestView(Context, ep);
        var tab = new TabItem { Content = view, Header = TabHeader(ep, out var close) };
        close.Click += (_, _) =>
        {
            Tabs.Items.Remove(tab);
            Empty.IsVisible = Tabs.Items.Count == 0;
        };

        Tabs.Items.Add(tab);
        Tabs.SelectedItem = tab;
        Empty.IsVisible = false;

        Set("lastEndpoint", ep.Id);
    }

    /// <summary>A verb pill, the endpoint's name, and a close cross.</summary>
    private static Control TabHeader(ApiEndpoint ep, out Button close)
    {
        var pill = new Border
        {
            Background = Brand.FillForMethod(ep.Method),
            CornerRadius = new Avalonia.CornerRadius(3),
            Padding = new Avalonia.Thickness(5, 1),
            VerticalAlignment = VerticalAlignment.Center,
            Child = new TextBlock
            {
                Text = ep.Method.ToUpperInvariant(),
                Foreground = Brand.ForMethod(ep.Method),
                FontSize = 9,
                FontWeight = FontWeight.Bold,
            },
        };

        close = new Button
        {
            Content = "×",
            Padding = new Avalonia.Thickness(0),
            Width = 18,
            Background = Brushes.Transparent,
            BorderThickness = new Avalonia.Thickness(0),
            VerticalAlignment = VerticalAlignment.Center,
        };

        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 7 };
        row.Children.Add(pill);
        row.Children.Add(new TextBlock
        {
            Text = ep.Name,
            FontSize = 12,
            VerticalAlignment = VerticalAlignment.Center,
        });
        row.Children.Add(close);
        return row;
    }

    /// <summary>Every open pane, so a change of connection reaches all of them.</summary>
    private IEnumerable<RequestView> OpenViews() =>
        Tabs.Items.OfType<TabItem>().Select(t => t.Content).OfType<RequestView>();
}
