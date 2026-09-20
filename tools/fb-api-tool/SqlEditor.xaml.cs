using System.Text;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Documents;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Threading;

namespace FbApiTool;

/// <summary>
/// A SQL editor that colours what you type and completes keywords.
///
/// Built on RichTextBox rather than the transparent-overlay trick the web
/// version uses — a TextBox cannot colour its own text, and layering a
/// transparent one over a rendered copy means keeping two text layouts in exact
/// agreement about wrapping, padding and line height. One layout cannot drift
/// out of alignment with itself.
///
/// Re-colouring rebuilds the document, which would fight the caret if it ran on
/// every keystroke, so it runs on a short idle instead. The caret is restored by
/// CHARACTER offset: the document's own TextPointers are invalidated by the
/// rebuild, so they cannot be carried across it.
/// </summary>
public partial class SqlEditor : UserControl
{
    private readonly DispatcherTimer _idle = new() { Interval = TimeSpan.FromMilliseconds(250) };

    /// <summary>
    /// Where the table and column names come from. Set by the host once a
    /// connection exists; until then completion is keywords only, which is
    /// the least useful kind — nobody forgets SELECT.
    /// </summary>
    public Func<DbSchema.Snapshot?>? SchemaSource { get; set; }

    /// <summary>
    /// The variables that can be written into a statement. A query is as
    /// likely to want an id threaded in from an earlier call as a request is,
    /// and retyping the same part id into six statements is how the sixth one
    /// ends up querying a different part.
    /// </summary>
    public Func<IEnumerable<Variable>>? VariableSource { get; set; }
    private bool _suppress;

    private static readonly Brush Keyword = Freeze("#845EEB");   // --acc-purple
    private static readonly Brush StringLit = Freeze("#1B7A46"); // --fb-success
    private static readonly Brush Number = Freeze("#1e7bb4");    // --fb-blue-accent
    private static readonly Brush Comment = Freeze("#8FA1A7");   // --c-tertiary
    private static readonly Brush Plain = Freeze("#101010");     // --c-primary

    /// <summary>The fallback list, used until a schema has been read.</summary>
    private static readonly string[] Completions =
        [.. SqlHighlighter.Keywords.OrderBy(k => k, StringComparer.OrdinalIgnoreCase)];

    public SqlEditor()
    {
        InitializeComponent();
        _idle.Tick += (_, _) => { _idle.Stop(); Recolour(); };
    }

    private static Brush Freeze(string hex)
    {
        var b = new SolidColorBrush((Color)ColorConverter.ConvertFromString(hex));
        b.Freeze();                                 // shared across every instance
        return b;
    }

    /// <summary>Raised when the user changes the text, not when it is recoloured.</summary>
    public event EventHandler? TextChanged;

    public string Text
    {
        get => Plainly(Box.Document);
        set
        {
            _suppress = true;
            Build(value ?? "");
            _suppress = false;
            HideSuggestions();
            TextChanged?.Invoke(this, EventArgs.Empty);
        }
    }

    public void Clear() => Text = "";

    /// <summary>
    /// Insert text where the caret is, leaving the caret after it.
    ///
    /// A space is added in front unless the character there is already a
    /// separator: pasting a table name straight onto the end of the
    /// previous word produces something that quietly will not parse.
    /// </summary>
    public void InsertAtCaret(string text)
    {
        if (string.IsNullOrEmpty(text)) return;

        var all = Text;
        var at = Math.Clamp(CaretOffset(), 0, all.Length);

        var before = at > 0 ? all[at - 1] : ' ';
        var needsSpace = !char.IsWhiteSpace(before) && before is not ('(' or ',' or '.');
        var insert = (needsSpace ? " " : "") + text;

        _suppress = true;
        Build(all[..at] + insert + all[at..]);
        SetCaret(at + insert.Length);
        _suppress = false;

        TextChanged?.Invoke(this, EventArgs.Empty);
    }

    public new void Focus() => Box.Focus();

    private void Box_TextChanged(object sender, TextChangedEventArgs e)
    {
        if (_suppress) return;
        TextChanged?.Invoke(this, EventArgs.Empty);
        _idle.Stop();
        _idle.Start();
        ShowSuggestions();
    }

