using System.Collections.ObjectModel;
using System.Diagnostics;
using System.IO;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Threading;
using FbReportHost;
using Microsoft.Web.WebView2.Wpf;

namespace FbApiTool;

public partial class MainWindow : Window
{
    private readonly FishbowlClient _fb = new() { AppName = "Fishbowl Advanced API Tool", AppId = 101 };
    private readonly ApiRunner _runner = new();

    private ApiCatalog _catalog = null!;
    private readonly ObservableCollection<CategoryNode> _tree = [];

    /// <summary>
    /// The bearer token in use. Not always the one LoginAsync produced — the
    /// tool is routinely handed a token from elsewhere to reproduce someone
    /// else's failing call, so a pasted token is a first-class way to connect.
    /// </summary>
    private string? _token;
    private string _tokenOwner = "";

    private readonly ObservableCollection<HistoryEntry> _history = [];

    // ── IDLE SIGN-OUT ───────────────────────────────────────────────────
    // Fishbowl licences are seat-limited, so a session this tool holds onto
    // is a seat nobody else can have. Leaving one open over a long lunch is
    // the normal way that happens.

    private readonly IdleWatch _idle = new();
    private readonly DispatcherTimer _idleTimer = new() { Interval = TimeSpan.FromSeconds(1) };

    private void StartIdleWatch()
    {
        _idleTimer.Tick += (_, _) => CheckIdle();

        // Preview handlers on the window catch everything, including keys and
        // clicks that a child control goes on to handle itself.
        PreviewMouseMove += (_, _) => Touch();
        PreviewMouseDown += (_, _) => Touch();
        PreviewKeyDown += (_, _) => Touch();
        PreviewMouseWheel += (_, _) => Touch();
        Activated += (_, _) => Touch();
    }

    private void Touch()
    {
        _idle.Touch();
        if (IdleBanner.Visibility == Visibility.Visible) IdleBanner.Visibility = Visibility.Collapsed;
    }

    /// <summary>Run the watch only while there is a session worth releasing.</summary>
    private void SetIdleWatch(bool on)
    {
        // A session nobody asked to be released is still not released.
        on = on && Prefs.IdleEnabledOr(Get);
        _idle.Enabled = on;
        _idle.Touch();
        IdleBanner.Visibility = Visibility.Collapsed;
        if (on) _idleTimer.Start(); else _idleTimer.Stop();
    }

    private async void CheckIdle()
    {
        switch (_idle.State())
        {
            case IdleState.Warning:
                IdleBanner.Visibility = Visibility.Visible;
                TxtIdle.Text = _idle.Message();
                break;

            case IdleState.Expired:
                SetIdleWatch(false);
                await SignOutAsync("Signed out after " + (int)_idle.IdleAfter.TotalMinutes +
                                   " minutes idle, to release the licence.");
                break;

            default:
                if (IdleBanner.Visibility == Visibility.Visible)
                    IdleBanner.Visibility = Visibility.Collapsed;
                break;
        }
    }

    private void BtnStaySignedIn_Click(object sender, RoutedEventArgs e) => Touch();

    /// <summary>
    /// Drop the session. Only logs out of one this tool opened — a pasted
    /// token belongs to somebody else and ending it would be a surprise.
    /// </summary>
    private async Task SignOutAsync(string why)
    {
        if (_fb.IsLoggedIn) { try { await _fb.LogoutAsync(); } catch { } }
        _token = null;
        _tokenOwner = "";
        RefreshAuth();
        RefreshOpenUrls();
        TxtStatus.Text = why;
    }

    private DbSchema.Snapshot? _schema;

    /// <summary>
    /// Read the database's tables and columns, for SQL completion.
    ///
    /// Through /api/data-query rather than from a schema file in the repo,
    /// because the answer is instance-specific — custom fields, and whichever
    /// version that database is on. Cached per server; it changes about as
    /// often as an upgrade.
    /// </summary>
    private async Task<DbSchema.Snapshot?> LoadSchemaAsync(bool force)
    {
        if (_schema is not null && !force && _schema.Server == _fb.BaseUrl) return _schema;

        if (!force && DbSchema.Cached(_fb.BaseUrl) is { } cached) { _schema = cached; return _schema; }
        if (string.IsNullOrEmpty(_token)) return null;

        try
        {
            var r = await _runner.SendAsync(_fb.BaseUrl, "GET", "/api/data-query",
                [new("query", DbSchema.Query)], [], null, "application/json", _token);
            if (!r.Ok) return null;

            var snap = DbSchema.Parse(_fb.BaseUrl, r.Body);
            if (snap.Tables.Count == 0) return null;

            // Which views cannot be filtered cheaply. A second round trip, but
            // only ever once per server, and it is the difference between a
            // 2 ms query and a 2 s one.
            try
            {
                var hv = await _runner.SendAsync(_fb.BaseUrl, "GET", "/api/data-query",
                    [new("query", DbSchema.HeavyViewQuery)], [], null, "application/json", _token);
                if (hv.Ok) DbSchema.ApplyHeavyViews(snap, hv.Body);
            }
            catch { /* the schema is still usable without the warnings */ }

            DbSchema.Cache(snap);
            _schema = snap;
            TxtStatus.Text = "Schema loaded — " + (snap.Tables.Count - snap.ViewCount) + " tables, " +
                             snap.ViewCount + " views, " + snap.ColumnCount.ToString("N0") + " columns.";
            if (_dataView is not null) RefreshSchemaTree();
            return _schema;
        }
        catch { return null; }
    }

