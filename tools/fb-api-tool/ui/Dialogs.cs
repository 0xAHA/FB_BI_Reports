using Avalonia.Controls;
using Avalonia.Layout;
using Avalonia.Media;

namespace FbApiTool.Ui;

/// <summary>
/// The small dialogs: a yes/no, a message and a one-line input.
///
/// Avalonia ships no MessageBox, which is usually treated as a gap to fill
/// with a package. Three windows built here is less code than a dependency,
/// and they inherit the tool's own styling rather than arriving with their
/// own.
///
/// All three are awaited. Nothing in this toolkit can show a modal and return
/// an answer on the spot, which is why RequestContext asks for a Task.
/// </summary>
public static class Dialogs
{
    public static async Task<bool> ConfirmAsync(Window owner, string title, string message,
                                                string yes = "Yes", string no = "No")
    {
        var answer = false;

        var ok = new Button { Content = yes, MinWidth = 96 };
        var cancel = new Button { Content = no, MinWidth = 96 };
        ok.Classes.Add("primary");
        cancel.Classes.Add("tool");

        var w = Shell(owner, title, message, [cancel, ok]);

        ok.Click += (_, _) => { answer = true; w.Close(); };
        cancel.Click += (_, _) => w.Close();

        await w.ShowDialog(owner);
        return answer;
    }

    public static async Task TellAsync(Window owner, string title, string message)
    {
        var ok = new Button { Content = "OK", MinWidth = 96 };
        ok.Classes.Add("primary");

        var w = Shell(owner, title, message, [ok]);
        ok.Click += (_, _) => w.Close();

        await w.ShowDialog(owner);
    }

    /// <summary>A one-line input. Returns null when cancelled.</summary>
    public static async Task<string?> AskAsync(Window owner, string title, string label, string initial)
    {
        string? answer = null;

        var box = new TextBox { Text = initial, Margin = new Avalonia.Thickness(0, 8, 0, 0) };
        var ok = new Button { Content = "Save", MinWidth = 96 };
        var cancel = new Button { Content = "Cancel", MinWidth = 96 };
        ok.Classes.Add("primary");
        cancel.Classes.Add("tool");

        var w = Shell(owner, title, label, [cancel, ok], box);

        void Accept()
        {
            answer = box.Text;
            w.Close();
        }

        ok.Click += (_, _) => Accept();
        cancel.Click += (_, _) => w.Close();
        box.KeyDown += (_, e) =>
        {
            if (e.Key == Avalonia.Input.Key.Enter) Accept();
            if (e.Key == Avalonia.Input.Key.Escape) w.Close();
        };

        w.Opened += (_, _) => { box.Focus(); box.SelectAll(); };

        await w.ShowDialog(owner);
        return string.IsNullOrWhiteSpace(answer) ? null : answer!.Trim();
    }

    // ── THE SHARED SHELL ────────────────────────────────────────────────

    private static Window Shell(Window owner, string title, string message,
                                IReadOnlyList<Button> buttons, Control? extra = null)
    {
        var body = new StackPanel { Spacing = 0 };
        body.Children.Add(new TextBlock
        {
            Text = message,
            TextWrapping = TextWrapping.Wrap,
            FontSize = 13,
        });
        if (extra is not null) body.Children.Add(extra);

        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            HorizontalAlignment = HorizontalAlignment.Right,
            Spacing = 8,
        };
        foreach (var b in buttons) row.Children.Add(b);

        var foot = new Border
        {
            Background = Brand.Panel,
            BorderBrush = Brand.Border,
            BorderThickness = new Avalonia.Thickness(0, 1, 0, 0),
            Padding = new Avalonia.Thickness(18, 12),
            Child = row,
        };

        var dock = new DockPanel();
        DockPanel.SetDock(foot, Dock.Bottom);
        dock.Children.Add(foot);
        dock.Children.Add(new Border
        {
            Padding = new Avalonia.Thickness(18, 16),
            Child = body,
        });

        return new Window
        {
            Title = title,
            Content = dock,
            Width = 430,
            SizeToContent = SizeToContent.Height,
            CanResize = false,
            WindowStartupLocation = WindowStartupLocation.CenterOwner,
            ShowInTaskbar = false,
            Icon = owner.Icon,
        };
    }
}
