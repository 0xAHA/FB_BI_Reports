using System.Collections.ObjectModel;
using System.Windows;
using System.Windows.Controls;

namespace FbApiTool;

/// <summary>One entry in the list down the left.</summary>
public sealed record SettingsGroup(string Key, string Glyph, string Title, string Hint, string Blurb);

/// <summary>
/// Every preference in one place, grouped down the left.
///
/// The servers editor used to be its own window reached from its own button,
/// which meant a tool with exactly one settings screen that did not contain
/// most of the settings. Grouping them costs nothing now and leaves somewhere
/// obvious to put the next one.
///
/// Preferences apply as they are changed. There is no Save button because
/// there is nothing to abandon — every value here is a preference, not an
/// edit, and Done just closes the window.
/// </summary>
public partial class SettingsWindow : Window
{
    private readonly ObservableCollection<ServerProfile> _profiles;
    private readonly Func<string, string?> _get;
    private readonly Action<string, string> _set;
    private bool _loading;

    /// <summary>The profile to select on the way out.</summary>
    public ServerProfile? Selected { get; private set; }

    /// <summary>Set when the user asked for the tour, so the caller can run it.</summary>
    public bool StartTour { get; private set; }

    /// <summary>Set when the user asked to see the documentation.</summary>
    public bool ShowDocs { get; private set; }

    /// <summary>
    /// Asks the server what it documents and returns the difference, or null
    /// if the check could not run. Supplied by the host, which owns the
    /// connection and the catalog.
    /// </summary>
    public Func<Task<CatalogDiffResult?>>? CheckCatalog { get; set; }

    /// <summary>Applies the ticked changes and reports what to say about it.</summary>
    public Func<CatalogDiffResult, string>? ApplyCatalog { get; set; }

    private CatalogDiffResult? _diff;

    private static readonly SettingsGroup[] Groups =
    [
        new("servers",  "🖧", "Servers",       "Addresses and app identity",  "Each one keeps its own address and integrated-app identity. Mark the ones holding real data as production."),
        new("requests", "⇄", "Requests",       "Responses and saved results", "How a response is shown when it arrives, and what is kept afterwards."),
        new("session",  "⏻", "Session",        "Signing out, seat licences",  "A signed-in session holds a Fishbowl seat licence, so the tool can let go of it on its own."),
        new("catalog",  "⟳", "Endpoint catalog", "Where the UI comes from",   "The sidebar, the forms and the body templates are generated from a catalog, and the catalog comes from the server's own /apidocs.json."),
        new("help",     "?", "Help and tips",  "The guided tour, the guides", "Where to find the built-in documentation, and the tour that points at things."),
    ];

    public SettingsWindow(ObservableCollection<ServerProfile> profiles,
                          ServerProfile? current,
                          Func<string, string?> get,
                          Action<string, string> set,
                          string about,
                          string catalogVersion,
                          string startOn = "servers")
    {
        InitializeComponent();

        _profiles = profiles;
        _get = get;
        _set = set;

        TxtBuild.Text = BuildInfo.Date + " · " + BuildInfo.Hash;
        TxtBuildLong.Text = BuildInfo.Long;
        TxtAbout.Text = about;
        TxtCatHead.Text = "Built against Fishbowl Advanced API v" + catalogVersion;
        TxtCatSub.Text = "Check to compare it with what this server publishes.";

        LstProfiles.ItemsSource = _profiles;
        LstProfiles.SelectedItem = current ?? _profiles.FirstOrDefault();

        LoadPreferences();

        LstGroups.ItemsSource = Groups;
        LstGroups.SelectedItem = Groups.FirstOrDefault(g => g.Key == startOn) ?? Groups[0];
    }

    // ── GROUPS ──────────────────────────────────────────────────────────