    private WebView2? _docs;
    private readonly string _settingsFile = Path.Combine(ApiCatalog.DataDir, "settings.json");
    private JsonObject _settings = new();

    public MainWindow()
    {
        InitializeComponent();
        LoadSettings();

        try { _catalog = Assets.LoadCatalog(); }
        catch (Exception ex)
        {
            MessageBox.Show(this,
                "The endpoint catalog could not be read, so there is nothing to drive the UI.\n\n" + ex.Message,
                "Fishbowl API Tool", MessageBoxButton.OK, MessageBoxImage.Error);
            _catalog = new ApiCatalog();
        }

        TreeEndpoints.ItemsSource = _tree;
        LstHistory.ItemsSource = _history;
        // The workspace panel is dragged to taste; put it back where it was.
        if (double.TryParse(Get("workspaceHeight"), out var wh) && wh >= 72)
            RowWorkspace.Height = new GridLength(wh);

        LoadVariables();
        LoadSaved();
        LoadProfiles();
        BuildTree();
        RefreshCatalogChip();
        RefreshAuth();

        TxtVersion.Text = BuildInfo.Full;

        StartIdleWatch();

        Loaded += async (_, _) => await OnLoadedAsync();
    }

    private async Task OnLoadedAsync()
    {
        ApplyIdlePrefs();

        await ShowConnectAsync(firstRun: true);
        if (!string.IsNullOrWhiteSpace(_fb.BaseUrl)) await CheckForUpdatesAsync(quiet: true);

        // After connecting, not before: the first thing the tour points at is
        // the server list, which means nothing while a modal is over it.
        if (Prefs.TourPending(Get)) StartTour();
    }

    private RequestContext Context => new()
    {
        Catalog = _catalog,
        Runner = _runner,
        BaseUrl = () => _fb.BaseUrl,
        Token = () => _token,
        Status = s => Dispatcher.Invoke(() => TxtStatus.Text = s),
        Setting = Get,
        SetSetting = Set,
        Variables = _vars,
        SetVariable = SetVariable,
        Rights = () => _fb.IsLoggedIn ? _fb.Rights : null,
        Authenticated = () => !string.IsNullOrEmpty(_token),
        ConfirmSend = ConfirmWrite,
        Store = StoreRequest,
        Schema = () => _schema,
        LoadSchema = LoadSchemaAsync,
        Ask = Prompt,
        Record = h => Dispatcher.Invoke(() =>
        {
            _history.Insert(0, h);
            while (_history.Count > 60) _history.RemoveAt(_history.Count - 1);
        }),
    };

    /// <summary>
    /// Move the saved / variables / history panel to whichever tab is showing.
    ///
    /// Moved rather than duplicated. Two copies would mean two lists of
    /// variables, and the one thing a variable is for is being the same value
    /// in more than one place — a second panel that disagreed with the first
    /// would defeat the feature it was added to support.
    /// </summary>
    private void Shell_Changed(object sender, SelectionChangedEventArgs e)
    {
        // TabControl raises this for its inner tab strips too.
        if (!ReferenceEquals(e.OriginalSource, Shell)) return;

        var host = ReferenceEquals(Shell.SelectedItem, TabData) ? WorkHostData : WorkHostRequests;
        if (ReferenceEquals(Workspace.Parent, host)) return;

        if (Workspace.Parent is ContentControl old) old.Content = null;
        host.Content = Workspace;
    }

    // ── SETTINGS ────────────────────────────────────────────────────────

    private string? Get(string k) => _settings[k]?.GetValue<string>();

    private void Set(string k, string v)
    {
        _settings[k] = v;
        try
        {
            Directory.CreateDirectory(ApiCatalog.DataDir);
            File.WriteAllText(_settingsFile, _settings.ToJsonString(new JsonSerializerOptions { WriteIndented = true }));
        }
        catch { /* a tool must not fall over because it cannot persist a preference */ }
    }

    private void LoadSettings()
    {
        try
        {
            if (File.Exists(_settingsFile))
                _settings = JsonNode.Parse(File.ReadAllText(_settingsFile))?.AsObject() ?? new JsonObject();
        }
        catch { _settings = new JsonObject(); }

        _fb.BaseUrl = Get("server") ?? "http://localhost:2456";
        _fb.AppName = Get("appName") ?? _fb.AppName;
        if (int.TryParse(Get("appId"), out var id)) _fb.AppId = id;
    }

    // ── SIDEBAR ─────────────────────────────────────────────────────────

    private void BuildTree()
    {
        var term = TxtSearch.Text?.Trim() ?? "";
        var methods = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        if (TogGet.IsChecked == true) methods.Add("GET");
        if (TogPost.IsChecked == true) { methods.Add("POST"); methods.Add("PUT"); methods.Add("PATCH"); }
        if (TogDelete.IsChecked == true) methods.Add("DELETE");

        var open = _tree.Where(c => c.IsExpanded).Select(c => c.Name).ToHashSet(StringComparer.OrdinalIgnoreCase);
        _tree.Clear();

        var matches = _catalog.Endpoints
            .Where(e => methods.Contains(e.Method))
            .Where(e => Matches(e, term))
            .OrderBy(e => e.Category, StringComparer.OrdinalIgnoreCase)
            .ThenBy(e => e.Name, StringComparer.OrdinalIgnoreCase);

        foreach (var group in matches.GroupBy(e => e.Category))
        {
            var cat = new CategoryNode(group.Key, _catalog.IconFor(group.Key));
            foreach (var e in group) cat.Endpoints.Add(new EndpointNode(e));
            // A search is a request to see what matched, so open everything;
            // otherwise remember what the user had open.
            cat.IsExpanded = term.Length > 0 || open.Contains(group.Key);
            _tree.Add(cat);
        }

        TxtStatus.Text = term.Length > 0
            ? _tree.Sum(c => c.Endpoints.Count) + " endpoint(s) match “" + term + "”"
            : _catalog.Endpoints.Count + " endpoints in " + _tree.Count + " categories";
    }

