using System.IO;
using System.Windows;

namespace FbReportHost;

/// <summary>
/// Asked once per colliding file when an import would land on a name the target
/// folder already holds.
///
/// The choice genuinely cannot be guessed. Re-importing a report you already
/// have is normally an UPDATE — a fresh export of the same thing — but two
/// unrelated reports can share a filename just as easily, and the exporter's
/// "&lt;name&gt;-Page.json" scheme makes that likelier than it sounds. So the
/// dialog puts the two copies side by side with their dates and sizes, because
/// "which of these is newer" is the question actually being asked.
/// </summary>
public partial class ImportConflictWindow : Window
{
    /// <summary>The user's answer, or null if they cancelled the whole import.</summary>
    public Library.OnConflict? Choice { get; private set; }

    /// <summary>True when the answer should be reused for every remaining collision.</summary>
    public bool ApplyToAll => ChkAll.IsChecked == true;

    public ImportConflictWindow(string incomingPath, string existingPath, int remaining)
    {
        InitializeComponent();

        var name = Path.GetFileName(incomingPath);
        TxtFile.Text = name;
        TxtWhere.Text = "Importing into " + (Path.GetDirectoryName(existingPath) ?? "");

        TxtExistingName.Text = ReportLoader.LabelFor(existingPath);
        TxtExistingMeta.Text = Describe(existingPath);
        TxtIncomingName.Text = ReportLoader.LabelFor(incomingPath);
        TxtIncomingMeta.Text = Describe(incomingPath);

        TxtHint.Text = Hint(incomingPath, existingPath);

        if (remaining > 0)
        {
            ChkAll.Visibility = Visibility.Visible;
            ChkAll.Content = remaining == 1
                ? "Do the same for the 1 remaining file"
                : "Do the same for the " + remaining + " remaining files";
        }
    }

    private static string Describe(string path)
    {
        try
        {
            var fi = new FileInfo(path);
            return fi.LastWriteTime.ToString("d MMM yyyy, h:mm tt") + "  ·  " +
                   (fi.Length / 1024.0).ToString("N0") + " KB";
        }
        catch { return "(could not read this file)"; }
    }

    /// <summary>
    /// Say which copy is newer in words. The two timestamps are already on
    /// screen, but they are the thing people misread under a modal.
    /// </summary>
    private static string Hint(string incoming, string existing)
    {
        try
        {
            var a = new FileInfo(incoming).LastWriteTimeUtc;
            var b = new FileInfo(existing).LastWriteTimeUtc;
            if (a > b) return "The file being imported is the newer of the two — Replace if this is an updated export of the same report.";
            if (a < b) return "The copy already in the library is NEWER than the one being imported. Replacing it will lose that copy.";
            return "Both files were last written at the same moment — they are most likely the same file.";
        }
        catch { return ""; }
    }

    private void Answer(Library.OnConflict c) { Choice = c; DialogResult = true; }

    private void BtnOverwrite_Click(object sender, RoutedEventArgs e) => Answer(Library.OnConflict.Overwrite);
    private void BtnKeep_Click(object sender, RoutedEventArgs e) => Answer(Library.OnConflict.KeepBoth);
    private void BtnSkip_Click(object sender, RoutedEventArgs e) => Answer(Library.OnConflict.Skip);

    private void BtnCancel_Click(object sender, RoutedEventArgs e)
    {
        Choice = null;              // cancels the rest of the import, not just this file
        DialogResult = false;
    }
}
