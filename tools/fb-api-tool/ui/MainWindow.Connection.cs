using System.Collections.ObjectModel;
using Avalonia.Media;
using FbReportHost;

namespace FbApiTool.Ui;

/// <summary>
/// The connection half of the shell: which server, who is signed in, and the
/// warning that goes up when that server holds real data.
///
/// Separate file, same class. The window has two jobs — arranging the panes
/// and owning the session — and they are easier to read apart.
/// </summary>
public partial class MainWindow
{
    private readonly FishbowlClient _fb = new()
    {
        AppName = "Fishbowl Advanced API Tool",
        AppId = 101,
    };

    private readonly ObservableCollection<ServerProfile> _profiles = [];

    /// <summary>
    /// The token in use. Not always the one LoginAsync produced — it may have
    /// been pasted, in which case this tool did not start that session and has
    /// no business ending it.
    /// </summary>
    private string? _token;
    private bool _tokenPasted;

    private ServerProfile? CurrentProfile => CmbProfile.SelectedItem as ServerProfile;

    private bool OnProduction => CurrentProfile?.IsProduction == true;

    private void SetUpConnection()
    {
        foreach (var p in Profiles.Load()) _profiles.Add(p);
        if (_profiles.Count == 0) _profiles.Add(new ServerProfile { Name = "Local" });

        CmbProfile.ItemsSource = _profiles;
        CmbProfile.SelectedItem =
            _profiles.FirstOrDefault(p => p.Id == Get("profile")) ?? _profiles[0];

        CmbProfile.SelectionChanged += (_, _) => ApplyProfile();
        BtnAuth.Click += async (_, _) => await AuthAsync();

        ApplyProfile();
    }

    /// <summary>
    /// Point the client at the selected server.
    ///
    /// Switching disconnects, because a token belongs to a session on one
    /// server and carrying it to another produces a 401 that reads as a
    /// broken endpoint.
    /// </summary>
    private void ApplyProfile()
    {
        if (CurrentProfile is not { } p) return;

        var moved = !string.Equals(_fb.BaseUrl, p.BaseUrl, StringComparison.OrdinalIgnoreCase);

        _fb.BaseUrl = p.BaseUrl;
        _fb.AppName = p.AppName;
        _fb.AppId = p.AppId;
        Set("profile", p.Id);

        if (moved)
        {
            // Another server is another database. Leaving the old one's tables
            // in the browser would offer completions for columns that are not
            // there, which is worse than offering none.
            _schema = null;
            RefreshSchemaTree();
        }

        if (moved && _token is not null)
        {
            _token = null;
            _tokenPasted = false;
            TxtStatus.Text = "Switched to " + p.Name +
                             ". The previous token belonged to the other server, so you are disconnected.";
        }

        TxtServerChip.Text = p.BaseUrl;
        ApplyProductionWarning();
        RefreshAuth();
    }

    private void ApplyProductionWarning()
    {
        var prod = OnProduction;
        // FbBrandBar, not FbBlue: the bar has its own token because the dark
        // theme needs a deeper blue behind white text. Assigning the plain
        // brand blue here put the light-theme bar back on a dark window.
        BrandBar.Background = prod ? Brand.Negative : Brand.BrandBar;
        ProdBanner.IsVisible = prod;
        TxtProdBanner.Text = prod
            ? "PRODUCTION — " + _fb.BaseUrl +
              ".  Writes here change real data, and you will be asked to confirm each one."
            : "";
    }

    private void RefreshAuth()
    {
        var on = !string.IsNullOrEmpty(_token);
        BtnAuth.Content = on ? "Disconnect" : "Connect";
        TxtAuth.Text = on ? _connectedAs : "not connected";
    }

    private string _connectedAs = "";

    // ── CONNECT / DISCONNECT ────────────────────────────────────────────

    private async Task AuthAsync()
    {
        if (string.IsNullOrEmpty(_token)) await ShowConnectAsync(firstRun: false);
        else await SignOutAsync("Disconnected.");
    }

    private async Task ShowConnectAsync(bool firstRun)
    {
        var dlg = new ConnectWindow(_fb, CurrentProfile?.Username, firstRun);
        var ok = await dlg.ShowDialog<bool>(this);

        if (!ok)
        {
            if (dlg.Offline || firstRun)
                TxtStatus.Text = "Not connected. The endpoint list and both guides still work.";
            return;
        }

        _token = dlg.Token;
        _tokenPasted = dlg.Pasted;
        _connectedAs = dlg.ConnectedAs;

        // Remember who, so the next sign-in is one field shorter. Never the
        // password — that is the credential manager's business.
        if (CurrentProfile is { } p && dlg.Username.Length > 0)
        {
            p.Username = dlg.Username;
            Profiles.Save(_profiles);
        }

        Log.Info("connected to " + _fb.BaseUrl + " as " + _connectedAs
                 + (_tokenPasted ? " (pasted token)" : ""));

        RefreshAuth();
        RefreshOpenPanes();
        SetIdleWatch(true);
        TxtStatus.Text = "Connected to " + _fb.BaseUrl + " as " + _connectedAs + ".";

        // Reading the schema needs a token, so this is the first moment it can
        // be done. Asking only when the Data tab is built meant connecting
        // AFTER opening that tab left the browser empty with no way back but
        // the Refresh button.
        _ = LoadSchemaAsync(false);
    }

    /// <summary>
    /// End the session, but only one this tool started.
    ///
    /// A pasted token belongs to whoever issued it and may still be in use
    /// elsewhere, so disconnecting here forgets it rather than logging it out.
    /// </summary>
    private async Task SignOutAsync(string why)
    {
        if (!_tokenPasted && _fb.IsLoggedIn)
        {
            try { await _fb.LogoutAsync(); } catch { /* best effort */ }
        }

        _token = null;
        _tokenPasted = false;
        _connectedAs = "";

        Log.Info("signed out: " + why);

        RefreshAuth();
        RefreshOpenPanes();
        SetIdleWatch(false);
        TxtStatus.Text = why;
    }

    /// <summary>
    /// Asked before a write against a server marked production.
    ///
    /// Per request rather than a session-wide "I understand": the point is to
    /// interrupt the one call that was not meant to go there, and a box ticked
    /// an hour ago interrupts nothing.
    /// </summary>
    private async Task<bool> ConfirmWriteAsync(string method, string url)
    {
        if (!OnProduction || !Profiles.IsWrite(method)) return true;

        return await Dialogs.ConfirmAsync(this, "Production write",
            method.ToUpperInvariant() + " to a PRODUCTION server.\n\n" + url +
            "\n\nThis changes real data. Send it?");
    }
}