    /// <summary>Re-colour in place, putting the caret back where it was.</summary>
    public void Recolour()
    {
        if (_suppress) return;
        var caret = CaretOffset();
        var text = Plainly(Box.Document);

        _suppress = true;
        Build(text);
        SetCaret(caret);
        _suppress = false;
    }

    // ── COMPLETION ──────────────────────────────────────────────────────

    /// <summary>
    /// What is being typed: the partial word, and the qualifier in front of
    /// it when there is one — so "soitem." offers that table’s columns
    /// rather than every column in the database.
    /// </summary>
    private (string Qualifier, string Prefix) WordBeforeCaret()
    {
        var line = LineBeforeCaret();
        if (line.Length == 0) return ("", "");

        var i = line.Length;
        while (i > 0 && (char.IsLetterOrDigit(line[i - 1]) || line[i - 1] == '_')) i--;
        var prefix = line[i..];

        if (i == 0 || line[i - 1] != '.') return ("", prefix);

        var j = i - 1;
        while (j > 0 && (char.IsLetterOrDigit(line[j - 1]) || line[j - 1] == '_')) j--;
        return (line[j..(i - 1)], prefix);
    }

    /// <summary>
    /// The text on the caret’s line, up to the caret.
    ///
    /// Assembled from every run before the caret, not just the one it sits
    /// in: runs are split by colour, so "soitem" and "." land in different
    /// runs and reading only the current one would never see the qualifier.
    /// </summary>
    private string LineBeforeCaret()
    {
        var caret = Box.CaretPosition;
        if (caret.Parent is not Run run) return "";

        var upto = run.ContentStart.GetOffsetToPosition(caret);
        if (upto < 0 || upto > run.Text.Length) return "";

        var sb = new StringBuilder();
        if (run.Parent is Paragraph p)
            foreach (var inline in p.Inlines)
            {
                if (ReferenceEquals(inline, run)) break;
                if (inline is Run r) sb.Append(r.Text);
            }

        sb.Append(run.Text[..upto]);
        return sb.ToString();
    }

    /// <summary>
    /// The second brace closes its own pair, exactly as it does in the plain
    /// fields. A placeholder missing one of its braces is sent literally, and
    /// MySQL's complaint about it says nothing about braces.
    /// </summary>
    private void Box_PreviewTextInput(object sender, TextCompositionEventArgs e)
    {
        if (e.Text != "{") return;

        var text = Text;
        var caret = CaretOffset();
        if (caret == 0 || caret > text.Length || text[caret - 1] != '{') return;

        var closing = text.AsSpan(caret).StartsWith("}}") ? "" : "}}";

        _suppress = true;
        Build(text[..caret] + "{" + closing + text[caret..]);
        SetCaret(caret + 1);
        _suppress = false;

        e.Handled = true;
        TextChanged?.Invoke(this, EventArgs.Empty);
        ShowSuggestions();
    }

    /// <summary>
    /// The variables offered when the caret is inside a placeholder, or null
    /// when it is not — in which case the ordinary SQL completion runs.
    /// </summary>
    private List<SqlCompletion>? VariableMatches()
    {
        if (VariableSource is null) return null;
        if (VarCompletion.TokenAt(Text, CaretOffset()) is not { } token) return null;

        return [.. VarCompletion.Matches(token.Prefix, VariableSource())
                     .Select(v => new SqlCompletion(v.Name, SqlItemKind.Variable,
                                                    Variables.Preview(v.Preview, 26)))];
    }

    private void ShowSuggestions()
    {
        // Inside {{ }} nothing else can be meant, so the schema is not consulted.
        if (VariableMatches() is { } vars)
        {
            if (vars.Count == 0) { HideSuggestions(); return; }
            Offer(vars);
            return;
        }

        var (qualifier, word) = WordBeforeCaret();

        // After a qualifier and a dot, offer straight away: the list is one
        // table’s columns and is short. Otherwise wait for two letters —
        // one would match a third of the keywords and read as a menu.
        if (qualifier.Length == 0 && word.Length < 2) { HideSuggestions(); return; }

        var matches = DbSchema.Suggest(SchemaSource?.Invoke(), Text, qualifier, word,
                                       before: LineBeforeCaret());

        // No schema yet, or nothing matched: fall back to the keywords.
        if (matches.Count == 0 && qualifier.Length == 0)
            matches = [.. Completions.Where(k => k.StartsWith(word, StringComparison.OrdinalIgnoreCase))
                          .Take(12)
                          .Select(k => new SqlCompletion(k.ToUpperInvariant(), SqlItemKind.Keyword, "keyword"))];

        // Nothing to offer if the word already is the only match.
        if (matches.Count == 0 ||
            (matches.Count == 1 && matches[0].Text.Equals(word, StringComparison.OrdinalIgnoreCase)))
        { HideSuggestions(); return; }

        Offer(matches);
    }

