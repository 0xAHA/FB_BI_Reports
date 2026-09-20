using System.Net.Http;
using System.Windows;
using FbReportHost;

namespace FbApiTool;

/// <summary>
/// Two ways in, because the tool is used for two different jobs.
///
/// Signing in is the normal path. Pasting a token is not a shortcut — it is how
/// you reproduce a failing call with the SAME session the integration used,
/// which is usually the only way to tell an access-right problem apart from a
/// payload problem.
/// </summary>
public partial class ConnectWindow : Window
{
    private readonly FishbowlClient _fb;

    /// <summary>The token to use, or null if the user chose to work offline.</summary>
    public string? Token { get; private set; }

    /// <summary>Who the token belongs to, for the header chip.</summary>
    public string ConnectedAs { get; private set; } = "";

    /// <summary>The username signed in with, so it can be pre-filled next time.</summary>
    public string? Username { get; private set; }

    public ConnectWindow(FishbowlClient fb, string? lastUser)
    {
        InitializeComponent();
        _fb = fb;
        TxtServer.Text = fb.BaseUrl;
        TxtUser.Text = lastUser ?? "";
        TxtAppName.Text = fb.AppName;
        TxtAppId.Text = fb.AppId.ToString();
        LoadStoredPassword();
        TxtUser.TextChanged += (_, _) => LoadStoredPassword();
        TxtServer.TextChanged += (_, _) => LoadStoredPassword();

        Loaded += (_, _) =>
        {
            if (TxtUser.Text.Length == 0) TxtUser.Focus();
            else if (TxtPass.Password.Length == 0) TxtPass.Focus();
            else BtnGo.Focus();               // everything is filled in; just go
        };
    }

    private bool PasteMode => Modes.SelectedIndex == 1;

    private string VaultKey =>
        CredentialStore.TargetFor(TxtServer.Text.Trim().TrimEnd('/'), TxtUser.Text.Trim());

    /// <summary>
    /// Fill the password in from the Windows Credential Manager, if one is
    /// stored for this server and user.
    ///
    /// Keyed on both, because the same person routinely has different
    /// passwords on a sandbox and on a customer’s server, and filling the
    /// wrong one in silently is worse than filling in nothing.
    /// </summary>
    private void LoadStoredPassword()
    {
        if (TxtUser.Text.Trim().Length == 0 || TxtServer.Text.Trim().Length == 0)
        {
            BtnForget.Visibility = Visibility.Collapsed;
            return;
        }

        var stored = CredentialStore.Load(VaultKey);
        if (stored is null)
        {
            BtnForget.Visibility = Visibility.Collapsed;
            return;
        }

        TxtPass.Password = stored;
        ChkRemember.IsChecked = true;
        BtnForget.Visibility = Visibility.Visible;
        TxtVault.Text = "Filled in from the Windows Credential Manager.";
    }

    private void ChkRemember_Click(object sender, RoutedEventArgs e)
    {
        // Unticking is a request to forget, not just to stop saving.
        if (ChkRemember.IsChecked != true && CredentialStore.Exists(VaultKey)) Forget();
    }

    private void BtnForget_Click(object sender, RoutedEventArgs e) => Forget();

    private void Forget()
    {
        CredentialStore.Delete(VaultKey);
        ChkRemember.IsChecked = false;
        BtnForget.Visibility = Visibility.Collapsed;
        TxtVault.Text = "Removed from the Windows Credential Manager.";
    }

    private async void BtnGo_Click(object sender, RoutedEventArgs e)
    {
        ErrBox.Visibility = Visibility.Collapsed;
        _fb.BaseUrl = TxtServer.Text.Trim().TrimEnd('/');
        if (_fb.BaseUrl.Length == 0) { Fail("Enter the server address, e.g. http://localhost:2456"); return; }

        if (PasteMode) { await UseTokenAsync(); return; }

        if (TxtUser.Text.Trim().Length == 0) { Fail("Enter a username."); return; }

        _fb.AppName = TxtAppName.Text.Trim().Length > 0 ? TxtAppName.Text.Trim() : _fb.AppName;
        if (int.TryParse(TxtAppId.Text.Trim(), out var appId)) _fb.AppId = appId;

        Busy(true, "Signing in…");
        try
        {
            await _fb.LoginAsync(TxtUser.Text.Trim(), TxtPass.Password,
                                 TxtMfa.Text.Trim().Length > 0 ? TxtMfa.Text.Trim() : null);
            Token = _fb.Token;
            Username = TxtUser.Text.Trim();
            ConnectedAs = _fb.User?["userFullName"]?.ToString() ?? Username;

            // Only once the server has accepted it. Storing a password that
            // turns out to be wrong is worse than storing none: it comes
            // back pre-filled and looking correct on every later attempt.
            if (ChkRemember.IsChecked == true && TxtPass.Password.Length > 0)
                CredentialStore.Save(VaultKey, Username, TxtPass.Password);

            DialogResult = true;
        }
        catch (Exception ex) { Fail(ex.Message); }
        finally { Busy(false, ""); }
    }

    /// <summary>
    /// Check a pasted token before accepting it. Without this the first real
    /// request fails with a 401 that reads as an endpoint problem rather than
    /// a stale token, which is a genuinely confusing place to start debugging.
    /// </summary>
    private async Task UseTokenAsync()
    {
        var tok = TxtToken.Text.Trim();
        if (tok.Length == 0) { Fail("Paste a bearer token, or use the Sign in tab."); return; }
        // Tolerate a full "Bearer xyz" header being pasted in.
        if (tok.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase)) tok = tok[7..].Trim();

        Busy(true, "Checking the token…");
        try
        {
            using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(30) };
            using var req = new HttpRequestMessage(HttpMethod.Get, _fb.BaseUrl + "/api/location-groups");
            req.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", tok);
            using var res = await http.SendAsync(req);

            if (res.StatusCode == System.Net.HttpStatusCode.Unauthorized)
            { Fail("The server rejected that token (401). It may have expired or been logged out."); return; }
            if (!res.IsSuccessStatusCode)
            { Fail("The server answered " + (int)res.StatusCode + " " + res.ReasonPhrase + " when testing the token."); return; }

            Token = tok;
            ConnectedAs = "pasted token";
            DialogResult = true;
        }
        catch (Exception ex) { Fail("Could not reach " + _fb.BaseUrl + " — " + ex.Message); }
        finally { Busy(false, ""); }
    }

    private void BtnSkip_Click(object sender, RoutedEventArgs e)
    {
        _fb.BaseUrl = TxtServer.Text.Trim().TrimEnd('/');
        Token = null;
        DialogResult = false;
    }

    private void Fail(string msg)
    {
        TxtErr.Text = msg;
        ErrBox.Visibility = Visibility.Visible;
    }

    private void Busy(bool on, string label)
    {
        BtnGo.IsEnabled = !on;
        BtnSkip.IsEnabled = !on;
        TxtBusy.Text = label;
    }
}