    private static bool Matches(ApiEndpoint e, string term)
    {
        if (term.Length == 0) return true;
        return e.Name.Contains(term, StringComparison.OrdinalIgnoreCase)
            || e.Path.Contains(term, StringComparison.OrdinalIgnoreCase)
            || e.Category.Contains(term, StringComparison.OrdinalIgnoreCase)
            || e.Description.Contains(term, StringComparison.OrdinalIgnoreCase);
    }

    private void TxtSearch_TextChanged(object sender, TextChangedEventArgs e) => BuildTree();
    private void Method_Toggled(object sender, RoutedEventArgs e) => BuildTree();

    private void BtnExpandAll_Click(object sender, RoutedEventArgs e)
    { foreach (var c in _tree) c.IsExpanded = true; }

    private void BtnCollapseAll_Click(object sender, RoutedEventArgs e)
    { foreach (var c in _tree) c.IsExpanded = false; }

    private void TreeEndpoints_SelectedItemChanged(object sender, RoutedPropertyChangedEventArgs<object> e)
    {
        if (e.NewValue is EndpointNode n) TxtStatus.Text = n.Endpoint.Category + " · " + n.Endpoint.Name;
    }

    private void TreeEndpoints_MouseDoubleClick(object sender, MouseButtonEventArgs e)
    {
        if (TreeEndpoints.SelectedItem is EndpointNode n) Open(n.Endpoint);
    }

    // ── TABS ────────────────────────────────────────────────────────────

    /// <summary>
    /// Open an endpoint in its own tab, or focus the tab it is already in.
    ///
    /// Reusing one pane meant that looking up a part id half way through
    /// composing a sales order threw the order away. A tab per endpoint keeps
    /// both, which is how anyone actually works against an API.
    /// </summary>
    private RequestView Open(ApiEndpoint ep)
    {
        foreach (TabItem existing in Tabs.Items)
            if (existing.Content is RequestView v && v.Endpoint.Id == ep.Id)
            {
                existing.IsSelected = true;
                return v;
            }

        var view = new RequestView(Context, ep);
        var tab = new TabItem { Content = view, Header = TabHeader(ep, view) };
        Tabs.Items.Add(tab);
        tab.IsSelected = true;
        Empty.Visibility = Visibility.Collapsed;
        Set("lastEndpoint", ep.Id);
        return view;
    }

    /// <summary>A verb badge, the name, and a close button — none of which a TabItem gives you.</summary>
    private object TabHeader(ApiEndpoint ep, RequestView view)
    {
        var sp = new StackPanel { Orientation = Orientation.Horizontal, ToolTip = ep.Method + " " + ep.Path };

        sp.Children.Add(new Border
        {
            Background = MethodColours.Fill(ep.Method),
            CornerRadius = new CornerRadius(3),
            Padding = new Thickness(5, 1, 5, 1),
            VerticalAlignment = VerticalAlignment.Center,
            Child = new TextBlock
            {
                Text = ep.Method,
                Foreground = MethodColours.For(ep.Method),
                FontSize = 9.5,
                FontWeight = FontWeights.Bold,
                FontFamily = (FontFamily)FindResource("FbMono"),
            },
        });

        sp.Children.Add(new TextBlock
        {
            Text = ep.Name, MaxWidth = 200, TextTrimming = TextTrimming.CharacterEllipsis,
            VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(7, 0, 0, 0),
        });

        var close = new Button
        {
            Content = "×", Width = 17, Height = 17, Padding = new Thickness(0),
            Margin = new Thickness(7, 0, 0, 0), FontSize = 13,
            BorderThickness = new Thickness(0), Background = Brushes.Transparent, ToolTip = "Close",
        };
        close.Click += (_, _) => CloseTab(view);
        sp.Children.Add(close);
        return sp;
    }

    private void CloseTab(RequestView view)
    {
        foreach (TabItem t in Tabs.Items)
            if (ReferenceEquals(t.Content, view)) { Tabs.Items.Remove(t); break; }
        if (Tabs.Items.Count == 0) Empty.Visibility = Visibility.Visible;
    }

    /// <summary>
    /// Every open pane has to follow a change of connection: the URL preview
    /// for a change of server, and the access-right chip because it answers a
    /// question about whoever is signed in NOW. Leaving the chip alone was why
    /// a tab opened before signing in kept saying it could not tell.
    /// </summary>
    private void RefreshOpenUrls()
    {
        foreach (var v in OpenViews())
        {
            v.UpdateUrl();
            v.RefreshRights();
        }
    }

    /// <summary>Every request pane, including the one on the Data tab.</summary>
    private IEnumerable<RequestView> OpenViews()
    {
        foreach (TabItem t in Tabs.Items)
            if (t.Content is RequestView v) yield return v;
        if (_dataView is not null) yield return _dataView;
    }

    // ── HISTORY ─────────────────────────────────────────────────────────

    private void LstHistory_DoubleClick(object sender, MouseButtonEventArgs e)
    {
        if (LstHistory.SelectedItem is not HistoryEntry h) return;
        var ep = _catalog.ById(h.EndpointId);
        if (ep is null) { TxtStatus.Text = "That endpoint is no longer in the catalog."; return; }

        Open(ep).Restore(h);
        TxtStatus.Text = "Reopened the request from " + h.At.ToString("HH:mm:ss") + ".";
    }

