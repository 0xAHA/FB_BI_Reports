using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Input;

namespace FbApiTool;

/// <summary>
/// Completion for <c>{{name}}</c> in an ordinary text field.
///
/// Two small things, for the same reason. Typing <c>{{</c> closes its own
/// braces, and then offers the variables that exist. A placeholder is only
/// useful if it matches a name exactly, and the names live in a panel at the
/// other end of the window — so the alternative is remembering them, and a
/// near miss fails silently at send time rather than while you are typing.
/// </summary>
public sealed class VarComplete
{
    private readonly Popup _popup;
    private readonly ListBox _list;
    private readonly Func<IEnumerable<Variable>> _source;
    private TextBox? _box;

    public VarComplete(Popup popup, ListBox list, Func<IEnumerable<Variable>> source)
    {
        _popup = popup;
        _list = list;
        _source = source;
        // On the way down: by mouse-up the field has already lost keyboard
        // focus to the popup's own window, which hid the list out from under
        // the pointer. The row clicked is selected first, because the list is
        // not focusable and accepting blind would take whichever row the
        // keyboard had highlighted instead.
        _list.PreviewMouseLeftButtonDown += (_, e) =>
        {
            if (Rows.Clicked(_list, e.OriginalSource) is { } row) _list.SelectedItem = row;
            if (_list.SelectedItem is not null) Accept();
            e.Handled = true;
        };
    }

    /// <summary>Wire one field up. Safe to call on any plain TextBox.</summary>
    public void Attach(TextBox box)
    {
        box.PreviewTextInput += Box_PreviewTextInput;
        box.PreviewKeyDown += Box_PreviewKeyDown;
        box.LostKeyboardFocus += (_, _) =>
        {
            if (_list.IsMouseOver) return;
            if (ReferenceEquals(_box, box)) Hide();
        };
        box.SelectionChanged += (_, _) => { if (_popup.IsOpen && ReferenceEquals(_box, box)) Refresh(box); };
    }

    /// <summary>
    /// The second brace closes its own pair.
    ///
    /// Without it the closing braces are typed by hand every time, and a
    /// placeholder missing one of them reads as ordinary text and is sent
    /// literally — which is a confusing thing to find in a URL.
    /// </summary>
    private void Box_PreviewTextInput(object sender, TextCompositionEventArgs e)
    {
        if (sender is not TextBox box || e.Text != "{") return;

        var caret = box.CaretIndex;
        if (box.SelectionLength > 0 || caret == 0 || box.Text[caret - 1] != '{') return;

        // Unless they are already there.
        var closing = box.Text.AsSpan(caret).StartsWith("}}") ? "" : "}}";

        box.Text = box.Text[..caret] + "{" + closing + box.Text[caret..];
        box.CaretIndex = caret + 1;
        e.Handled = true;

        Show(box);
    }

    private void Box_PreviewKeyDown(object sender, KeyEventArgs e)
    {
        if (sender is not TextBox box) return;

        if (!_popup.IsOpen)
        {
            // Ctrl+Space asks for the list inside a placeholder already typed.
            if (e.Key == Key.Space && (Keyboard.Modifiers & ModifierKeys.Control) != 0)
            {
                Show(box);
                e.Handled = VarCompletion.TokenAt(box.Text, box.CaretIndex) is not null;
            }
            return;
        }

        switch (e.Key)
        {
            case Key.Down:
                _list.SelectedIndex = Math.Min(_list.SelectedIndex + 1, _list.Items.Count - 1);
                _list.ScrollIntoView(_list.SelectedItem);
                e.Handled = true;
                break;

            case Key.Up:
                _list.SelectedIndex = Math.Max(_list.SelectedIndex - 1, 0);
                _list.ScrollIntoView(_list.SelectedItem);
                e.Handled = true;
                break;

            // Tab accepts, and only Tab — the same rule the SQL editor follows.
            // Enter belongs to Send from every field in this window, and taking
            // it here would turn an ordinary send into a completion.
            case Key.Tab:
                Accept();
                e.Handled = true;
                break;

            case Key.Enter:
                Hide();
                break;

            case Key.Escape:
                Hide();
                e.Handled = true;
                break;
        }
    }

    private void Show(TextBox box)
    {
        _box = box;
        Refresh(box);
    }

    private void Refresh(TextBox box)
    {
        if (VarCompletion.TokenAt(box.Text, box.CaretIndex) is not { } token) { Hide(); return; }

        var matches = VarCompletion.Matches(token.Prefix, _source());
        if (matches.Count == 0) { Hide(); return; }

        _list.ItemsSource = matches;
        _list.SelectedIndex = 0;

        // Under the caret, not at a corner of the field.
        var rect = box.GetRectFromCharacterIndex(box.CaretIndex);
        _popup.PlacementTarget = box;
        _popup.Placement = PlacementMode.Relative;
        _popup.HorizontalOffset = double.IsInfinity(rect.Left) ? 0 : rect.Left;
        _popup.VerticalOffset = double.IsInfinity(rect.Bottom) ? box.ActualHeight : rect.Bottom + 2;
        _popup.IsOpen = true;
    }

    private void Hide() => _popup.IsOpen = false;

    private void Accept()
    {
        if (_box is not { } box || _list.SelectedItem is not VarSuggestion pick) { Hide(); return; }

        var (text, caret) = VarCompletion.Insert(box.Text, box.CaretIndex, pick.Name);
        Hide();

        box.Text = text;
        box.CaretIndex = Math.Min(caret, box.Text.Length);
        box.Focus();
    }
}
