using Avalonia;
using System.Collections.ObjectModel;
using Avalonia.Controls;

namespace FbApiTool.Ui;

/// <summary>One entry in the list down the left.</summary>
public sealed record SettingsGroup(string Key, string Glyph, string Title, string Hint, string Blurb);

/// <summary>
/// Every setting, in one window.
///
/// It used to be two — a Servers window reached from the toolbar and a
/// preferences window reached from a menu — which meant the answer to "where
/// do I change that?" depended on which thing you wanted. One window with the
/// groups down the left has room for the next one too.
///
/// The catalog review happens on its own page here rather than in a second
/// modal on top of this one, for the same reason.
/// </summary>
public partial class SettingsWindow : Window
{
    private readonly ObservableCollection<ServerProfile> _profiles;
    private readonly Func<string, string?> _get;
    private readonly Action<string, string> _set;

    /// <summary>Set while the window is filling its own fields in.</summary>
    private bool _loading;

    /// <summary>The profile left selected, so the window can follow it.</summary>
    public ServerProfile? Selected { get; private set; }

    /// <summary>The tour was asked for.</summary>
    public bool StartTour { get; private set; }

    /// <summary>The documentation tab was asked for.</summary>
    public bool ShowDocs { get; private set; }

    /// <summary>Fetch this server's /apidocs.json and diff it against what we ship.</summary>
    public Func<Task<CatalogDiffResult?>>? CheckCatalog { get; set; }

    /// <summary>Apply the ticked changes; returns what to tell the user.</summary>
    public Func<CatalogDiffResult, string>? ApplyCatalog { get; set; }

    private CatalogDiffResult? _diff;

    private static readonly SettingsGroup[] Groups =
    [
        new("servers", "\U0001F5A7", "Servers", "Addresses and app identity",
            "Each one keeps its own address and integrated-app identity. Mark the ones holding real data as production."),
        new("look", "◑", "Appearance", "Light, dark, or the system's",
            "How the window is coloured. The palette is Fishbowl's own; only which end of it is used changes."),
        new("requests", "⇄", "Requests", "Responses, results, row limits",
            "How a response is shown when it arrives, and what is kept afterwards."),
        new("session", "⏻", "Session", "Signing out, seat licences",
            "A signed-in session holds a Fishbowl seat licence, so the tool can let go of it on its own."),
        new("catalog", "⟳", "Endpoint catalog", "Where the UI comes from",
            "The sidebar, the forms and the body templates are generated from a catalog, and the catalog comes from the server's own /apidocs.json."),
        new("help", "?", "Help and tips", "The guided tour, the guides",
            "Where to find the built-in documentation, and the tour that points at things."),
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

        TxtBuild.Text = BuildInfo.Date + "  ·  " + BuildInfo.Hash;
        TxtBuildLong.Text = BuildInfo.Long;
        TxtAbout.Text = about;
        TxtCatHead.Text = "Built against Fishbowl Advanced API v" + catalogVersion;
        TxtCatSub.Text = "Check to compare it with what this server publishes.";

        TxtCreds.Text = CredentialStore.Available
            ? "Remembered passwords are held by the Windows Credential Manager, never by this tool, and only "
            + "after the server has accepted them."
            : "This platform has no credential store the tool can use, so a password is never remembered here. "
            + "It is asked for each time you sign in.";

        foreach (var name in new[] { "Auto", "Pretty", "Table", "Raw" }) CmbView.Items.Add(name);

        LstProfiles.ItemsSource = _profiles;
        LstProfiles.SelectionChanged += (_, _) => ShowProfile();
        LstProfiles.SelectedItem = current ?? _profiles.FirstOrDefault();

        LoadPreferences();
        WireEvents();

        LstGroups.ItemsSource = Groups;
        LstGroups.SelectionChanged += (_, _) => ShowGroup();
        LstGroups.SelectedItem = Groups.FirstOrDefault(g => g.Key == startOn) ?? Groups[0];
    }

    // ── GROUPS ──────────────────────────────────────────────────────────

    private void ShowGroup()
    {
        if (LstGroups.SelectedItem is not SettingsGroup g) return;

        TxtGroupTitle.Text = g.Title;
        TxtGroupBlurb.Text = g.Blurb;

        PageServers.IsVisible = g.Key == "servers";
        PageLook.IsVisible = g.Key == "look";
        PageRequests.IsVisible = g.Key == "requests";
        PageSession.IsVisible = g.Key == "session";
        PageCatalog.IsVisible = g.Key == "catalog";
        PageHelp.IsVisible = g.Key == "help";

        // Add / Duplicate / Remove belong to one page, so they travel with it
        // rather than sitting greyed out on the others.
        ServerButtons.IsVisible = g.Key == "servers";
    }