    private void BtnClearHist_Click(object sender, RoutedEventArgs e) => _history.Clear();

    // ── CONNECTION ──────────────────────────────────────────────────────

    private void RefreshAuth()
    {
        var connected = !string.IsNullOrEmpty(_token);
        TxtAuth.Text = connected ? _tokenOwner : "not connected";
        BtnAuth.Content = connected ? "Disconnect" : "Connect";
        TxtServerChip.Text = _fb.BaseUrl;
    }

    private async void BtnAuth_Click(object sender, RoutedEventArgs e)
    {
        if (!string.IsNullOrEmpty(_token))
        {
            // A pasted token belongs to someone else's session — ending it would
            // be a surprise, so only a session this tool opened gets logged out.
            SetIdleWatch(false);
            await SignOutAsync("Disconnected.");
            return;
        }
        await ShowConnectAsync(firstRun: false);
    }

    private async Task ShowConnectAsync(bool firstRun)
    {
        var dlg = new ConnectWindow(_fb, Get("user"));
        if (firstRun) dlg.WindowStartupLocation = WindowStartupLocation.CenterScreen;
        else dlg.Owner = this;
        dlg.ShowDialog();

        if (dlg.Token is not null)
        {
            _token = dlg.Token;
            _tokenOwner = dlg.ConnectedAs;
            Set("server", _fb.BaseUrl);
            Set("appName", _fb.AppName);
            Set("appId", _fb.AppId.ToString());
            if (dlg.Username is not null) Set("user", dlg.Username);
            TxtStatus.Text = "Connected to " + _fb.BaseUrl + " as " + _tokenOwner + ".";
            _ = LoadSchemaAsync(force: false);
            SetIdleWatch(true);
        }
        else if (firstRun)
        {
            // Unlike the report host there IS something to do offline — the
            // catalog and the guide are local — so cancelling leaves the tool
            // disconnected rather than closing it.
            TxtStatus.Text = "Not connected. The endpoint list and documentation still work.";
        }

        RefreshAuth();
        RefreshOpenUrls();
        await Task.CompletedTask;
    }

    // ── CATALOG UPDATES ─────────────────────────────────────────────────

    private void RefreshCatalogChip(string? serverVersion = null)
    {
        var mine = string.IsNullOrWhiteSpace(_catalog.Version) ? "?" : _catalog.Version;
        TxtBuiltFor.Text = "built against Fishbowl Advanced API v" + mine +
                           (_catalog.IsUserCopy ? " (updated)" : "");
        TxtDocsChip.Text = serverVersion is null
            ? "catalog v" + mine
            : "catalog v" + mine + "  ·  server v" + serverVersion;
        ChipDocs.Background = serverVersion is not null &&
                              !serverVersion.Equals(_catalog.Version, StringComparison.OrdinalIgnoreCase)
            ? (Brush)FindResource("FbAmber")
            : (Brush)FindResource("FbBlueAccent");
    }

    private void ChipDocs_Click(object sender, MouseButtonEventArgs e) => ShowSettings("catalog");

    /// <summary>What the server documents, against what is catalogued.</summary>
    private async Task<CatalogDiffResult?> FetchDiffAsync()
    {
        if (string.IsNullOrWhiteSpace(_fb.BaseUrl)) return null;

        var incoming = ApiDocsImport.Parse(await ApiDocsImport.FetchAsync(_fb.BaseUrl));
        RefreshCatalogChip(incoming.Version);
        return CatalogDiff.Compare(_catalog, incoming);
    }

    /// <summary>
    /// Apply the ticked changes. Returns what to tell the user, because the
    /// settings window shows it in place rather than in a message box.
    /// </summary>
    private string ApplyDiff(CatalogDiffResult diff)
    {
        var applied = diff.Changes.Count(c => c.Apply);

        var updated = CatalogDiff.Apply(_catalog, diff);
        updated.Save();
        _catalog = updated;

        BuildTree();
        RefreshCatalogChip();
        TxtStatus.Text = "Catalog updated to v" + updated.Version + " — " + applied + " change(s) applied.";

        // Open tabs hold the OLD endpoint records; rebinding them behind the
        // user's back would be worse than saying so.
        return applied + " change(s) applied. The catalog is now at v" + updated.Version +
               ", saved to " + ApiCatalog.UserFile + "." +
               (Tabs.Items.Count > 0
                   ? " Tabs already open still show the previous shape — close and reopen them to refresh."
                   : "");
    }

