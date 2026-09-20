using System.Windows;
using System.Windows.Controls;

namespace FbApiTool;

/// <summary>
/// Pick a field out of a response and name it.
///
/// The paths are offered rather than typed because the shape of a Fishbowl
/// response is not obvious — a search wraps its rows in <c>results</c>, a
/// create returns a bare object — and a mistyped path fails silently, which is
/// the worst way for this to fail.
/// </summary>
public partial class CaptureWindow : Window
{
    private readonly string _body;

    /// <summary>The chosen path, or null if cancelled.</summary>
    public string? Path { get; private set; }

    /// <summary>The variable to put it in.</summary>
    public string? VariableName { get; private set; }

    /// <summary>Whether to keep doing this on every later run.</summary>
    public bool Remember => ChkRemember.IsChecked == true;

    public CaptureWindow(List<string> paths, string body, RequestContext ctx)
    {
        InitializeComponent();
        _body = body;

        LstPaths.ItemsSource = paths;

        // "id" is what a create returns and what the next call needs, so it is
        // the overwhelmingly common choice — start there when it exists.
        LstPaths.SelectedItem = paths.FirstOrDefault(p => p.Equals("id", StringComparison.OrdinalIgnoreCase))
                             ?? paths.FirstOrDefault();

        var existing = string.Join(", ", ctx.Variables.Select(v => v.Name).Where(n => n.Length > 0));
        TxtHint.Text = existing.Length > 0
            ? "Reusing an existing name overwrites it. In use: " + existing
            : "Write {{name}} in any field to use it.";
    }

    private void LstPaths_Changed(object sender, SelectionChangedEventArgs e)
    {
        if (LstPaths.SelectedItem is not string path) return;

        TxtPreview.Text = Variables.Capture(_body, path) ?? "(nothing at that path)";

        // Suggest a name from the path: customer.id becomes customerId, which
        // is both readable and what the next request's field is called.
        if (TxtName.Text.Trim().Length == 0 || TxtName.Tag as string == "auto")
        {
            TxtName.Text = Suggest(path);
            TxtName.Tag = "auto";
        }
    }

    private static string Suggest(string path)
    {
        var parts = path.Replace("[0]", "").Split('.', StringSplitOptions.RemoveEmptyEntries);
        if (parts.Length == 0) return "value";
        if (parts.Length == 1) return parts[0];

        var last = parts[^1];
        var parent = parts[^2];
        return parent + char.ToUpperInvariant(last[0]) + last[1..];
    }

    private void BtnOk_Click(object sender, RoutedEventArgs e)
    {
        if (LstPaths.SelectedItem is not string path) return;

        var name = TxtName.Text.Trim();
        if (name.Length == 0)
        {
            MessageBox.Show(this, "Give the variable a name.", "Capture a value",
                            MessageBoxButton.OK, MessageBoxImage.Information);
            TxtName.Focus();
            return;
        }

        Path = path;
        VariableName = name;
        DialogResult = true;
    }

    private void BtnCancel_Click(object sender, RoutedEventArgs e) => DialogResult = false;
}