    // ── PREFERENCES ─────────────────────────────────────────────────────

    private void LoadPreferences()
    {
        _loading = true;

        CmbView.SelectedItem = _get(Prefs.DefaultView) ?? "Auto";
        ChkKeep.IsChecked = _get(Prefs.KeepResults) != "0";
        ChkIdle.IsChecked = Prefs.IdleEnabledOr(_get);
        TxtIdleMins.Text = Prefs.IdleMinutes(_get).ToString();
        TxtGraceSecs.Text = Prefs.GraceSeconds(_get).ToString();
        ChkLimitRows.IsChecked = Prefs.RowLimitOnOr(_get);
        TxtRowLimit.Text = Prefs.RowLimit(_get).ToString();
        ChkTips.IsChecked = Prefs.TourPending(_get);

        var theme = Prefs.ThemeOr(_get);
        ThemeLight.IsChecked = theme == "light";
        ThemeDark.IsChecked = theme == "dark";
        ThemeSystem.IsChecked = theme is not ("light" or "dark");

        _loading = false;
    }

    private void SavePreferences()
    {
        if (_loading) return;

        if (CmbView.SelectedItem is string v) _set(Prefs.DefaultView, v);
        _set(Prefs.KeepResults, ChkKeep.IsChecked == true ? "1" : "0");
        _set(Prefs.IdleEnabled, ChkIdle.IsChecked == true ? "1" : "0");
        _set(Prefs.RowLimitOn, ChkLimitRows.IsChecked == true ? "1" : "0");

        // Typed digits only, clamped. A half-typed number is not an instruction
        // to change anything, and a stored 0 would sign out the moment the
        // mouse stopped or return no rows at all.
        if (int.TryParse((TxtIdleMins.Text ?? "").Trim(), out var mins) && mins is >= 1 and <= 720)
            _set(Prefs.IdleMinutes_, mins.ToString());
        if (int.TryParse((TxtGraceSecs.Text ?? "").Trim(), out var secs) && secs is >= 10 and <= 900)
            _set(Prefs.GraceSeconds_, secs.ToString());
        if (int.TryParse((TxtRowLimit.Text ?? "").Trim(), out var rows) && rows >= 1)
            _set(Prefs.RowLimit_, rows.ToString());

        // Ticking the box is a request to see the tour again, so the
        // already-seen mark has to come off or nothing would happen at the
        // next start.
        _set(Prefs.TipsDone, ChkTips.IsChecked == true ? "0" : "1");
    }

    private void WireEvents()
    {
        CmbView.SelectionChanged += (_, _) => SavePreferences();
        foreach (var box in new[] { ChkKeep, ChkIdle, ChkLimitRows, ChkTips })
            box.IsCheckedChanged += (_, _) => SavePreferences();

        // Applied as it is clicked rather than on the way out: this is the one
        // setting whose effect you are looking at while you choose it.
        foreach (var (button, value) in new[]
                 {
                     (ThemeSystem, "system"), (ThemeLight, "light"), (ThemeDark, "dark"),
                 })
        {
            var chosen = value;
            button.IsCheckedChanged += (_, _) =>
            {
                if (_loading || button.IsChecked != true) return;
                _set(Prefs.Theme, chosen);
                Theming.Apply(chosen);
            };
        }
        foreach (var box in new[] { TxtIdleMins, TxtGraceSecs, TxtRowLimit })
            Watch(box, SavePreferences);

        foreach (var box in new[] { TxtName, TxtUser, TxtAppName, TxtAppId })
            Watch(box, ApplyProfileEdits);
        Watch(TxtUrl, () => { ApplyProfileEdits(); CheckUrl(); });
        ChkProd.IsCheckedChanged += (_, _) => ApplyProfileEdits();

        BtnAdd.Click += (_, _) => AddProfile(new ServerProfile { Name = "New server" });
        BtnCopyProfile.Click += (_, _) => DuplicateProfile();
        BtnRemove.Click += async (_, _) => await RemoveProfileAsync();

        BtnCheck.Click += async (_, _) => await CheckAsync();
        BtnAll.Click += (_, _) => SetAll(true);
        BtnNone.Click += (_, _) => SetAll(false);
        BtnOnlyNew.Click += (_, _) => Only(ChangeKind.Added);
        BtnOnlyGone.Click += (_, _) => Only(ChangeKind.MissingFromServer);
        BtnApply.Click += async (_, _) => await ApplyAsync();

        BtnTour.Click += (_, _) => { StartTour = true; Close(); };
        BtnDocs.Click += (_, _) => { ShowDocs = true; Close(); };
        BtnReset.Click += async (_, _) => await ResetAsync();
        BtnDone.Click += (_, _) => Close();
    }