    /// <summary>
    /// Ask the server what it documents and offer to bring the catalog into
    /// line. Runs quietly at start-up — nobody wants a modal every launch — and
    /// loudly from the button, where silence would look like a broken button.
    /// </summary>
    private async Task CheckForUpdatesAsync(bool quiet)
    {
        try
        {
            var json = await ApiDocsImport.FetchAsync(_fb.BaseUrl);
            var incoming = ApiDocsImport.Parse(json);
            RefreshCatalogChip(incoming.Version);

            var diff = CatalogDiff.Compare(_catalog, incoming);

            if (!diff.HasWork)
            {
                var same = "The catalog already matches this server (v" + incoming.Version + ")." +
                           (diff.MissingCount > 0
                               ? "\n\n" + diff.MissingCount + " catalogued endpoint(s) are not in this server's " +
                                 "documentation. That is normal — some are curated additions, and an older server " +
                                 "documents less."
                               : "");
                TxtStatus.Text = "Catalog is up to date with v" + incoming.Version + ".";
                if (!quiet) MessageBox.Show(this, same, "Fishbowl API Tool", MessageBoxButton.OK, MessageBoxImage.Information);
                return;
            }

            if (quiet)
            {
                // At start-up, say so and let them choose the moment.
                TxtStatus.Text = "This server documents v" + incoming.Version + " — " + diff.Summary +
                                 ". Use “Check for updates” to review.";
                ChipDocs.Background = (Brush)FindResource("FbAmber");
                return;
            }

            // The review lives in the settings window now, so a loud check just
            // opens it on that page with the answer already in hand.
            ShowSettings("catalog");
        }
        catch (Exception ex)
        {
            TxtStatus.Text = "Update check failed: " + ex.Message;
            if (!quiet)
                MessageBox.Show(this,
                    "Could not read the server's API documentation.\n\n" + ex.Message +
                    "\n\nTried: " + ApiDocsImport.DocsUrl(_fb.BaseUrl),
                    "Fishbowl API Tool", MessageBoxButton.OK, MessageBoxImage.Warning);
        }
    }

    // ── DOCUMENTATION ───────────────────────────────────────────────────

    private async void ShowDocs()
    {
        if (_docs is not null) return;
        _docs = new WebView2();
        DocsHost.Children.Add(_docs);
        try
        {
            await _docs.EnsureCoreWebView2Async();
            ShowDoc();
        }
        catch (Exception ex)
        {
            DocsHost.Children.Clear();
            DocsHost.Children.Add(new TextBlock
            {
                Text = "The documentation needs the Microsoft Edge WebView2 Runtime.\n\n" + ex.Message,
                TextWrapping = TextWrapping.Wrap, Margin = new Thickness(24), FontSize = 14,
            });
            _docs = null;
        }
    }

    private void BtnDocsBack_Click(object sender, RoutedEventArgs e)
    {
        if (_docs?.CoreWebView2?.CanGoBack == true) _docs.CoreWebView2.GoBack();
    }

    private void BtnDocsHome_Click(object sender, RoutedEventArgs e) => ShowDoc();

    private void Doc_Click(object sender, RoutedEventArgs e) => ShowDoc();

    /// <summary>
    /// Show whichever document is selected.
    ///
    /// The two are kept apart on purpose. The API guide is a verbatim copy
    /// of Fishbowl_API_App_Guide.htm — anything written into it would be
    /// lost the next time that file is refreshed — and it answers a quite
    /// different question from "how do I drive this window".
    /// </summary>
    private void ShowDoc()
    {
        if (_docs?.CoreWebView2 is null) return;
        var path = DocApi.IsChecked == true ? Assets.GuidePath() : Assets.ToolGuidePath();
        _docs.CoreWebView2.Navigate(new Uri(path).AbsoluteUri);
    }

    private void BtnDocsLive_Click(object sender, RoutedEventArgs e)
    {
        try { Process.Start(new ProcessStartInfo(_fb.BaseUrl.TrimEnd('/') + "/apidocs") { UseShellExecute = true }); }
        catch (Exception ex) { TxtStatus.Text = "Could not open the browser: " + ex.Message; }
    }

    protected override void OnContentRendered(EventArgs e)
    {
        base.OnContentRendered(e);
        // Load the browser only when the tab is first opened: WebView2 costs a
        // process, and plenty of sessions never look at the guide.
        Shell.SelectionChanged += (_, args) =>
        {
            if (args.OriginalSource != Shell) return;
            if (ReferenceEquals(Shell.SelectedItem, TabDocs)) ShowDocs();
            else if (ReferenceEquals(Shell.SelectedItem, TabData)) ShowDataTab();
        };

        if (Get("lastEndpoint") is { } id && _catalog.ById(id) is { } ep) Open(ep);
    }

    protected override async void OnClosed(EventArgs e)
    {
        base.OnClosed(e);
        Set("workspaceHeight", RowWorkspace.ActualHeight.ToString("F0"));
        // Leave no session behind on the server — but only one this tool opened.
        if (_fb.IsLoggedIn) { try { await _fb.LogoutAsync(); } catch { } }
        _docs?.Dispose();
    }

    // ── SERVER PROFILES ─────────────────────────────────────────────────
    // The convenience half is switching servers without retyping a URL. The
    // safety half matters more: this window sends real writes at real
    // databases, and until now the only thing telling production apart from a
    // sandbox was a URL in an 11px status bar.

    private readonly ObservableCollection<ServerProfile> _profiles = [];
    private bool _loadingProfiles;

    /// <summary>The server currently selected, if it is a saved profile.</summary>
    private ServerProfile? CurrentProfile => CmbProfile.SelectedItem as ServerProfile;

    private bool OnProduction => CurrentProfile?.IsProduction == true;

    private void LoadProfiles()
    {
        _loadingProfiles = true;
        _profiles.Clear();
        foreach (var p in Profiles.Load()) _profiles.Add(p);

        // First run: adopt whatever server was already in settings, so nothing
        // has to be set up before the tool works.
        if (_profiles.Count == 0)
        {
            _profiles.Add(new ServerProfile
            {
                Name = "Local",
                BaseUrl = _fb.BaseUrl,
                Username = Get("user"),
                AppName = _fb.AppName,
                AppId = _fb.AppId,
                IsProduction = Profiles.LooksLikeProduction(_fb.BaseUrl),
            });
            Profiles.Save(_profiles);
        }

        CmbProfile.ItemsSource = _profiles;
        var wanted = Get("profile");
        CmbProfile.SelectedItem = _profiles.FirstOrDefault(p => p.Id == wanted) ?? _profiles[0];
        _loadingProfiles = false;

        ApplyProfile();
    }

