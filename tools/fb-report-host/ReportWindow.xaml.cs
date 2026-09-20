using System.Windows;

namespace FbReportHost;

/// <summary>
/// A popped-out report. Shares the signed-in FishbowlClient with the main
/// window, so signing in once covers every open report.
/// </summary>
public partial class ReportWindow : Window
{
    public ReportWindow() => InitializeComponent();

    public async Task OpenAsync(
        FishbowlClient fb,
        string path,
        Action<string, string> log,
        Func<string, string?> settingGet,
        Action<string, string> settingSet)
    {
        await View.InitAsync(fb, log, settingGet, settingSet, s => TxtStatus.Text = s);
        View.HidePopOut();          // already its own window
        View.Load(path);
        Title = "Fishbowl BI — " + View.ReportName;
    }

    protected override void OnClosed(EventArgs e)
    {
        View.Shutdown();
        base.OnClosed(e);
    }
}
