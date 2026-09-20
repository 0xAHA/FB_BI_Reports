using System.IO;
using System.Windows;
using System.Windows.Threading;

namespace FbApiTool;

public partial class App : Application
{
    /// <summary>
    /// Say what went wrong instead of vanishing.
    ///
    /// An exception on the UI thread closes a WPF application with no window,
    /// no message and nothing written down — which leaves "it crashes" as the
    /// entire bug report. Showing it, and keeping a copy beside the settings,
    /// costs one dialog and turns that into a stack trace.
    /// </summary>
    protected override void OnStartup(StartupEventArgs e)
    {
        DispatcherUnhandledException += OnUnhandled;
        base.OnStartup(e);
    }

    private void OnUnhandled(object sender, DispatcherUnhandledExceptionEventArgs e)
    {
        var detail = e.Exception.ToString();
        var log = "";

        try
        {
            Directory.CreateDirectory(ApiCatalog.DataDir);
            log = Path.Combine(ApiCatalog.DataDir, "crash.log");
            File.AppendAllText(log,
                "── " + DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") +
                " ─ build " + BuildInfo.Long + " ──\n" + detail + "\n\n");
        }
        catch { log = ""; }

        MessageBox.Show(
            e.Exception.Message +
            "\n\n" + First(detail, 12) +
            (log.Length > 0 ? "\n\nWritten to " + log : ""),
            "Fishbowl API Tool — something went wrong",
            MessageBoxButton.OK, MessageBoxImage.Error);

        // Carrying on beats disappearing: whatever failed, the window and any
        // unsaved request in it are usually still usable.
        e.Handled = true;
    }

    private static string First(string text, int lines) =>
        string.Join("\n", text.Split('\n').Take(lines)).TrimEnd();
}