    private void CmbProfile_Changed(object sender, SelectionChangedEventArgs e)
    {
        if (_loadingProfiles) return;
        ApplyProfile();
    }

    /// <summary>
    /// Point the client at the selected server.
    ///
    /// Changing server invalidates the token — it belongs to a session on the
    /// old one — so the connection is dropped rather than silently carried
    /// across and failing on the next call with a confusing 401.
    /// </summary>
    private void ApplyProfile()
    {
        if (CurrentProfile is not { } p) return;

        var moved = !string.Equals(_fb.BaseUrl, p.BaseUrl, StringComparison.OrdinalIgnoreCase);

        _fb.BaseUrl = p.BaseUrl;
        _fb.AppName = p.AppName;
        _fb.AppId = p.AppId;
        Set("profile", p.Id);
        Set("server", p.BaseUrl);
        if (p.Username is not null) Set("user", p.Username);

        if (moved && !string.IsNullOrEmpty(_token))
        {
            _token = null;
            _tokenOwner = "";
            TxtStatus.Text = "Switched to " + p + ". The previous token belonged to the other server, so you are disconnected.";
        }

        ApplyProductionWarning();
        RefreshAuth();
        RefreshOpenUrls();
        RefreshCatalogChip();
    }

    private void ApplyProductionWarning()
    {
        var prod = OnProduction;
        BrandBar.Background = prod ? (Brush)FindResource("FbNegative") : (Brush)FindResource("FbBlue");
        ProdBanner.Visibility = prod ? Visibility.Visible : Visibility.Collapsed;
        TxtProdBanner.Text = prod
            ? "PRODUCTION — " + _fb.BaseUrl + ".  Writes here change real data, and you will be asked to confirm each one."
            : "";
    }

    private void BtnProfiles_Click(object sender, RoutedEventArgs e) => ShowSettings();

    /// <summary>
    /// The one settings window. Preferences are written as they change, so
    /// there is nothing to apply on the way out except the things the running
    /// window caches: the selected profile and the idle timings.
    /// </summary>
    private void ShowSettings(string startOn = "servers")
    {
        var dlg = new SettingsWindow(_profiles, CurrentProfile, Get, Set, About(),
                                     string.IsNullOrWhiteSpace(_catalog.Version) ? "?" : _catalog.Version,
                                     startOn)
        {
            Owner = this,
            CheckCatalog = FetchDiffAsync,
            ApplyCatalog = ApplyDiff,
        };
        dlg.ShowDialog();

        Profiles.Save(_profiles);
        CmbProfile.Items.Refresh();
        if (dlg.Selected is not null) CmbProfile.SelectedItem = dlg.Selected;
        ApplyProfile();
        ApplyIdlePrefs();

        if (dlg.ShowDocs) Shell.SelectedItem = TabDocs;
        if (dlg.StartTour) StartTour();
    }

    private string About() =>
        "Catalog built against Fishbowl Advanced API v" +
        (string.IsNullOrWhiteSpace(_catalog.Version) ? "?" : _catalog.Version) +
        ", " + _catalog.Endpoints.Count + " endpoints." +
        "\nSettings and kept results live in " + ApiCatalog.DataDir + "." +
        "\nPasswords, when remembered, are held by Windows Credential Manager \u2014 never by this tool.";

    // ── THE TOUR ────────────────────────────────────────────────────────

    private Tour? _tour;

    /// <summary>
    /// What to point at, in the order somebody would actually meet it:
    /// connect, find an endpoint, send it, then the things around the edges
    /// that are easy to never notice.
    /// </summary>
    private IReadOnlyList<TourStop> TourStops() =>
    [
        new("Pick a server, then connect",
            "The list holds an address and app identity for each Fishbowl you use. A server marked as production turns this bar red and asks before every write.",
            () => CmbProfile),

        new("Find an endpoint",
            "Search by name, path or anything in the description. The GET / POST / DELETE pills filter the tree, and everything in it is generated from the server's own /apidocs.json.",
            () => TxtSearch),

        new("Click one to open it",
            "Each endpoint opens in its own tab with its parameters, a body template built from the documented fields, and the access right it needs when the docs name one.",
            () => TreeEndpoints),

        new("Requests stay open in tabs",
            "Work on several at once. Enter sends from any field; inside the editors it is Ctrl+Enter. The URL bar is editable if you need to send something the form cannot express.",
            () => Tabs),

        new("Saved requests, variables and history",
            "Keep a request by name, define {{variables}} to thread an id from one call into the next, and look back at what you have already sent. Drag the top edge to make this taller.",
            () => Workspace),

        new("A whole tab for SQL",
            "The Data tab is a SQL workspace over /api/data-query: schema-aware completion, a formatter, table output, and a comparison against the last time the query ran.",
            () => TabData),

        new("Two built-in guides",
            "One for this tool, one for the Fishbowl API itself. Both work with no connection and no browser.",
            () => TabDocs),

        new("Everything else is in here",
            "Servers, which view a response opens on, how long before an idle session signs out, and this tour if you want it again.",
            () => BtnProfiles),
    ];

    private void StartTour()
    {
        if (_tour?.Running == true) return;

        TourHost.IsHitTestVisible = true;
        _tour = new Tour(TourHost, TourStops(), () =>
        {
            TourHost.IsHitTestVisible = false;
            Set(Prefs.TipsDone, "1");
            TxtStatus.Text = "Tour finished. Run it again from the settings button.";
        });
        _tour.Start();
    }

