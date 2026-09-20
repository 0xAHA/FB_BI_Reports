using System.Net.Http;
using System.Net.Http.Headers;
using Avalonia.Controls;
using FbReportHost;   // the shared sign-in client

namespace FbApiTool.Ui;

/// <summary>
/// Sign in, or paste a token that already exists.
///
/// The rules here are the ones that must not drift between the two builds:
/// a password is written to the Windows Credential Manager only after the
/// server has accepted it, and a pasted token is checked before it is taken
/// but never logged out afterwards, because it belongs to whoever issued it.
/// </summary>
public partial class ConnectWindow : Window
{
    private readonly FishbowlClient _fb;
    private readonly string _server;

    /// <summary>The token to use, once the dialog closes with a result.</summary>
    public string? Token { get; private set; }

    /// <summary>Who that token belongs to, for the header.</summary>
    public string ConnectedAs { get; private set; } = "";

    public string Username => TxtUser.Text?.Trim() ?? "";

    /// <summary>True when the user chose to carry on with no connection.</summary>
    public bool Offline { get; private set; }

    /// <summary>Set when the token was pasted rather than issued here.</summary>
    public bool Pasted { get; private set; }

    public ConnectWindow(FishbowlClient fb, string? lastUser, bool firstRun)
    {
        InitializeComponent();

        _fb = fb;
        _server = fb.BaseUrl;

        TxtServer.Text = fb.BaseUrl;
        TxtUser.Text = lastUser ?? "";
        TxtAppName.Text = fb.AppName;
        TxtAppId.Text = fb.AppId.ToString();

        LoadRemembered();

        BtnConnect.Click += async (_, _) => await ConnectAsync();
        BtnOffline.Click += (_, _) => { Offline = true; Close(false); };
        BtnForget.Click += (_, _) => Forget();

        // Enter connects from any field, the same as the rest of the tool.
        KeyDown += async (_, e) =>
        {
            if (e.Key == Avalonia.Input.Key.Enter) await ConnectAsync();
            if (e.Key == Avalonia.Input.Key.Escape) { Offline = true; Close(false); }
        };

        Opened += (_, _) =>
        {
            if (TxtUser.Text?.Length > 0 && TxtPass.Text?.Length > 0) BtnConnect.Focus();
            else if (TxtUser.Text?.Length > 0) TxtPass.Focus();
            else TxtUser.Focus();
        };

        if (firstRun) TxtBusy.Text = "";
    }

    // ── REMEMBERED PASSWORDS ────────────────────────────────────────────

    /// <summary>
    /// The entry is keyed on the server and the username together, because the
    /// same person has different passwords on different servers and the wrong
    /// one filled in silently is worse than none.
    /// </summary>
    private void LoadRemembered()
    {
        if (!CredentialStore.Available)
        {
            ChkRemember.IsEnabled = false;
            BtnForget.IsEnabled = false;
            TxtVault.Text = "There is no credential vault on this system, so a password cannot be remembered.";
            return;
        }

        var user = TxtUser.Text?.Trim() ?? "";
        if (user.Length == 0) return;

        var stored = CredentialStore.Load(CredentialStore.TargetFor(_server, user));
        if (stored is null) { TxtVault.Text = ""; return; }

        TxtPass.Text = stored;
        ChkRemember.IsChecked = true;
        TxtVault.Text = "Filled in from the Windows Credential Manager.";
    }

    private void Forget()
    {
        CredentialStore.Delete(CredentialStore.TargetFor(_server, Username));
        TxtPass.Text = "";
        ChkRemember.IsChecked = false;
        TxtVault.Text = "Forgotten.";
    }

    // ── CONNECTING ──────────────────────────────────────────────────────

    private async Task ConnectAsync()
    {
        ErrBox.IsVisible = false;

        _fb.BaseUrl = (TxtServer.Text ?? "").Trim().TrimEnd('/');
        if (_fb.BaseUrl.Length == 0) { Fail("Enter the server address, e.g. http://localhost:2456"); return; }

        if (Modes.SelectedIndex == 1) { await UseTokenAsync(); return; }

        if (Username.Length == 0) { Fail("Enter a username."); return; }

        _fb.AppName = (TxtAppName.Text ?? "").Trim() is { Length: > 0 } a ? a : _fb.AppName;
        if (int.TryParse((TxtAppId.Text ?? "").Trim(), out var id)) _fb.AppId = id;

        Busy(true, "Signing in…");
        try
        {
            var mfa = (TxtMfa.Text ?? "").Trim();
            await _fb.LoginAsync(Username, TxtPass.Text ?? "", mfa.Length > 0 ? mfa : null);

            Token = _fb.Token;
            ConnectedAs = _fb.User?["userFullName"]?.ToString() ?? Username;

            // Only once the server has accepted it. Storing a password that
            // turns out to be wrong is worse than storing none: it comes back
            // pre-filled and looking correct on every later attempt.
            if (ChkRemember.IsChecked == true && (TxtPass.Text ?? "").Length > 0)
                CredentialStore.Save(CredentialStore.TargetFor(_server, Username), Username, TxtPass.Text!);

            Close(true);
        }
        catch (Exception ex) { Fail(ex.Message); }
        finally { Busy(false, ""); }
    }

    /// <summary>
    /// Check a pasted token before accepting it. Without this the first real
    /// request fails with a 401 that reads as an endpoint problem rather than
    /// a stale token, which is a confusing place to start debugging.
    /// </summary>
    private async Task UseTokenAsync()
    {
        var tok = (TxtToken.Text ?? "").Trim();
        if (tok.Length == 0) { Fail("Paste a bearer token, or use the Sign in tab."); return; }

        Busy(true, "Checking the token…");
        try
        {
            using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(30) };
            using var req = new HttpRequestMessage(HttpMethod.Get, _fb.BaseUrl + "/api/location-groups");
            req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", tok);
            using var res = await http.SendAsync(req);

            if (res.StatusCode == System.Net.HttpStatusCode.Unauthorized)
            { Fail("The server rejected that token (401). It may have expired or been logged out."); return; }
            if (!res.IsSuccessStatusCode)
            { Fail("The server answered " + (int)res.StatusCode + " " + res.ReasonPhrase + " when testing the token."); return; }

            Token = tok;
            Pasted = true;
            ConnectedAs = "pasted token";
            Close(true);
        }
        catch (Exception ex) { Fail("Could not reach " + _fb.BaseUrl + " — " + ex.Message); }
        finally { Busy(false, ""); }
    }

    private void Fail(string why)
    {
        TxtErr.Text = why;
        ErrBox.IsVisible = true;
    }

    private void Busy(bool on, string what)
    {
        TxtBusy.Text = what;
        TxtBusy.IsVisible = on;
        BtnConnect.IsEnabled = !on;
    }
}
