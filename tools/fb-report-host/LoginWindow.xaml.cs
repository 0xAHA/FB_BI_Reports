using System.Windows;

namespace FbReportHost;

/// <summary>
/// Sign-in, shown modally at startup. A modal rather than a bar across the top
/// because signing in is a once-per-session act, and the credentials do not
/// need to occupy a strip of every subsequent screen.
///
/// There is no offline mode: every report reads live data, so a session with no
/// connection can only mislead. The only alternative to signing in is Exit.
/// </summary>
public partial class LoginWindow : Window
{
    private readonly FishbowlClient _fb;

    public bool SignedIn { get; private set; }

    public LoginWindow(FishbowlClient fb, string? server, string? user)
    {
        InitializeComponent();
        _fb = fb;
        if (!string.IsNullOrWhiteSpace(server)) TxtServer.Text = server;
        if (!string.IsNullOrWhiteSpace(user)) TxtUser.Text = user;
        Loaded += (_, _) =>
        {
            if (string.IsNullOrWhiteSpace(TxtUser.Text)) TxtUser.Focus();
            else TxtPass.Focus();
        };
    }

    private async void BtnGo_Click(object sender, RoutedEventArgs e)
    {
        Err(null);
        Busy(true);
        try
        {
            _fb.BaseUrl = TxtServer.Text.Trim();
            await _fb.LoginAsync(TxtUser.Text.Trim(), TxtPass.Password, TxtMfa.Text.Trim());
            SignedIn = true;
            DialogResult = true;
        }
        catch (Exception ex)
        {
            // The first run always lands here: the host registers itself as a
            // new integrated application, which an administrator must approve.
            // Saying so beats leaving the raw server message as the only clue.
            var extra = ex.Message.Contains("integrated application", StringComparison.OrdinalIgnoreCase)
                ? "\n\nThis is expected the first time. Approve \"" + _fb.AppName +
                  "\" in Fishbowl (Settings ▸ Integrated Applications), then sign in again."
                : ex.Message.Contains("MFA", StringComparison.OrdinalIgnoreCase)
                    ? "\n\nEnter the current code from your authenticator app above."
                    : "";
            Err(ex.Message + extra);
        }
        finally { Busy(false); }
    }

    private void BtnExit_Click(object sender, RoutedEventArgs e)
    {
        SignedIn = false;
        DialogResult = false;          // the caller shuts the app down
    }

    private void Busy(bool on)
    {
        BtnGo.IsEnabled = !on;
        BtnExit.IsEnabled = !on;
        TxtBusy.Text = on ? "Signing in…" : "";
    }

    private void Err(string? msg)
    {
        TxtErr.Text = msg ?? "";
        ErrBox.Visibility = string.IsNullOrEmpty(msg) ? Visibility.Collapsed : Visibility.Visible;
        if (msg is not null) SizeToContent = SizeToContent.Height;
    }
}