    // ── IDLE ────────────────────────────────────────────────────────────

    /// <summary>Push the stored idle timings into the watch.</summary>
    private void ApplyIdlePrefs()
    {
        _idle.IdleAfter = TimeSpan.FromMinutes(Prefs.IdleMinutes(Get));
        _idle.Grace = TimeSpan.FromSeconds(Prefs.GraceSeconds(Get));
        SetIdleWatch(Prefs.IdleEnabledOr(Get) && _fb.IsLoggedIn);
    }

    /// <summary>
    /// Asked before a write against a profile marked production.
    ///
    /// Deliberately per request rather than a session-wide "I understand": the
    /// point is to interrupt the one call that was not meant to go there, and a
    /// box ticked an hour ago interrupts nothing.
    /// </summary>
    private bool ConfirmWrite(string method, string url)
    {
        if (!OnProduction || !Profiles.IsWrite(method)) return true;

        return MessageBox.Show(this,
            method.ToUpperInvariant() + " to a PRODUCTION server.\n\n" + url +
            "\n\nThis changes real data. Send it?",
            "Production write", MessageBoxButton.YesNo, MessageBoxImage.Warning,
            MessageBoxResult.No) == MessageBoxResult.Yes;
    }

    // ── VARIABLES ───────────────────────────────────────────────────────

    private readonly ObservableCollection<Variable> _vars = [];

    private void LoadVariables()
    {
        _vars.Clear();
        foreach (var v in Variables.Load()) _vars.Add(v);
        GridVars.ItemsSource = _vars;
    }

    private void SaveVariables() => Variables.Save(_vars);

    /// <summary>
    /// The X on a variable row. No confirmation: a variable is a name and a
    /// value typed a moment ago, and Add puts it straight back.
    /// </summary>
    private void BtnKillVar_Click(object sender, RoutedEventArgs e)
    {
        if (sender is not FrameworkElement { Tag: Variable v }) return;
        _vars.Remove(v);
        SaveVariables();
        TxtStatus.Text = v.Name.Length > 0 ? "Removed {{" + v.Name + "}}." : "Removed the empty variable.";
    }

    private void GridVars_Edited(object sender, DataGridCellEditEndingEventArgs e) =>
        Dispatcher.BeginInvoke(new Action(SaveVariables), DispatcherPriority.Background);

    private void BtnAddVar_Click(object sender, RoutedEventArgs e)
    {
        var v = new Variable { Name = "", Value = "" };
        _vars.Add(v);
        GridVars.SelectedItem = v;
        GridVars.CurrentCell = new DataGridCellInfo(v, GridVars.Columns[0]);
        GridVars.BeginEdit();
    }

    private void BtnRemoveVar_Click(object sender, RoutedEventArgs e)
    {
        if (GridVars.SelectedItem is Variable v) { _vars.Remove(v); SaveVariables(); }
    }

    private void BtnClearVars_Click(object sender, RoutedEventArgs e)
    {
        if (_vars.Count == 0) return;
        if (MessageBox.Show(this, "Remove all " + _vars.Count + " variable(s)?", "Clear variables",
                MessageBoxButton.YesNo, MessageBoxImage.Question, MessageBoxResult.No) != MessageBoxResult.Yes)
            return;
        _vars.Clear();
        SaveVariables();
    }

    /// <summary>Set by a capture rule, or by the capture button under a response.</summary>
    private void SetVariable(string name, string value, string? note)
    {
        var existing = _vars.FirstOrDefault(v => v.Name.Equals(name, StringComparison.OrdinalIgnoreCase));
        if (existing is null) _vars.Add(new Variable { Name = name, Value = value, Note = note });
        else { existing.Value = value; existing.Note = note; }
        SaveVariables();
        Workspace.SelectedIndex = 1;               // show what just changed
    }

    // ── SAVED REQUESTS ──────────────────────────────────────────────────

    private readonly ObservableCollection<SavedRequest> _saved = [];

    private void LoadSaved()
    {
        _saved.Clear();
        foreach (var r in SavedRequests.Load()) _saved.Add(r);
        LstSaved.ItemsSource = _saved;
    }

    private void StoreRequest(SavedRequest request)
    {
        _saved.Clear();
        foreach (var r in SavedRequests.Put(request)) _saved.Add(r);
        Workspace.SelectedIndex = 0;
        TxtStatus.Text = "Saved “" + request.Name + "”.";
    }

    private void LstSaved_DoubleClick(object sender, MouseButtonEventArgs e) => OpenSaved();

    private void BtnOpenSaved_Click(object sender, RoutedEventArgs e) => OpenSaved();

    private void OpenSaved()
    {
        if (LstSaved.SelectedItem is not SavedRequest r) return;
        var ep = _catalog.ById(r.EndpointId);
        if (ep is null) { TxtStatus.Text = "That endpoint is no longer in the catalog."; return; }
        Open(ep).Apply(r);
        TxtStatus.Text = "Opened “" + r.Name + "”.";
    }

    private void BtnRenameSaved_Click(object sender, RoutedEventArgs e)
    {
        if (LstSaved.SelectedItem is not SavedRequest r) { TxtStatus.Text = "Select a saved request first."; return; }
        var name = Prompt("Rename request", "A name for this request:", r.Name);
        if (string.IsNullOrWhiteSpace(name)) return;
        r.Name = name.Trim();
        SavedRequests.Save(_saved);
        LstSaved.Items.Refresh();
    }