    private void LstGroups_Changed(object sender, SelectionChangedEventArgs e)
    {
        if (LstGroups.SelectedItem is not SettingsGroup g) return;

        PageServers.Visibility = g.Key == "servers" ? Visibility.Visible : Visibility.Collapsed;
        PageRequests.Visibility = g.Key == "requests" ? Visibility.Visible : Visibility.Collapsed;
        PageSession.Visibility = g.Key == "session" ? Visibility.Visible : Visibility.Collapsed;
        PageCatalog.Visibility = g.Key == "catalog" ? Visibility.Visible : Visibility.Collapsed;
        PageHelp.Visibility = g.Key == "help" ? Visibility.Visible : Visibility.Collapsed;

        // Add/Duplicate/Remove act on servers, so they only belong to that page.
        ServerButtons.Visibility = g.Key == "servers" ? Visibility.Visible : Visibility.Collapsed;

        TxtGroupBlurb.Text = g.Blurb;
    }

    // ── PREFERENCES ─────────────────────────────────────────────────────

    private void LoadPreferences()
    {
        _loading = true;

        var view = _get(Prefs.DefaultView) ?? "Auto";
        CmbView.SelectedItem = CmbView.Items.Cast<ComboBoxItem>()
            .FirstOrDefault(i => (string)i.Tag == view) ?? CmbView.Items[0];

        ChkKeep.IsChecked = _get(Prefs.KeepResults) != "0";
        ChkIdle.IsChecked = _get(Prefs.IdleEnabled) != "0";
        TxtIdleMins.Text = Prefs.IdleMinutes(_get).ToString();
        TxtGraceSecs.Text = Prefs.GraceSeconds(_get).ToString();
        ChkTips.IsChecked = _get(Prefs.TipsDone) != "1";

        _loading = false;
    }

    private void Pref_Changed(object sender, RoutedEventArgs e)
    {
        if (_loading) return;

        if (CmbView.SelectedItem is ComboBoxItem { Tag: string v }) _set(Prefs.DefaultView, v);
        _set(Prefs.KeepResults, ChkKeep.IsChecked == true ? "1" : "0");
        _set(Prefs.IdleEnabled, ChkIdle.IsChecked == true ? "1" : "0");

        // Typed digits only; a half-typed number is not an instruction to
        // change anything, and clamping stops a zero turning into a sign-out
        // the moment the mouse stops moving.
        if (int.TryParse(TxtIdleMins.Text.Trim(), out var mins) && mins is >= 1 and <= 720)
            _set(Prefs.IdleMinutes_, mins.ToString());
        if (int.TryParse(TxtGraceSecs.Text.Trim(), out var secs) && secs is >= 10 and <= 900)
            _set(Prefs.GraceSeconds_, secs.ToString());

        // Ticking the box is a request to see it again, so the "already seen"
        // mark has to come off or nothing would happen at the next start.
        _set(Prefs.TipsDone, ChkTips.IsChecked == true ? "0" : "1");
    }

    private void Pref_Changed(object sender, TextChangedEventArgs e) => Pref_Changed(sender, (RoutedEventArgs)e);

    // ── CATALOG ─────────────────────────────────────────────────────────

    /// <summary>
    /// The review happens here rather than in a window of its own.
    ///
    /// It used to open a second modal on top of this one, which meant the
    /// answer to "is my catalog current?" lived somewhere you could only reach
    /// by pressing a button on the title bar and then waiting.
    /// </summary>
    private async void BtnCheck_Click(object sender, RoutedEventArgs e)
    {
        if (CheckCatalog is null) return;

        BtnCheck.IsEnabled = false;
        BtnCheck.Content = "Checking…";
        ShowChanges(null);
        TxtCatSub.Text = "Reading this server's documentation…";

        try
        {
            _diff = await CheckCatalog();

            if (_diff is null)
            {
                TxtCatHead.Text = "Could not reach the server";
                TxtCatSub.Text = "Connect first, then check again.";
                return;
            }

            if (!_diff.HasWork)
            {
                TxtCatHead.Text = "Up to date with v" + _diff.IncomingVersion;
                TxtCatSub.Text = _diff.MissingCount > 0
                    ? _diff.MissingCount + " catalogued endpoint(s) are not in this server's documentation. " +
                      "That is normal — some are curated additions, and an older server documents less."
                    : "The catalog matches what this server publishes.";
                return;
            }

            TxtCatHead.Text = _diff.VersionDiffers
                ? "This server documents v" + _diff.IncomingVersion +
                  " — the catalog is built for v" + _diff.CurrentVersion
                : "Changes found in v" + _diff.IncomingVersion;

            TxtCatSub.Text = _diff.Summary +
                (_diff.VersionDiffers
                    ? ". Review what would change and apply as much or as little as you want."
                    : ". The version matches, but the documented shapes have moved.");

            ShowChanges(_diff);
        }
        catch (Exception ex)
        {
            TxtCatHead.Text = "The check failed";
            TxtCatSub.Text = ex.Message;
        }
        finally
        {
            BtnCheck.IsEnabled = true;
            BtnCheck.Content = "Check again";
        }
    }

