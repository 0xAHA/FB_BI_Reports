using System.IO;
using System.Reflection;
using System.Windows;
using System.Windows.Controls;
using Microsoft.Web.WebView2.Core;

namespace FbReportHost;

/// <summary>
/// One report in one WebView2, with its own bridge instance.
///
/// It is a UserControl rather than code inside MainWindow so the same thing can
/// be docked in the main window OR hosted in a pop-out window — several reports
/// open at once, each with its own ReportKey for loadReportData/saveReportData,
/// all sharing one signed-in FishbowlClient.
/// </summary>
public partial class ReportView : UserControl
{
    private FishbowlClient? _fb;
    private FishbowlBridge? _bridge;
    private Action<string, string>? _log;
    private Func<string, string?>? _get;
    private Action<string, string>? _set;
    private Action<string>? _status;
    private bool _ready;

    public string? ReportPath { get; private set; }
    public string ReportName { get; private set; } = "";

    /// <summary>Raised when the user asks for this report in its own window.</summary>
    public event Action<string>? PopOutRequested;

    public ReportView() => InitializeComponent();

    /// <summary>Hide the pop-out button when this view already IS a pop-out.</summary>
    public void HidePopOut() => BtnPopOut.Visibility = Visibility.Collapsed;

    public async Task InitAsync(
        FishbowlClient fb,
        Action<string, string> log,
        Func<string, string?> settingGet,
        Action<string, string> settingSet,
        Action<string> status)
    {
        _fb = fb; _log = log; _get = settingGet; _set = settingSet; _status = status;

        // One shared user-data folder so every window reuses the same browser
        // profile (and the same DevTools settings) instead of spawning a
        // separate Chromium user profile per window.
        var userData = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "FbReportHost", "WebView2");
        Directory.CreateDirectory(userData);
        var env = await CoreWebView2Environment.CreateAsync(null, userData);
        await Web.EnsureCoreWebView2Async(env);

        _bridge = new FishbowlBridge(fb, log, settingGet, settingSet,
            (m, i) => status("openModule(\"" + m + "\", \"" + i + "\") — not available outside the Fishbowl client."));
        Web.CoreWebView2.AddHostObjectToScript("fb", _bridge);
        await Web.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync(BridgeJs());
        Web.CoreWebView2.Settings.AreDevToolsEnabled = true;
        Web.CoreWebView2.Settings.IsStatusBarEnabled = false;
        _ready = true;
    }

    private static string? _bridgeJs;
    private static string BridgeJs()
    {
        if (_bridgeJs is not null) return _bridgeJs;
        var asm = Assembly.GetExecutingAssembly();
        var name = asm.GetManifestResourceNames()
                      .FirstOrDefault(n => n.EndsWith("bridge.js", StringComparison.OrdinalIgnoreCase))
                   ?? throw new InvalidOperationException("bridge.js is not embedded in the build.");
        using var s = asm.GetManifestResourceStream(name)!;
        return _bridgeJs = new StreamReader(s).ReadToEnd();
    }

    public void Load(string path)
    {
        if (!_ready) { _status?.Invoke("WebView2 is not ready yet."); return; }
        try
        {
            ReportPath = path;
            var rep = ReportLoader.Load(path);
            ReportName = rep.Name;
            if (_bridge is not null) _bridge.ReportKey = rep.Name;

            TxtTitle.Text = rep.Name + "   —   " + path;

            // Written to a temp file rather than NavigateToString: that API caps
            // at about 2MB and several of these reports are larger once fb-lib
            // and fb-styles are inlined.
            var tmp = Path.Combine(Path.GetTempPath(), "FbReportHost",
                                   Guid.NewGuid().ToString("N")[..8]);
            Directory.CreateDirectory(tmp);
            var outFile = Path.Combine(tmp, "report.html");
            File.WriteAllText(outFile, rep.Html);
            Web.CoreWebView2.Navigate(new Uri(outFile).AbsoluteUri);

            var bits = new List<string> { rep.Html.Length.ToString("N0") + " bytes" };
            if (rep.Expanded.Count > 0)
                bits.Add("expanded " + string.Join(", ", rep.Expanded) + " from " + rep.AssetSource);
            _status?.Invoke(rep.Name + "  ·  " + string.Join("  ·  ", bits));
            _log?.Invoke("loaded " + path, "success");
            if (_fb is { IsLoggedIn: false }) _log?.Invoke("not signed in — queries will come back empty", "warning");

            if (rep.Missing.Count > 0)
            {
                // Without this the only symptom is the report's own "fb-lib not
                // loaded" guard, which tells the user to fix it on the Fishbowl
                // server — the wrong instruction here.
                foreach (var m in rep.Missing) _log?.Invoke("  MISSING " + m + " — in no asset folder", "error");
                var what = string.Join(", ", rep.Missing);
                _status?.Invoke("Shared assets missing (" + what + ") — use Shared assets… on the toolbar.");
                MessageBox.Show(Window.GetWindow(this),
                    "This report needs shared assets that are not available here:\n\n    " + what +
                    "\n\nA report only carries a DIRECTIVE, not the shared code — the Fishbowl server " +
                    "substitutes it when the report is saved. Outside Fishbowl this host has to supply it.\n\n" +
                    "Click \"Shared assets…\" on the toolbar and pick your FB_BI_Reports\\scripts folder, " +
                    "then reload this report.",
                    "Shared assets missing", MessageBoxButton.OK, MessageBoxImage.Warning);
            }
        }
        catch (Exception ex)
        {
            _status?.Invoke("Could not open — " + ex.Message);
            _log?.Invoke("open failed: " + ex.Message, "error");
            MessageBox.Show(Window.GetWindow(this), ex.Message, "Open report",
                            MessageBoxButton.OK, MessageBoxImage.Warning);
        }
    }

    private void BtnReload_Click(object sender, RoutedEventArgs e)
    {
        if (ReportPath is null) { _status?.Invoke("Nothing open to reload."); return; }
        Load(ReportPath);
    }

    private void BtnDevTools_Click(object sender, RoutedEventArgs e)
    {
        if (_ready) Web.CoreWebView2.OpenDevToolsWindow();
    }

    private void BtnPopOut_Click(object sender, RoutedEventArgs e)
    {
        if (ReportPath is null) { _status?.Invoke("Open a report first."); return; }
        PopOutRequested?.Invoke(ReportPath);
    }

    public void Shutdown()
    {
        try { Web.Dispose(); } catch { /* closing anyway */ }
    }
}
