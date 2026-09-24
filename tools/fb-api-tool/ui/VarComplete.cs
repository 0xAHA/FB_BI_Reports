using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.Primitives;
using Avalonia.Input;
using Avalonia.Layout;
using Avalonia.Media;

namespace FbApiTool.Ui;

/// <summary>
/// Variable completion for an ordinary text box.
///
/// Typing <c>{{</c> anywhere — a path parameter, a query value, a header, a
/// body — offers the variables that exist and closes the braces for you. The
/// SQL editor has had this since it was written, because AvaloniaEdit brings a
/// completion window with it; every other field in the tool did not, which
/// meant the feature appeared to work in one place and be missing everywhere
/// else.
///
/// What to offer is <see cref="VarCompletion"/> in the core, shared with the
/// editor and with the WPF build. This file is only the popup.
/// </summary>
public sealed class VarComplete
{
    private readonly TextBox _box;
    private readonly Func<IEnumerable<Variable>> _vars;
    private readonly Popup _popup;
    private readonly ListBox _list;

    /// <summary>True while this class is writing the box, so it ignores itself.</summary>
    private bool _writing;

    public static void Attach(TextBox box, Func<IEnumerable<Variable>> vars) => _ = new VarComplete(box, vars);

    private VarComplete(TextBox box, Func<IEnumerable<Variable>> vars)
    {
        _box = box;
        _vars = vars;

        _list = new ListBox
        {
            MaxHeight = 190,
            BorderThickness = new Thickness(0),
            Background = Brushes.Transparent,
            FontSize = 12.5,
        };
        _list.ItemTemplate = new Avalonia.Controls.Templates.FuncDataTemplate<VarSuggestion>(
            (v, _) => Row(v), true);

        var shell = new Border
        {
            CornerRadius = new CornerRadius(5),
            BorderThickness = new Thickness(1),
            Padding = new Thickness(2),
            Child = _list,
            MinWidth = 220,
        };
        shell.Bind(Border.BackgroundProperty, App.Token("FbBgPrimary"));
        shell.Bind(Border.BorderBrushProperty, App.Token("FbBorderStrong"));

        _popup = new Popup
        {
            Child = shell,
            PlacementTarget = box,
            Placement = PlacementMode.BottomEdgeAlignedLeft,
            // The box keeps focus, so the list is driven from the keyboard
            // without ever taking the caret away from what is being typed.
            IsLightDismissEnabled = false,
        };

        // Parented to the box so the popup inherits the window and the theme.
        ((ISetLogicalParent)_popup).SetParent(box);

        box.GetObservable(TextBox.TextProperty).Subscribe(new Sink(_ => Offer()));
        box.AddHandler(InputElement.KeyDownEvent, OnKey, Avalonia.Interactivity.RoutingStrategies.Tunnel);
        box.LostFocus += (_, _) => Close();

        // A click still has to work: the box keeps focus, so accepting has to
        // come off the pointer rather than off a selection change.
        _list.PointerReleased += (_, _) => Accept();
    }

    private static Control Row(VarSuggestion? v)
    {
        var name = new TextBlock
        {
            Text = "{{" + (v?.Name ?? "") + "}}",
            FontSize = 12.5,
            VerticalAlignment = VerticalAlignment.Center,
        };
        name.Bind(TextBlock.FontFamilyProperty, App.Token("FbMono"));

        var preview = new TextBlock
        {
            Text = v?.Preview ?? "",
            FontSize = 11,
            VerticalAlignment = VerticalAlignment.Center,
            TextTrimming = TextTrimming.CharacterEllipsis,
            MaxWidth = 200,
        };
        preview.Bind(TextBlock.ForegroundProperty, App.Token("FbTextMuted"));

        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 9 };
        row.Children.Add(name);
        row.Children.Add(preview);
        return row;
    }

    /// <summary>
    /// Show the list when the caret is inside a {{token}}, and close it the
    /// moment it is not.
    /// </summary>
    private void Offer()
    {
        if (_writing) return;

        var text = _box.Text ?? "";
        var caret = Math.Clamp(_box.CaretIndex, 0, text.Length);

        if (VarCompletion.TokenAt(text, caret) is not { } token) { Close(); return; }

        var matches = VarCompletion.Matches(token.Prefix, _vars());
        if (matches.Count == 0) { Close(); return; }

        _list.ItemsSource = matches;
        _list.SelectedIndex = 0;
        _popup.IsOpen = true;
    }

    private void OnKey(object? sender, KeyEventArgs e)
    {
        // The second brace closes its own pair, whether or not there is
        // anything to suggest yet — so {{ is never left hanging open.
        if (e.Key is Key.OemOpenBrackets && (e.KeyModifiers & KeyModifiers.Shift) != 0)
        {
            CloseBraces();
            return;
        }

        if (!_popup.IsOpen) return;

        switch (e.Key)
        {
            case Key.Down:
                Move(1);
                e.Handled = true;
                break;

            case Key.Up:
                Move(-1);
                e.Handled = true;
                break;

            // Tab accepts, matching the SQL editor. Enter has to stay Enter:
            // it sends the request from every other field, and a list that
            // appears while typing must not quietly take that over.
            case Key.Tab:
                Accept();
                e.Handled = true;
                break;

            case Key.Escape:
                Close();
                e.Handled = true;
                break;
        }
    }

    private void Move(int by)
    {
        var count = _list.ItemCount;
        if (count == 0) return;
        _list.SelectedIndex = ((_list.SelectedIndex + by) % count + count) % count;
        _list.ScrollIntoView(_list.SelectedIndex);
    }

    /// <summary>
    /// Close the pair the moment the second brace is typed.
    ///
    /// Posted, because the key has not reached the box yet: doing it inline
    /// would insert the closing braces before the one being typed.
    /// </summary>
    private void CloseBraces() => Avalonia.Threading.Dispatcher.UIThread.Post(() =>
    {
        var text = _box.Text ?? "";
        var caret = Math.Clamp(_box.CaretIndex, 0, text.Length);

        if (caret < 2 || text[caret - 1] != '{' || text[caret - 2] != '{') return;
        if (text.Length >= caret + 2 && text[caret..(caret + 2)] == "}}") return;

        _writing = true;
        _box.Text = text[..caret] + "}}" + text[caret..];
        _box.CaretIndex = caret;
        _writing = false;

        Offer();
    });

    private void Accept()
    {
        if (_list.SelectedItem is not VarSuggestion pick) { Close(); return; }

        var text = _box.Text ?? "";
        var caret = Math.Clamp(_box.CaretIndex, 0, text.Length);

        var (built, at) = VarCompletion.Insert(text, caret, pick.Name);

        _writing = true;
        _box.Text = built;
        _box.CaretIndex = Math.Clamp(at, 0, built.Length);
        _writing = false;

        Close();
        _box.Focus();
    }

    private void Close() => _popup.IsOpen = false;

    /// <summary>A minimal observer, so one subscription needs no Rx package.</summary>
    private sealed class Sink(Action<string?> then) : IObserver<string?>
    {
        public void OnNext(string? value) => then(value);
        public void OnCompleted() { }
        public void OnError(Exception error) { }
    }
}
