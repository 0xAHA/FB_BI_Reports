using Avalonia.Input;
using Avalonia.Interactivity;
using Avalonia.Threading;

namespace FbApiTool.Ui;

/// <summary>
/// The settings window, the catalog update it hosts, and the idle watch it
/// configures.
/// </summary>
public partial class MainWindow
{
    private void SetUpSettings()
    {
        BtnSettings.Click += async (_, _) => await OpenSettingsAsync();
        StartIdleWatch();

        // The endpoint tree colours its verb pills through a converter on a
        // binding, and a binding only re-runs when its SOURCE changes — the
        // theme is not the source, so those pills kept the palette they were
        // built with. Rebuilding the tree is cheap and is the honest fix.
        ActualThemeVariantChanged += (_, _) =>
        {
            Log.Info("theme is now " + ActualThemeVariant);
            BuildTree();
        };
    }

    /// <summary>
    /// Open the one settings window.
    ///
    /// Everything it changed is applied on the way out rather than as it is
    /// typed: half of it only matters once, and re-reading the lot when the
    /// window closes is both simpler and impossible to get half-applied.
    /// </summary>
    private async Task OpenSettingsAsync(string startOn = "servers")
    {
        var dlg = new SettingsWindow(_profiles, CurrentProfile, Get, Set, About(),
                                     string.IsNullOrWhiteSpace(_catalog.Version) ? "?" : _catalog.Version,
                                     startOn)
        {
            CheckCatalog = FetchDiffAsync,
            ApplyCatalog = ApplyDiff,
        };

        await dlg.ShowDialog(this);

        Profiles.Save(_profiles);

        // The combo holds the same objects the window just edited, so it has to
        // be told they changed underneath it.
        var keep = dlg.Selected ?? CurrentProfile;
        CmbProfile.ItemsSource = null;
        CmbProfile.ItemsSource = _profiles;
        CmbProfile.SelectedItem = keep ?? _profiles.FirstOrDefault();

        ApplyProfile();
        ApplyIdlePrefs();

        if (dlg.ShowDocs) Shell.SelectedItem = TabDocs;
        if (dlg.StartTour) StartTour();
    }

    private string About() =>
        "Catalog built against Fishbowl Advanced API v"
        + (string.IsNullOrWhiteSpace(_catalog.Version) ? "?" : _catalog.Version)
        + ", " + _catalog.Endpoints.Count + " endpoints."
        + "\nSettings and kept results live in " + ApiCatalog.DataDir + "."
        + (CredentialStore.Available
            ? "\nPasswords, when remembered, are held by Windows Credential Manager — never by this tool."
            : "\nThis platform has no credential store, so passwords are never remembered.");

    // ── THE CATALOG ─────────────────────────────────────────────────────

    /// <summary>
    /// What this server publishes, against what the tool ships with.
    ///
    /// /apidocs.json is unauthenticated, so this works before signing in —
    /// which matters, because a catalog that does not match the server is
    /// exactly why a first sign-in might be failing.
    /// </summary>
    private async Task<CatalogDiffResult?> FetchDiffAsync()
    {
        if (string.IsNullOrWhiteSpace(_fb.BaseUrl)) return null;

        var incoming = ApiDocsImport.Parse(await ApiDocsImport.FetchAsync(_fb.BaseUrl));
        RefreshCatalogChip(incoming.Version);
        return CatalogDiff.Compare(_catalog, incoming);
    }

    private string ApplyDiff(CatalogDiffResult diff)
    {
        var applied = diff.Changes.Count(c => c.Apply);

        Log.Info("applying " + applied + " catalog change(s) from v" + diff.CurrentVersion
                 + " to v" + diff.IncomingVersion);

        var updated = CatalogDiff.Apply(_catalog, diff);
        updated.Save();
        _catalog = updated;

        BuildTree();
        RefreshCatalogChip();
        TxtStatus.Text = "Catalog updated to v" + updated.Version + " — " + applied + " change(s) applied.";

        // Open tabs hold the OLD endpoint records. Rebinding them behind the
        // user's back would lose whatever is typed into them, so say so.
        return applied + " change(s) applied. The catalog is now at v" + updated.Version
             + ", saved to " + ApiCatalog.UserFile + "."
             + (Tabs.ItemCount > 0
                 ? " Tabs already open still show the previous shape — close and reopen them to refresh."
                 : "");
    }

    private void RefreshCatalogChip(string? version = null)
    {
        var v = version ?? _catalog.Version;
        TxtDocsChip.Text = "catalog v" + (string.IsNullOrWhiteSpace(v) ? "?" : v);
    }

    // ── THE IDLE WATCH ──────────────────────────────────────────────────

    private readonly IdleWatch _idle = new();
    private readonly DispatcherTimer _idleTimer = new() { Interval = TimeSpan.FromSeconds(1) };

    /// <summary>
    /// Let go of the seat licence when nobody is here.
    ///
    /// A signed-in session holds a Fishbowl licence whether or not anyone is
    /// using it, so a tool left open overnight quietly costs a seat. The
    /// warning counts down in front of you and any key or click cancels it,
    /// so a long read is never signed out from under you.
    /// </summary>
    private void StartIdleWatch()
    {
        _idleTimer.Tick += (_, _) => CheckIdle();

        // Tunnelled from the window, so a key or click a child control goes on
        // to handle itself still counts as someone being here.
        AddHandler(PointerMovedEvent, (_, _) => Touch(), RoutingStrategies.Tunnel);
        AddHandler(PointerPressedEvent, (_, _) => Touch(), RoutingStrategies.Tunnel);
        AddHandler(KeyDownEvent, (_, _) => Touch(), RoutingStrategies.Tunnel);
        AddHandler(PointerWheelChangedEvent, (_, _) => Touch(), RoutingStrategies.Tunnel);
        Activated += (_, _) => Touch();

        BtnStaySignedIn.Click += (_, _) => Touch();
        ApplyIdlePrefs();
    }

    private void Touch()
    {
        _idle.Touch();
        if (IdleBanner.IsVisible) IdleBanner.IsVisible = false;
    }

    private void ApplyIdlePrefs()
    {
        _idle.IdleAfter = TimeSpan.FromMinutes(Prefs.IdleMinutes(Get));
        _idle.Grace = TimeSpan.FromSeconds(Prefs.GraceSeconds(Get));
        SetIdleWatch(!string.IsNullOrEmpty(_token));
    }

    private void SetIdleWatch(bool on)
    {
        // A session nobody asked to be released is still not released.
        on = on && Prefs.IdleEnabledOr(Get);

        _idle.Enabled = on;
        _idle.Touch();
        IdleBanner.IsVisible = false;

        if (on) _idleTimer.Start(); else _idleTimer.Stop();
    }

    private async void CheckIdle()
    {
        switch (_idle.State())
        {
            case IdleState.Warning:
                IdleBanner.IsVisible = true;
                TxtIdleMessage.Text = _idle.Message();
                break;

            case IdleState.Expired:
                SetIdleWatch(false);
                await SignOutAsync("Signed out after " + (int)_idle.IdleAfter.TotalMinutes
                                   + " minutes idle, to release the licence.");
                break;

            default:
                if (IdleBanner.IsVisible) IdleBanner.IsVisible = false;
                break;
        }
    }
}