    // ── SERVERS ─────────────────────────────────────────────────────────

    private ServerProfile? Current => LstProfiles.SelectedItem as ServerProfile;

    private void ShowProfile()
    {
        Editor.IsEnabled = Current is not null;
        Selected = Current;
        if (Current is not { } p) return;

        _loading = true;
        TxtName.Text = p.Name;
        TxtUrl.Text = p.BaseUrl;
        TxtUser.Text = p.Username ?? "";
        TxtAppName.Text = p.AppName;
        TxtAppId.Text = p.AppId.ToString();
        ChkProd.IsChecked = p.IsProduction;
        _loading = false;

        CheckUrl();
    }

    private void ApplyProfileEdits()
    {
        if (_loading || Current is not { } p) return;

        p.Name = (TxtName.Text ?? "").Trim();
        p.BaseUrl = (TxtUrl.Text ?? "").Trim();
        p.Username = string.IsNullOrWhiteSpace(TxtUser.Text) ? null : TxtUser.Text!.Trim();
        p.AppName = (TxtAppName.Text ?? "").Trim();
        if (int.TryParse((TxtAppId.Text ?? "").Trim(), out var id)) p.AppId = id;
        p.IsProduction = ChkProd.IsChecked == true;

        // The list shows the name and the address, so it has to be told the
        // record it is already holding has changed underneath it.
        var keep = LstProfiles.SelectedItem;
        LstProfiles.ItemsSource = null;
        LstProfiles.ItemsSource = _profiles;
        LstProfiles.SelectedItem = keep;
    }

    /// <summary>
    /// Say something when the address looks wrong, rather than after a failed
    /// connection. 2456 is the REST port; the desktop client's own port is a
    /// different one and typing it here is the usual first mistake.
    /// </summary>
    private void CheckUrl()
    {
        var url = (TxtUrl.Text ?? "").Trim();

        TxtUrlNote.Text =
            url.Length == 0 ? "An address is needed before this server can be used."
            : !Uri.TryCreate(url, UriKind.Absolute, out var uri) ? "That is not a complete address — it needs http:// in front."
            : uri.Scheme is not ("http" or "https") ? "Only http and https addresses work here."
            : uri.IsDefaultPort && uri.Scheme == "http" ? "No port given, so port 80 is assumed. Fishbowl's REST port is usually 2456."
            : "";
    }

    private void AddProfile(ServerProfile p)
    {
        _profiles.Add(p);
        LstProfiles.SelectedItem = p;
    }

    private void DuplicateProfile()
    {
        if (Current is not { } p) return;

        // A new Id, so the copy is a separate server rather than the same one
        // twice — the Id is what remembers which profile was last connected.
        AddProfile(new ServerProfile
        {
            Name = p.Name + " copy",
            BaseUrl = p.BaseUrl,
            Username = p.Username,
            AppName = p.AppName,
            AppId = p.AppId,
            IsProduction = p.IsProduction,
        });
    }

    private async Task RemoveProfileAsync()
    {
        if (Current is not { } p) return;

        if (_profiles.Count == 1)
        {
            await Dialogs.TellAsync(this, "Servers",
                "This is the only server left. Add another before removing this one.");
            return;
        }

        if (!await Dialogs.ConfirmAsync(this, "Remove server",
                "Remove “" + p.Name + "”?\n\nAny password remembered for it stays in the "
                + "Windows Credential Manager until it is removed there.",
                "Remove", "Keep it"))
            return;

        _profiles.Remove(p);
        LstProfiles.SelectedItem = _profiles.FirstOrDefault();
    }

    // ── CATALOG ─────────────────────────────────────────────────────────

    private async Task CheckAsync()
    {
        if (CheckCatalog is null) return;

        BtnCheck.IsEnabled = false;
        BtnCheck.Content = "Checking…";
        TxtCatNote.Text = "";

        try
        {
            _diff = await CheckCatalog();

            if (_diff is null)
            {
                TxtCatNote.Text = "Could not read /apidocs.json from that server. Check the address, "
                                + "and that the server is running.";
                ShowChanges(null);
                return;
            }

            ShowChanges(_diff);
        }
        catch (Exception ex)
        {
            TxtCatNote.Text = "That check failed: " + ex.Message;
            ShowChanges(null);
        }
        finally
        {
            BtnCheck.IsEnabled = true;
            BtnCheck.Content = "Check for updates";
        }
    }

