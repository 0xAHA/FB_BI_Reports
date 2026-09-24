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
        Schema = () => _schema,
        LoadSchema = LoadSchemaAsync,
        Ask = (title, label, initial) => Dialogs.AskAsync(this, title, label, initial),
        Record = h => Dispatcher.UIThread.Post(() =>
        {
            _history.Insert(0, h);
            while (_history.Count > 60) _history.RemoveAt(_history.Count - 1);
        }),
    };

    private DbSchema.Snapshot? _schema;

    /// <summary>
    /// The database's own table and column list, for SQL completion.
    ///
    /// One round trip per server, cached on disk afterwards: the answer only
    /// changes when the schema does, and asking again on every keystroke would
    /// make completion cost a network call. A second, optional query marks the
    /// views MySQL cannot filter cheaply — the difference between a 2 ms query
    /// and a 2 s one, which is worth knowing before writing the WHERE.
    /// </summary>
    private async Task<DbSchema.Snapshot?> LoadSchemaAsync(bool force)
    {
        if (_schema is not null && !force && _schema.Server == _fb.BaseUrl) return _schema;

        // A cached schema still has to reach the tree. Returning it here and
        // leaving the browser as it was is why the second run against a server
        // showed an empty tree until Refresh was pressed — the data was there,
        // nobody had told the control.
        if (!force && DbSchema.Cached(_fb.BaseUrl) is { } cached)
        {
            _schema = cached;
            Dispatcher.UIThread.Post(RefreshSchemaTree);
            return _schema;
        }

        if (string.IsNullOrEmpty(_token)) return null;

        try
        {
            var r = await _runner.SendAsync(_fb.BaseUrl, "GET", "/api/data-query",
                [new("query", DbSchema.Query)], [], null, "application/json", _token);
            if (!r.Ok) return null;

            var snap = DbSchema.Parse(_fb.BaseUrl, r.Body);
            if (snap.Tables.Count == 0) return null;

            try
            {
                var hv = await _runner.SendAsync(_fb.BaseUrl, "GET", "/api/data-query",
                    [new("query", DbSchema.HeavyViewQuery)], [], null, "application/json", _token);
                if (hv.Ok) DbSchema.ApplyHeavyViews(snap, hv.Body);
            }
            catch { /* the schema is still usable without the warnings */ }

            DbSchema.Cache(snap);
            _schema = snap;

            Dispatcher.UIThread.Post(RefreshSchemaTree);
            Dispatcher.UIThread.Post(() => TxtStatus.Text =
                "Schema loaded — " + (snap.Tables.Count - snap.ViewCount) + " tables, " +
                snap.ViewCount + " views, " + snap.ColumnCount.ToString("N0") + " columns.");

            return _schema;
        }
        catch { return null; }
    }

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

        Log.Info("opening " + ep.Method + " " + ep.Path);

        RequestView view;
        try
        {
            view = new RequestView(Context, ep);
        }
        catch (Exception ex)
        {
            // A catalog entry with an unexpected shape should cost one
            // endpoint, not the window. Before this, building a pane that
            // threw took the whole application down with nothing written
            // anywhere to say which endpoint it was.
            Log.Crash("opening " + ep.Method + " " + ep.Path, ex);
            TxtStatus.Text = "Could not open " + ep.Name + " — see " + Log.CrashFile;
            return;
        }

        var tab = new TabItem { Content = view, Header = TabHeader(ep, out var close) };
        tab.Classes.Add("req");
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
        var verb = new TextBlock
        {
            Text = ep.Method.ToUpperInvariant(),
            FontSize = 9,
            FontWeight = FontWeight.Bold,
        };
        verb.Bind(TextBlock.ForegroundProperty, App.Token(Brand.InkKeyForMethod(ep.Method)));

        var pill = new Border
        {
            CornerRadius = new Avalonia.CornerRadius(3),
            Padding = new Avalonia.Thickness(5, 1),
            VerticalAlignment = VerticalAlignment.Center,
            Child = verb,
        };
        pill.Bind(Border.BackgroundProperty, App.Token(Brand.FillKeyForMethod(ep.Method)));

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

    // ── THE DATA TAB ────────────────────────────────────────────────────

    private RequestView? _dataView;

    /// <summary>
    /// The Data tab hosts the data-query endpoint itself rather than a second
    /// SQL screen, so there is only ever one of them to maintain and the
    /// endpoint still opens in the sidebar like any other.
    ///
    /// Built when the tab is first shown, not at start-up: most sessions never
    /// open it, and the pane costs a catalog lookup and a form to build.
    /// </summary>
    private void ShowDataTab()
    {
        if (_dataView is not null) return;

        var ep = _catalog.Endpoints.FirstOrDefault(e => e.QueryParams.Any(SqlFormat.IsSqlParam));
        if (ep is null)
        {
            DataHost.Children.Add(new TextBlock
            {
                Text = "This catalog has no data-query endpoint, so there is nothing to run SQL through.",
                Margin = new Avalonia.Thickness(24),
                FontSize = 13,
                TextWrapping = Avalonia.Media.TextWrapping.Wrap,
                Foreground = Brand.BlueAccent,
            });
            return;
        }

        try
        {
            _dataView = new RequestView(Context, ep);
            DataHost.Children.Add(_dataView);
        }
        catch (Exception ex)
        {
            Log.Crash("opening the Data tab", ex);
            DataHost.Children.Add(new TextBlock
            {
                Text = "The SQL workspace could not be built. See " + Log.CrashFile,
                Margin = new Avalonia.Thickness(24),
                FontSize = 13,
                TextWrapping = Avalonia.Media.TextWrapping.Wrap,
                Foreground = Brand.Negative,
            });
        }
    }

    /// <summary>Every open pane, so a change of connection reaches all of them.</summary>
    private IEnumerable<RequestView> OpenViews()
    {
        foreach (var v in Tabs.Items.OfType<TabItem>().Select(t => t.Content).OfType<RequestView>())
            yield return v;

        if (_dataView is not null) yield return _dataView;
    }
}