    private void BtnDeleteSaved_Click(object sender, RoutedEventArgs e)
    {
        if (LstSaved.SelectedItem is not SavedRequest r) { TxtStatus.Text = "Select a saved request first."; return; }
        _saved.Clear();
        foreach (var x in SavedRequests.Remove(r.Id)) _saved.Add(x);
        TxtStatus.Text = "Deleted “" + r.Name + "”.";
    }

    /// <summary>
    /// The X on a saved-request row. This one does ask: a saved request is
    /// something somebody built and named, not a scratch value, and there is
    /// no undo for it.
    /// </summary>
    private void BtnKillSaved_Click(object sender, RoutedEventArgs e)
    {
        if (sender is not FrameworkElement { Tag: SavedRequest r }) return;

        if (MessageBox.Show(this, "Delete the saved request “" + r.Name + "”?",
                "Fishbowl API Tool", MessageBoxButton.YesNo, MessageBoxImage.Question,
                MessageBoxResult.No) != MessageBoxResult.Yes) return;

        _saved.Clear();
        foreach (var x in SavedRequests.Remove(r.Id)) _saved.Add(x);
        TxtStatus.Text = "Deleted “" + r.Name + "”.";
    }

    /// <summary>A one-line input. WPF ships no InputBox and a dialog class for this is overkill.</summary>
    public string? Prompt(string title, string label, string initial)
    {
        var box = new TextBox { Text = initial, Margin = new Thickness(0, 8, 0, 14), Padding = new Thickness(7, 5, 7, 5) };
        var ok = new Button { Content = "Save", IsDefault = true, MinWidth = 88, Style = (Style)FindResource("Primary") };
        var cancel = new Button { Content = "Cancel", IsCancel = true, MinWidth = 88, Margin = new Thickness(0, 0, 8, 0) };

        var buttons = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right };
        buttons.Children.Add(cancel);
        buttons.Children.Add(ok);

        var panel = new StackPanel { Margin = new Thickness(18) };
        panel.Children.Add(new TextBlock { Text = label, TextWrapping = TextWrapping.Wrap, FontSize = 13 });
        panel.Children.Add(box);
        panel.Children.Add(buttons);

        var win = new Window
        {
            Title = title, Content = panel, Width = 430, SizeToContent = SizeToContent.Height,
            WindowStartupLocation = WindowStartupLocation.CenterOwner, Owner = this,
            ResizeMode = ResizeMode.NoResize, ShowInTaskbar = false, Icon = Icon,
        };
        ok.Click += (_, _) => win.DialogResult = true;
        win.Loaded += (_, _) => { box.Focus(); box.SelectAll(); };

        return win.ShowDialog() == true ? box.Text.Trim() : null;
    }

    // ── THE DATA TAB ────────────────────────────────────────────────────
    // The query endpoint, promoted. It hosts a real RequestView rather than a
    // second SQL UI: the editor, the kept results and the comparison view all
    // already live there, and two copies would drift apart within a week.

    private RequestView? _dataView;

    private void ShowDataTab()
    {
        if (_dataView is not null) { RefreshSchemaTree(); return; }

        var ep = _catalog.Endpoints.FirstOrDefault(e => e.Path.EndsWith("/data-query", StringComparison.OrdinalIgnoreCase)
                                                     && e.Method == "GET");
        if (ep is null)
        {
            DataHost.Children.Add(new TextBlock
            {
                Text = "This catalog has no data-query endpoint, so there is nothing to run here.",
                TextWrapping = TextWrapping.Wrap, Margin = new Thickness(24), FontSize = 14,
                Foreground = (Brush)FindResource("FbTextSub"),
            });
            return;
        }

        _dataView = new RequestView(Context, ep);
        DataHost.Children.Add(_dataView);

        _ = LoadSchemaAsync(force: false).ContinueWith(_ => Dispatcher.Invoke(RefreshSchemaTree),
                                                       TaskScheduler.Default);
    }

    private void RefreshSchemaTree()
    {
        var groups = SchemaBrowser.Build(_schema, TxtSchemaFilter.Text);
        TreeSchema.ItemsSource = groups;
        TxtSchemaInfo.Text = SchemaBrowser.Describe(_schema, groups);
    }

    private void TxtSchemaFilter_TextChanged(object sender, TextChangedEventArgs e) => RefreshSchemaTree();

    private async void BtnSchemaRefresh_Click(object sender, RoutedEventArgs e)
    {
        if (string.IsNullOrEmpty(_token))
        {
            TxtStatus.Text = "Connect first — the schema is read from the server.";
            return;
        }

        BtnSchemaRefresh.IsEnabled = false;
        BtnSchemaRefresh.Content = "Reading…";
        try
        {
            // force: the cache is exactly what needs bypassing here.
            if (await LoadSchemaAsync(force: true) is null)
                TxtStatus.Text = "Could not read the schema. Does this account have data-query access?";
            RefreshSchemaTree();
        }
        finally
        {
            BtnSchemaRefresh.IsEnabled = true;
            BtnSchemaRefresh.Content = "Refresh";
        }
    }

    /// <summary>
    /// Put the double-clicked name into the editor.
    ///
    /// A column arrives qualified — <c>soitem.qtyOrdered</c> — because that is
    /// what a join needs and dropping the qualifier is the easier edit of the
    /// two.
    /// </summary>
    private void TreeSchema_DoubleClick(object sender, MouseButtonEventArgs e)
    {
        if (_dataView is null) return;

        var text = TreeSchema.SelectedItem switch
        {
            TableNode t => t.Insert,
            ColumnNode c => c.Insert,
            _ => null,
        };
        if (text is null) return;

        _dataView.InsertSql(text);
        TxtStatus.Text = "Inserted " + text + ".";
    }
}