    private void ShowChanges(CatalogDiffResult? diff)
    {
        LstChanges.ItemsSource = diff?.Changes;
        CatActions.IsVisible = diff is { Changes.Count: > 0 };

        if (diff is null) return;

        TxtCatHead.Text = "This server publishes v" + diff.IncomingVersion
                        + "; the catalog here is v" + diff.CurrentVersion + ".";

        if (diff.Changes.Count == 0)
        {
            TxtCatSub.Text = "Nothing to change — the catalog already matches this server.";
            return;
        }

        TxtCatSub.Text = diff.Changes.Count + " difference(s). Tick the ones to take, then Apply.";

        // The count has to follow the ticks. Apply is a bindable property on
        // each row, so the only way to hear a click on one is to listen to the
        // row itself — the ListBox never sees it.
        foreach (var c in diff.Changes) c.PropertyChanged += (_, _) => CountChanges();

        CountChanges();
    }

    /// <summary>
    /// What Apply would actually do, broken out by kind.
    ///
    /// "3 selected" does not distinguish taking three new endpoints from
    /// deleting three, and those are very different presses.
    /// </summary>
    private void CountChanges()
    {
        var on = _diff?.Changes.Where(c => c.Apply).ToList() ?? [];

        var added = on.Count(c => c.Kind == ChangeKind.Added);
        var changed = on.Count(c => c.Kind == ChangeKind.Changed);
        var gone = on.Count(c => c.Kind == ChangeKind.MissingFromServer);

        var bits = new List<string>();
        if (added > 0) bits.Add(added + " to add");
        if (changed > 0) bits.Add(changed + " to update");
        if (gone > 0) bits.Add(gone + " to remove");

        TxtCount.Text = bits.Count == 0 ? "nothing ticked" : string.Join("  ·  ", bits);
        BtnApply.Content = on.Count == 0 ? "Apply" : "Apply " + on.Count;
        BtnApply.IsEnabled = on.Count > 0;
    }

    private void SetAll(bool on)
    {
        if (_diff is null) return;
        foreach (var c in _diff.Changes) c.Apply = on;
        CountChanges();
    }

    /// <summary>
    /// Tick exactly one kind of change and nothing else.
    ///
    /// Additions are the safe subset — taking an endpoint this server has
    /// cannot change a form that already works — whereas removals take
    /// endpoints out of the sidebar, so they are worth being able to select as
    /// a group and look at before pressing anything.
    /// </summary>
    private void Only(ChangeKind kind)
    {
        if (_diff is null) return;
        foreach (var c in _diff.Changes) c.Apply = c.Kind == kind;
        CountChanges();
    }

    private async Task ApplyAsync()
    {
        if (_diff is null || ApplyCatalog is null) return;

        var n = _diff.Changes.Count(c => c.Apply);
        if (n == 0)
        {
            await Dialogs.TellAsync(this, "Endpoint catalog", "Nothing is ticked, so nothing would change.");
            return;
        }

        // Removing is the one direction that loses something. An endpoint this
        // server does not document may still be a curated entry that works, or
        // one a newer server will have again, so it gets named before it goes.
        var gone = _diff.Changes.Where(c => c.Apply && c.Kind == ChangeKind.MissingFromServer).ToList();
        if (gone.Count > 0 &&
            !await Dialogs.ConfirmAsync(this, "Remove from the catalog",
                "These " + gone.Count + " endpoint(s) will be taken out of the sidebar:\n\n  "
                + string.Join("\n  ", gone.Select(c => c.Header))
                + "\n\nThey are gone from the catalog, not from the server. Checking again against a "
                + "server that does document them puts them back.",
                "Remove them", "Cancel"))
            return;

        var message = ApplyCatalog(_diff);
        _diff = null;
        ShowChanges(null);

        await Dialogs.TellAsync(this, "Endpoint catalog", message);
    }

    // ── RESET ───────────────────────────────────────────────────────────

    private async Task ResetAsync()
    {
        if (!await Dialogs.ConfirmAsync(this, "Forget saved settings",
                "Put the preferences on this page back to how they started, and offer the tour again?"
                + "\n\nServers, variables and saved requests are left alone.",
                "Forget them", "Cancel"))
            return;

        foreach (var key in new[]
                 {
                     Prefs.DefaultView, Prefs.KeepResults, Prefs.IdleEnabled, Prefs.IdleMinutes_,
                     Prefs.GraceSeconds_, Prefs.RowLimitOn, Prefs.RowLimit_, Prefs.TipsDone,
                 })
            _set(key, "");

        LoadPreferences();
    }

    // ── SMALL THINGS ────────────────────────────────────────────────────

    private static void Watch(TextBox box, Action then) =>
        box.GetObservable(TextBox.TextProperty).Subscribe(new Sink(then));

    private sealed class Sink(Action then) : IObserver<string?>
    {
        public void OnNext(string? value) => then();
        public void OnCompleted() { }
        public void OnError(Exception error) { }
    }
}
