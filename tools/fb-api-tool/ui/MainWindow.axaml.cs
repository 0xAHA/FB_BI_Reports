using System.Collections.ObjectModel;
using Avalonia.Controls;

namespace FbApiTool.Ui;

/// <summary>
/// The shell: the endpoint tree on the left, request panes on the right, and
/// the Data and Documentation tabs beside them.
///
/// Everything it shows comes from FbApiTool.Core. This class arranges and
/// binds; it does not know what an endpoint is beyond what the catalog says.
/// </summary>
public partial class MainWindow : Window
{
    private readonly ApiCatalog _catalog;
    private readonly ObservableCollection<CategoryNode> _tree = [];

    public MainWindow()
    {
        InitializeComponent();

        try
        {
            _catalog = Assets.LoadCatalog();
        }
        catch (Exception ex)
        {
            _catalog = new ApiCatalog();
            TxtStatus.Text = "The endpoint catalog could not be read: " + ex.Message;
        }

        TreeEndpoints.ItemsSource = _tree;

        TxtBuiltFor.Text = "built against Fishbowl Advanced API v" +
                           (string.IsNullOrWhiteSpace(_catalog.Version) ? "?" : _catalog.Version);
        TxtDocsChip.Text = "catalog v" + (string.IsNullOrWhiteSpace(_catalog.Version) ? "?" : _catalog.Version);
        TxtVersion.Text = BuildInfo.Full;

        TxtSearch.TextChanged += (_, _) => BuildTree();
        TogGet.IsCheckedChanged += (_, _) => BuildTree();
        TogPost.IsCheckedChanged += (_, _) => BuildTree();
        TogDelete.IsCheckedChanged += (_, _) => BuildTree();

        BtnExpandAll.Click += (_, _) => SetAllExpanded(true);
        BtnCollapseAll.Click += (_, _) => SetAllExpanded(false);

        TreeEndpoints.SelectionChanged += Tree_SelectionChanged;

        LoadSettings();
        SetUpConnection();
        BuildTree();

        // After the window is up, not during construction: the connect dialog
        // needs an owner that has been shown.
        Opened += async (_, _) => await ShowConnectAsync(firstRun: true);
    }

    // ── SETTINGS ────────────────────────────────────────────────────────

    private readonly string _settingsFile =
        System.IO.Path.Combine(ApiCatalog.DataDir, "settings.json");

    private System.Text.Json.Nodes.JsonObject _settings = new();

    private string? Get(string k) => _settings[k]?.GetValue<string>();

    private void Set(string k, string v)
    {
        _settings[k] = v;
        try
        {
            System.IO.Directory.CreateDirectory(ApiCatalog.DataDir);
            System.IO.File.WriteAllText(_settingsFile,
                _settings.ToJsonString(new System.Text.Json.JsonSerializerOptions { WriteIndented = true }));
        }
        catch { /* a tool must not fall over because it cannot persist a preference */ }
    }

    private void LoadSettings()
    {
        try
        {
            if (System.IO.File.Exists(_settingsFile))
                _settings = System.Text.Json.Nodes.JsonNode.Parse(
                    System.IO.File.ReadAllText(_settingsFile))?.AsObject() ?? new();
        }
        catch { _settings = new(); }
    }

    /// <summary>
    /// Every open pane follows a change of connection: the URL it would send
    /// to, and the access-right chip, which answers a question about whoever
    /// is signed in now.
    /// </summary>
    private void RefreshOpenPanes()
    {
        // Nothing to refresh yet — the request pane is the next thing to port.
    }

    // ── SIDEBAR ─────────────────────────────────────────────────────────

    /// <summary>
    /// Rebuild the tree for the current filter.
    ///
    /// A search is a request to see what matched, so everything opens;
    /// otherwise whatever the user had open stays open.
    /// </summary>
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
            cat.IsExpanded = term.Length > 0 || open.Contains(group.Key);
            _tree.Add(cat);
        }

        TxtStatus.Text = term.Length > 0
            ? _tree.Sum(c => c.Endpoints.Count) + " endpoint(s) match “" + term + "”"
            : _catalog.Endpoints.Count + " endpoints in " + _tree.Count + " categories";
    }

    private static bool Matches(ApiEndpoint e, string term) =>
        term.Length == 0
        || e.Name.Contains(term, StringComparison.OrdinalIgnoreCase)
        || e.Path.Contains(term, StringComparison.OrdinalIgnoreCase)
        || e.Category.Contains(term, StringComparison.OrdinalIgnoreCase)
        || e.Description.Contains(term, StringComparison.OrdinalIgnoreCase);

    private void SetAllExpanded(bool open)
    {
        foreach (var c in _tree) c.IsExpanded = open;
    }

    private void Tree_SelectionChanged(object? sender, SelectionChangedEventArgs e)
    {
        if (TreeEndpoints.SelectedItem is EndpointNode n) TxtStatus.Text = n.Summary;
    }
}