    private void ShowChanges(CatalogDiffResult? diff)
    {
        LstChanges.ItemsSource = diff?.Changes;
        var any = diff is { HasWork: true };

        CatActions.Visibility = any ? Visibility.Visible : Visibility.Collapsed;
        BtnApply.Visibility = any ? Visibility.Visible : Visibility.Collapsed;

        if (diff is null) return;
        foreach (var c in diff.Changes) c.PropertyChanged += (_, _) => CountChanges();
        CountChanges();
    }

    private void CountChanges()
    {
        if (_diff is null) return;
        var n = _diff.Changes.Count(c => c.Apply);
        TxtCount.Text = n + " of " + _diff.Changes.Count + " selected";
        BtnApply.Content = n == 0 ? "Apply nothing" : "Apply " + n + " change" + (n == 1 ? "" : "s");
        BtnApply.IsEnabled = n > 0;
    }

    private void BtnAll_Click(object sender, RoutedEventArgs e)
    { if (_diff is not null) foreach (var c in _diff.Changes) c.Apply = true; }

    private void BtnNone_Click(object sender, RoutedEventArgs e)
    { if (_diff is not null) foreach (var c in _diff.Changes) c.Apply = false; }

    private void BtnOnlyNew_Click(object sender, RoutedEventArgs e)
    { if (_diff is not null) foreach (var c in _diff.Changes) c.Apply = c.Kind == ChangeKind.Added; }

    private void BtnApply_Click(object sender, RoutedEventArgs e)
    {
        if (_diff is null || ApplyCatalog is null) return;

        var removals = _diff.Changes.Count(c => c.Apply && c.Kind == ChangeKind.MissingFromServer);
        if (removals > 0)
        {
            var ok = MessageBox.Show(this,
                removals + " endpoint(s) would be REMOVED from the catalog because this server does not " +
                "document them.\n\nThat is usually not what you want: several catalogued endpoints are " +
                "curated additions, and an older server simply documents fewer of them.\n\nRemove them anyway?",
                "Remove endpoints?", MessageBoxButton.YesNo, MessageBoxImage.Warning, MessageBoxResult.No);
            if (ok != MessageBoxResult.Yes) return;
        }

        TxtCatHead.Text = "Applied";
        TxtCatSub.Text = ApplyCatalog(_diff);
        _diff = null;
        ShowChanges(null);
        BtnCheck.Content = "Check for updates";
    }

    private void BtnReset_Click(object sender, RoutedEventArgs e)
    {
        var ok = MessageBox.Show(this,
            "Discard every update applied so far and go back to the catalog this build shipped with?\n\n" +
            "Deletes:\n" + ApiCatalog.UserFile,
            "Reset the catalog", MessageBoxButton.YesNo, MessageBoxImage.Question, MessageBoxResult.No);
        if (ok != MessageBoxResult.Yes) return;

        try
        {
            ApiCatalog.ResetToShipped();
            _diff = null;
            ShowChanges(null);
            TxtCatHead.Text = "Reset";
            TxtCatSub.Text = "Restart the tool to load the catalog it shipped with.";
        }
        catch (Exception ex)
        {
            MessageBox.Show(this, "Could not reset: " + ex.Message,
                            "Fishbowl API Tool", MessageBoxButton.OK, MessageBoxImage.Error);
        }
    }

