using Avalonia;
using Avalonia.Controls;
using Avalonia.Layout;
using Avalonia.Media;

namespace FbApiTool.Ui;

/// <summary>What the capture dialog came back with.</summary>
public sealed record CapturePick(string Path, string Name, bool Remember);

/// <summary>
/// Putting a value from a response into a variable.
///
/// This is what turns a list of endpoints into a sequence: create a sales
/// order, capture its id, and the next request can address it. Typing the id
/// across by hand works exactly once, and is wrong the moment anything is
/// re-run against a different server.
///
/// Built in code rather than in markup, like the other dialogs here — the
/// window is three fields and a list, and a .axaml file for it would be more
/// plumbing than content.
/// </summary>
public static class CaptureDialog
{
    public static async Task<CapturePick?> ShowAsync(Window owner, List<string> paths, string json)
    {
        CapturePick? picked = null;

        var mono = Brand.Mono;

        var list = new ListBox
        {
            ItemsSource = paths,
            FontFamily = mono,
            FontSize = 12.5,
            Background = Brand.Panel,
            BorderBrush = Brand.Border,
            BorderThickness = new Avalonia.Thickness(1),
            Height = 210,
        };

        var preview = new TextBox
        {
            IsReadOnly = true,
            FontFamily = mono,
            FontSize = 12.5,
            TextWrapping = TextWrapping.Wrap,
            MaxHeight = 70,
            AcceptsReturn = true,
        };

        var name = new TextBox { FontFamily = mono, FontSize = 13 };

        // Only replace a name the dialog itself proposed. Once it has been
        // typed over, moving down the list must not quietly rename it back.
        var nameIsOurs = true;
        name.GetObservable(TextBox.TextProperty).Subscribe(new Watch(() =>
        {
            if (!_settingName) nameIsOurs = false;
        }));

        var hint = new TextBlock
        {
            FontSize = 11.5,
            TextWrapping = TextWrapping.Wrap,
            Foreground = Brand.Muted,
            Margin = new Avalonia.Thickness(2, 6, 0, 0),
        };

        list.SelectionChanged += (_, _) =>
        {
            if (list.SelectedItem is not string path) return;

            var value = Variables.Capture(json, path);
            preview.Text = value ?? "(no value at that path)";

            if (nameIsOurs)
            {
                _settingName = true;
                name.Text = Variables.SuggestName(path);
                _settingName = false;
            }

            hint.Text = "Write {{" + (name.Text ?? "") + "}} in any field to use it.";
        };

        var remember = new CheckBox
        {
            Content = "Do this automatically from now on",
            VerticalAlignment = VerticalAlignment.Center,
        };
        ToolTip.SetTip(remember,
            "Runs every time this request succeeds, so a sequence keeps itself up to date.");

        var ok = new Button { Content = "Capture", MinWidth = 106 };
        var cancel = new Button { Content = "Cancel", MinWidth = 96 };
        ok.Classes.Add("primary");
        cancel.Classes.Add("tool");

        var window = Build(owner, list, preview, name, hint, remember, [cancel, ok]);

        ok.Click += (_, _) =>
        {
            if (list.SelectedItem is not string path) { hint.Text = "Pick a field first."; return; }

            var chosen = (name.Text ?? "").Trim();
            if (chosen.Length == 0) { hint.Text = "Give the variable a name."; name.Focus(); return; }

            picked = new CapturePick(path, chosen, remember.IsChecked == true);
            window.Close();
        };
        cancel.Click += (_, _) => window.Close();

        if (paths.Count > 0) list.SelectedIndex = 0;

        await window.ShowDialog(owner);
        return picked;
    }

    /// <summary>True while the dialog is writing the name box itself.</summary>
    private static bool _settingName;

    private static Window Build(Window owner, Control list, Control preview, Control name,
                                Control hint, Control remember, IReadOnlyList<Button> buttons)
    {
        var head = new Border
        {
            Background = Brand.BrandBar,
            Padding = new Avalonia.Thickness(20, 14),
            Child = new StackPanel
            {
                Spacing = 3,
                Children =
                {
                    new TextBlock
                    {
                        Text = "Capture a value",
                        Foreground = Brand.OnBrand,
                        FontSize = 18,
                        FontWeight = FontWeight.SemiBold,
                    },
                    new TextBlock
                    {
                        Text = "Put something from this response into a variable, so the next "
                             + "request can use it.",
                        Foreground = Brand.OnBrandSub,
                        FontSize = 13,
                        TextWrapping = TextWrapping.Wrap,
                    },
                },
            },
        };

        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            HorizontalAlignment = HorizontalAlignment.Right,
            Spacing = 8,
        };
        foreach (var b in buttons) row.Children.Add(b);

        var footDock = new DockPanel();
        DockPanel.SetDock(remember, Dock.Left);
        footDock.Children.Add(remember);
        footDock.Children.Add(row);

        var foot = new Border
        {
            Background = Brand.Panel,
            BorderBrush = Brand.Border,
            BorderThickness = new Avalonia.Thickness(0, 1, 0, 0),
            Padding = new Avalonia.Thickness(20, 12),
            Child = footDock,
        };

        var body = new StackPanel { Spacing = 5, Margin = new Avalonia.Thickness(20, 16, 20, 12) };
        body.Children.Add(Label("FIELD"));
        body.Children.Add(list);
        body.Children.Add(Label("VALUE", 10));
        body.Children.Add(preview);
        body.Children.Add(Label("VARIABLE NAME", 10));
        body.Children.Add(name);
        body.Children.Add(hint);

        var dock = new DockPanel();
        DockPanel.SetDock(head, Dock.Top);
        DockPanel.SetDock(foot, Dock.Bottom);
        dock.Children.Add(head);
        dock.Children.Add(foot);
        dock.Children.Add(body);

        return new Window
        {
            Title = "Capture a value",
            Content = dock,
            Width = 580,
            Height = 520,
            CanResize = false,
            WindowStartupLocation = WindowStartupLocation.CenterOwner,
            ShowInTaskbar = false,
            Icon = owner.Icon,
        };
    }

    private static TextBlock Label(string text, double top = 0) => new()
    {
        Text = text,
        Classes = { "label" },
        Margin = new Avalonia.Thickness(0, top, 0, 0),
    };

    /// <summary>A minimal observer, so one subscription needs no Rx package.</summary>
    private sealed class Watch(Action then) : IObserver<string?>
    {
        public void OnNext(string? value) => then();
        public void OnCompleted() { }
        public void OnError(Exception error) { }
    }
}