    private void Offer(IReadOnlyList<SqlCompletion> matches)
    {
        SuggestList.ItemsSource = matches;
        SuggestList.SelectedIndex = 0;

        // Anchor under the caret, not at a corner of the control.
        var rect = Box.CaretPosition.GetCharacterRect(LogicalDirection.Forward);
        Suggestions.HorizontalOffset = rect.Left;
        Suggestions.VerticalOffset = rect.Bottom + 2;
        Suggestions.IsOpen = true;
    }

    private void HideSuggestions() => Suggestions.IsOpen = false;

    private void Box_LostFocus(object sender, KeyboardFocusChangedEventArgs e)
    {
        // Not when the focus is going INTO the list. A popup is its own window,
        // so clicking one takes keyboard focus off the editor — and hiding on
        // that closed the list under the pointer before the click could land.
        if (SuggestList.IsMouseOver) return;
        HideSuggestions();
    }

    /// <summary>
    /// Clicking a suggestion takes it.
    ///
    /// On the way DOWN, and on the Preview pass: by mouse-up the editor has
    /// already lost keyboard focus to the popup's own window, and the plain
    /// MouseLeftButtonUp on the list never fired at all because ListBoxItem
    /// marks that event handled on its way up.
    ///
    /// The row under the pointer is selected first. The list is not focusable,
    /// so a click can land on a row that was never made current, and accepting
    /// blind would insert whichever one the keyboard had highlighted.
    /// </summary>
    private void SuggestList_Click(object sender, MouseButtonEventArgs e)
    {
        if (Rows.Clicked(SuggestList, e.OriginalSource) is { } row) SuggestList.SelectedItem = row;
        if (SuggestList.SelectedItem is not null) Accept();
        e.Handled = true;
    }

    private void Box_PreviewKeyDown(object sender, KeyEventArgs e)
    {
        if (!Suggestions.IsOpen)
        {
            // Ctrl+Space asks for the list without waiting for a second letter.
            if (e.Key == Key.Space && (Keyboard.Modifiers & ModifierKeys.Control) != 0)
            {
                ShowSuggestions();
                e.Handled = true;
            }
            return;
        }

        switch (e.Key)
        {
            case Key.Down:
                SuggestList.SelectedIndex = Math.Min(SuggestList.SelectedIndex + 1, SuggestList.Items.Count - 1);
                SuggestList.ScrollIntoView(SuggestList.SelectedItem);
                e.Handled = true;
                break;

            case Key.Up:
                SuggestList.SelectedIndex = Math.Max(SuggestList.SelectedIndex - 1, 0);
                SuggestList.ScrollIntoView(SuggestList.SelectedItem);
                e.Handled = true;
                break;

            // Tab accepts, and ONLY Tab. Enter has to stay a new line even
            // with the list open: a suggestion appears after two letters, so
            // binding Enter means every line break that happens to follow a
            // word gets turned into a completion nobody asked for.
            case Key.Tab:
                Accept();
                e.Handled = true;
                break;

            // Typing on past the list is the common case; let the newline
            // through and get out of the way.
            case Key.Enter:
                HideSuggestions();
                break;

            case Key.Escape:
                HideSuggestions();
                e.Handled = true;
                break;
        }
    }