    private void BtnTour_Click(object sender, RoutedEventArgs e)
    {
        StartTour = true;
        Selected = LstProfiles.SelectedItem as ServerProfile;
        DialogResult = true;
    }

    private void BtnDocs_Click(object sender, RoutedEventArgs e)
    {
        ShowDocs = true;
        Selected = LstProfiles.SelectedItem as ServerProfile;
        DialogResult = true;
    }

    // ── SERVERS ─────────────────────────────────────────────────────────

    private ServerProfile? Current => LstProfiles.SelectedItem as ServerProfile;

    private void LstProfiles_Changed(object sender, SelectionChangedEventArgs e)
    {
        _loading = true;
        Editor.IsEnabled = Current is not null;

        if (Current is { } p)
        {
            TxtName.Text = p.Name;
            TxtUrl.Text = p.BaseUrl;
            TxtUser.Text = p.Username ?? "";
            TxtAppName.Text = p.AppName;
            TxtAppId.Text = p.AppId.ToString();
            ChkProd.IsChecked = p.IsProduction;
        }
        _loading = false;
        Selected = Current;
    }

    private void Field_Changed(object sender, RoutedEventArgs e) => Apply();

    private void Url_Changed(object sender, TextChangedEventArgs e)
    {
        if (_loading || Current is null) return;

        // Suggest the production flag from the address, once, while the profile
        // is still new. Never decide it: a hostname is not evidence, and a
        // sandbox called fishbowl-prod-copy would be flagged wrongly forever.
        var wasBlank = Current.BaseUrl.Length == 0 ||
                       Current.BaseUrl.Equals("http://localhost:2456", StringComparison.OrdinalIgnoreCase);
        Apply();

        if (wasBlank && ChkProd.IsChecked != true && Profiles.LooksLikeProduction(TxtUrl.Text))
            ChkProd.IsChecked = true;
    }

    private void Apply()
    {
        if (_loading || Current is not { } p) return;

        p.Name = TxtName.Text.Trim();
        p.BaseUrl = TxtUrl.Text.Trim().TrimEnd('/');
        p.Username = TxtUser.Text.Trim() is { Length: > 0 } u ? u : null;
        p.AppName = TxtAppName.Text.Trim() is { Length: > 0 } a ? a : "Fishbowl Advanced API Tool";
        if (int.TryParse(TxtAppId.Text.Trim(), out var id)) p.AppId = id;
        p.IsProduction = ChkProd.IsChecked == true;

        LstProfiles.Items.Refresh();
    }

    private void BtnAdd_Click(object sender, RoutedEventArgs e)
    {
        var p = new ServerProfile { Name = "New server" };
        _profiles.Add(p);
        LstProfiles.SelectedItem = p;
        TxtName.Focus();
        TxtName.SelectAll();
    }

    private void BtnCopy_Click(object sender, RoutedEventArgs e)
    {
        if (Current is not { } p) return;
        var copy = new ServerProfile
        {
            Name = p.Name + " copy",
            BaseUrl = p.BaseUrl,
            Username = p.Username,
            AppName = p.AppName,
            AppId = p.AppId,
            IsProduction = p.IsProduction,
        };
        _profiles.Add(copy);
        LstProfiles.SelectedItem = copy;
    }

    private void BtnRemove_Click(object sender, RoutedEventArgs e)
    {
        if (Current is not { } p) return;
        if (_profiles.Count == 1)
        {
            MessageBox.Show(this, "There has to be at least one server.", "Settings",
                            MessageBoxButton.OK, MessageBoxImage.Information);
            return;
        }
        if (MessageBox.Show(this, "Remove “" + p + "”?", "Settings",
                MessageBoxButton.YesNo, MessageBoxImage.Question, MessageBoxResult.No) != MessageBoxResult.Yes)
            return;

        _profiles.Remove(p);
        LstProfiles.SelectedItem = _profiles.FirstOrDefault();
    }

    private void BtnDone_Click(object sender, RoutedEventArgs e)
    {
        Apply();
        Selected = Current;
        DialogResult = true;
    }
}