    /// <summary>Replace the part-typed word with the highlighted completion.</summary>
    private void Accept()
    {
        if (SuggestList.SelectedItem is not SqlCompletion pick) { HideSuggestions(); return; }
        var chosen = pick.Text;

        // A variable replaces the whole {{ }}, braces included, so it cannot
        // go through the word-before-the-caret path.
        if (pick.Kind == SqlItemKind.Variable)
        {
            var (built, after) = VarCompletion.Insert(Text, CaretOffset(), chosen);
            HideSuggestions();

            _suppress = true;
            Build(built);
            SetCaret(after);
            _suppress = false;

            TextChanged?.Invoke(this, EventArgs.Empty);
            Box.Focus();
            return;
        }

        var (_, word) = WordBeforeCaret();
        HideSuggestions();

        // Rebuilding from text keeps this in one place: edit the plain string,
        // then re-render and put the caret after what was inserted.
        var text = Plainly(Box.Document);
        var caret = CaretOffset();
        var start = caret - word.Length;
        if (start < 0 || start + word.Length > text.Length) return;

        var replaced = text[..start] + chosen + text[(start + word.Length)..];

        _suppress = true;
        Build(replaced);
        SetCaret(start + chosen.Length);
        _suppress = false;

        TextChanged?.Invoke(this, EventArgs.Empty);
        Box.Focus();
    }

    // ── DOCUMENT ────────────────────────────────────────────────────────

    private void Build(string text)
    {
        var doc = new FlowDocument
        {
            PageWidth = double.NaN,
            FontFamily = Box.FontFamily,
            FontSize = Box.FontSize,
        };

        foreach (var line in (text ?? "").Replace("\r\n", "\n").Replace('\r', '\n').Split('\n'))
        {
            var p = new Paragraph { Margin = new Thickness(0) };
            // Even a blank line needs a run, or there is no position to put a
            // caret at and the offset maths loses a line.
            if (line.Length == 0) p.Inlines.Add(new Run(""));
            else foreach (var t in SqlHighlighter.Tokenize(line)) p.Inlines.Add(Paint(t));
            doc.Blocks.Add(p);
        }

        Box.Document = doc;
    }

    private static Run Paint(SqlToken t)
    {
        var run = new Run(t.Text);
        switch (t.Kind)
        {
            case SqlTokenKind.Keyword:
                run.Foreground = Keyword;
                run.FontWeight = FontWeights.SemiBold;
                break;
            case SqlTokenKind.String: run.Foreground = StringLit; break;
            case SqlTokenKind.Number: run.Foreground = Number; break;
            case SqlTokenKind.Comment:
                run.Foreground = Comment;
                run.FontStyle = FontStyles.Italic;
                break;
            default: run.Foreground = Plain; break;
        }
        return run;
    }

    /// <summary>The document's text, with one newline per paragraph.</summary>
    private static string Plainly(FlowDocument doc)
    {
        var sb = new StringBuilder();
        var first = true;
        foreach (var block in doc.Blocks)
        {
            if (!first) sb.Append('\n');
            first = false;
            if (block is not Paragraph p) continue;
            foreach (var inline in p.Inlines)
                if (inline is Run r) sb.Append(r.Text);
        }
        return sb.ToString();
    }

    // ── CARET ───────────────────────────────────────────────────────────

    /// <summary>Where the caret is, counted in characters of <see cref="Text"/>.</summary>
    private int CaretOffset()
    {
        var caret = Box.CaretPosition;
        var n = 0;
        var first = true;

        foreach (var block in Box.Document.Blocks)
        {
            if (!first) n++;                       // the newline between paragraphs
            first = false;
            if (block is not Paragraph p) continue;

            foreach (var inline in p.Inlines)
            {
                if (inline is not Run r) continue;
                if (caret.CompareTo(r.ContentStart) >= 0 && caret.CompareTo(r.ContentEnd) <= 0)
                    return n + Math.Clamp(r.ContentStart.GetOffsetToPosition(caret), 0, r.Text.Length);
                n += r.Text.Length;
            }
        }
        return n;
    }

    private void SetCaret(int offset)
    {
        var n = 0;
        var first = true;

        foreach (var block in Box.Document.Blocks)
        {
            if (!first) n++;
            first = false;
            if (block is not Paragraph p) continue;

            foreach (var inline in p.Inlines)
            {
                if (inline is not Run r) continue;
                if (offset <= n + r.Text.Length)
                {
                    var at = r.ContentStart.GetPositionAtOffset(Math.Max(0, offset - n));
                    if (at is not null) { Box.CaretPosition = at; return; }
                }
                n += r.Text.Length;
            }
        }
        Box.CaretPosition = Box.Document.ContentEnd;
    }
}
