using Avalonia;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Layout;
using Avalonia.Media;
using AvaloniaEdit;
using AvaloniaEdit.CodeCompletion;
using AvaloniaEdit.Document;
using AvaloniaEdit.Editing;
using AvaloniaEdit.Rendering;

namespace FbApiTool.Ui;

/// <summary>
/// A SQL editor that colours what you type and completes against the schema.
///
/// Built on AvaloniaEdit, which is a real code editor: it owns the document,
/// the caret and the completion window. The WPF build had to do all three by
/// hand against a RichTextBox — rebuilding the document on an idle timer and
/// restoring the caret by character offset, because a rebuild invalidates
/// every TextPointer. None of that is needed here, so this file is about a
/// third the size of the one it replaces and has none of its caret arithmetic.
///
/// What it does NOT own is what to offer. That is SqlContext and DbSchema in
/// the core, unchanged and shared with the WPF build: where the caret is, and
/// which tables, views, columns and variables make sense there.
/// </summary>
public sealed class SqlEditor : UserControl
{
    private readonly TextEditor _editor = new();
    private CompletionWindow? _completion;

    /// <summary>
    /// Where table and column names come from. Set by the host once a
    /// connection exists; until then completion is keywords only, which is the
    /// least useful kind — nobody forgets SELECT.
    /// </summary>
    public Func<DbSchema.Snapshot?>? SchemaSource { get; set; }

    /// <summary>
    /// The variables that can be written into a statement. A query is as
    /// likely to want an id threaded in from an earlier call as a request is.
    /// </summary>
    public Func<IEnumerable<Variable>>? VariableSource { get; set; }

    public event EventHandler? TextChanged;

    public string Text
    {
        get => _editor.Document.Text;
        set => _editor.Document.Text = value ?? "";
    }

    public SqlEditor()
    {
        _editor.ShowLineNumbers = false;
        _editor.WordWrap = false;
        _editor.FontFamily = Brand.Mono;
        _editor.FontSize = 13;
        // Bound, not assigned. A colour set once here keeps the value it had
        // when the control was built, so an editor opened in light mode
        // stayed white after the theme was switched under it.
        _editor.Bind(BackgroundProperty, App.Token("FbBgPrimary"));
        _editor.Bind(ForegroundProperty, App.Token("FbText"));
        _editor.Padding = new Thickness(8, 6);
        _editor.Options.EnableHyperlinks = false;
        _editor.Options.EnableEmailHyperlinks = false;
        _editor.Options.ConvertTabsToSpaces = true;
        _editor.Options.IndentationSize = 2;

        // The same token colours the WPF build uses, driven by the same core
        // lexer rather than by a TextMate grammar: one definition of what a
        // Fishbowl SQL keyword is, shared by both front ends.
        _editor.TextArea.TextView.LineTransformers.Add(new SqlColouriser());

        _editor.TextChanged += (_, _) => TextChanged?.Invoke(this, EventArgs.Empty);
        _editor.TextArea.TextEntered += OnTextEntered;
        _editor.TextArea.KeyDown += OnKeyDown;

        Content = _editor;
    }

    public void Clear() => Text = "";

    /// <summary>Insert at the caret, leaving the caret after what was inserted.</summary>
    public void InsertAtCaret(string text)
    {
        if (string.IsNullOrEmpty(text)) return;
        _editor.Document.Insert(_editor.CaretOffset, text);
        _editor.Focus();
    }


    // ── COMPLETION ──────────────────────────────────────────────────────

    /// <summary>
    /// Offer completions as soon as there is something to go on. A brace opens
    /// the variable list; a letter opens the schema list once there are two of
    /// them, because one letter matches a third of the keywords and reads as a
    /// menu rather than a suggestion.
    /// </summary>
    private void OnTextEntered(object? sender, TextInputEventArgs e)
    {
        if (e.Text == "{") { CloseBraces(); return; }
        if (e.Text is null || e.Text.Length == 0) return;

        if (!char.IsLetterOrDigit(e.Text[0]) && e.Text[0] is not '_' and not '.')
        {
            // Anything else ends a word, which is the moment a keyword can be
            // recognised: "select" is only certainly the keyword once nothing
            // more can be added to it.
            UpperKeywordJustTyped();
            return;
        }

        Suggest();
    }

    /// <summary>
    /// Upper-case the word the caret just left, if it was a keyword.
    ///
    /// The same rule Format SQL applies, applied as you type, so a formatted
    /// statement and a typed one look alike and Format stops being something
    /// you have to remember to press.
    ///
    /// Decided from the lexer, not from a word list lookup alone: a keyword
    /// inside a string literal or a comment is data, and rewriting it would
    /// change what the query matches. The token at that offset carries that
    /// answer already.
    /// </summary>
    private void UpperKeywordJustTyped()
    {
        var doc = _editor.Document;
        var end = _editor.CaretOffset - 1;          // the separator just typed
        if (end <= 0 || end > doc.TextLength) return;

        var start = end;
        while (start > 0 && (char.IsLetter(doc.GetCharAt(start - 1)) || doc.GetCharAt(start - 1) == '_'))
            start--;
        if (start == end) return;

        var word = doc.GetText(start, end - start);
        var upper = word.ToUpperInvariant();
        if (upper == word) return;
        if (!SqlHighlighter.Keywords.Contains(word)) return;
        if (KindAt(doc.Text, start) is SqlTokenKind.String or SqlTokenKind.Comment) return;

        // Same length, so the caret does not move and no offset has to be
        // restored — which is the whole reason this is a replace and not a
        // delete-then-insert.
        doc.Replace(start, word.Length, upper);
    }

    /// <summary>What kind of token the given offset falls in.</summary>
    private static SqlTokenKind KindAt(string text, int offset)
    {
        var at = 0;
        foreach (var t in SqlHighlighter.Tokenize(text))
        {
            at += t.Text.Length;
            if (offset < at) return t.Kind;
        }
        return SqlTokenKind.Plain;
    }

    /// <summary>The second brace closes its own pair, as it does in every other field.</summary>
    private void CloseBraces()
    {
        var caret = _editor.CaretOffset;
        if (caret < 2) return;

        var doc = _editor.Document;
        if (doc.GetCharAt(caret - 2) != '{') return;
        if (doc.TextLength >= caret + 2 && doc.GetText(caret, 2) == "}}") { Suggest(); return; }

        doc.Insert(caret, "}}");
        _editor.CaretOffset = caret;
        Suggest();
    }

    private void OnKeyDown(object? sender, KeyEventArgs e)
    {
        // Ctrl+Space asks for the list without waiting for a second letter.
        if (e.Key == Key.Space && (e.KeyModifiers & KeyModifiers.Control) != 0)
        {
            Suggest();
            e.Handled = true;
        }
    }

    private void Suggest()
    {
        var text = Text;
        var caret = _editor.CaretOffset;

        var items = Offers(text, caret);
        if (items.Count == 0) { _completion?.Close(); return; }

        _completion?.Close();

        var window = new CompletionWindow(_editor.TextArea)
        {
            CloseAutomatically = true,
            CloseWhenCaretAtBeginning = true,
        };

        // Tab and click accept, and only those. Enter has to stay a newline:
        // the list appears after two letters, so leaving Enter bound (which is
        // the default, alongside Tab) turns every line break that follows a
        // word into a completion nobody asked for.
        window.CompletionList.CompletionAcceptKeys = [Key.Tab];

        foreach (var it in items) window.CompletionList.CompletionData.Add(it);

        // Only clear the field if THIS window is still the open one. Close()
        // above raises Closed on the previous window, and if that arrives after
        // the new one is assigned it would blank a window that is on screen.
        window.Closed += (_, _) => { if (ReferenceEquals(_completion, window)) _completion = null; };

        _completion = window;
        window.Show();

        // Accepting needs something selected, and nothing selects itself. The
        // list is already filtered to the prefix, so the best match for it is
        // the first row — but saying so explicitly is what makes Tab land on
        // an item rather than on nothing.
        window.CompletionList.SelectItem(PrefixAtCaret());
    }

    /// <summary>
    /// What to offer at the caret. Inside {{ }} that is the variables; anywhere
    /// else it is whatever the core's schema-and-place engine says.
    /// </summary>
    private List<SqlCompletionData> Offers(string text, int caret)
    {
        if (VariableSource is not null && VarCompletion.TokenAt(text, caret) is { } token)
        {
            return [.. VarCompletion.Matches(token.Prefix, VariableSource())
                        .Select(v => new SqlCompletionData(
                            v.Name, SqlItemKind.Variable, v.Preview, token.Prefix.Length))];
        }

        var (qualifier, word) = WordBeforeCaret(text, caret);
        if (qualifier.Length == 0 && word.Length < 2) return [];

        var matches = DbSchema.Suggest(SchemaSource?.Invoke(), text, qualifier, word,
                                       before: LineBeforeCaret(text, caret));

        if (matches.Count == 0 && qualifier.Length == 0)
        {
            matches = [.. SqlHighlighter.Keywords
                          .Where(k => k.StartsWith(word, StringComparison.OrdinalIgnoreCase))
                          .OrderBy(k => k, StringComparer.OrdinalIgnoreCase)
                          .Take(12)
                          .Select(k => new SqlCompletion(k.ToUpperInvariant(), SqlItemKind.Keyword, "keyword"))];
        }

        // Nothing to offer if the word already IS the only match.
        if (matches.Count == 1 && matches[0].Text.Equals(word, StringComparison.OrdinalIgnoreCase))
            return [];

        return [.. matches.Select(m => new SqlCompletionData(m.Text, m.Kind, m.Detail, word.Length))];
    }

    /// <summary>
    /// What has been typed of the word the list is completing — the text
    /// after the braces inside a {{token}}, the partial word anywhere else.
    /// </summary>
    private string PrefixAtCaret()
    {
        var text = Text;
        var caret = _editor.CaretOffset;

        if (VarCompletion.TokenAt(text, caret) is { } token) return token.Prefix;
        return WordBeforeCaret(text, caret).Word;
    }

    private static (string Qualifier, string Word) WordBeforeCaret(string text, int caret)
    {
        var line = LineBeforeCaret(text, caret);

        var i = line.Length;
        while (i > 0 && (char.IsLetterOrDigit(line[i - 1]) || line[i - 1] == '_')) i--;
        var word = line[i..];

        if (i == 0 || line[i - 1] != '.') return ("", word);

        var j = i - 1;
        while (j > 0 && (char.IsLetterOrDigit(line[j - 1]) || line[j - 1] == '_')) j--;
        return (line[j..(i - 1)], word);
    }

    private static string LineBeforeCaret(string text, int caret)
    {
        if (caret <= 0 || caret > text.Length) return "";
        var start = text.LastIndexOf('\n', Math.Min(caret, text.Length) - 1) + 1;
        return text[start..caret];
    }
}

/// <summary>
/// One entry in the completion list: the kind badge, the name, and where it
/// lives, in the same language the editor itself colours with.
/// </summary>
public sealed class SqlCompletionData(string text, SqlItemKind kind, string detail, int replacing)
    : ICompletionData
{
    public IImage? Image => null;
    public string Text { get; } = text;
    public double Priority => kind == SqlItemKind.Column ? 2 : 1;

    private Control? _row;

    /// <summary>
    /// The row, as it appears in the list.
    ///
    /// A built control rather than a view-model. AvaloniaEdit presents this
    /// through a plain ContentPresenter, and a record with no matching
    /// DataTemplate in scope falls back to ToString() — which is how the list
    /// came to read "SqlCompletionRow { Text = … }" instead of a row of pills.
    /// The completion window is its own top-level, so a template declared on
    /// the main window would not have reached it either.
    ///
    /// Built once and kept: the presenter asks for this more than once per
    /// keystroke, and a fresh control each time would be reparented mid-layout.
    /// </summary>
    public object Content => _row ??= BuildRow();

    public object Description => detail;

    private Control BuildRow()
    {
        var label = new TextBlock
        {
            Text = LabelFor(kind),
            FontSize = 9.5,
            FontWeight = FontWeight.Bold,
            HorizontalAlignment = HorizontalAlignment.Center,
        };
        label.Bind(TextBlock.ForegroundProperty, App.Token(Brand.KeysForTone(ToneFor(kind)).Ink));

        var badge = new Border
        {
            CornerRadius = new CornerRadius(3),
            Padding = new Thickness(5, 1),
            MinWidth = 34,
            VerticalAlignment = VerticalAlignment.Center,
            Child = label,
        };
        badge.Bind(Border.BackgroundProperty, App.Token(Brand.KeysForTone(ToneFor(kind)).Fill));

        var name = new TextBlock
        {
            Text = Text,
            FontSize = 12.5,
            FontFamily = Mono,
            VerticalAlignment = VerticalAlignment.Center,
        };

        // Where it lives — the table a column belongs to, a view's warning, a
        // variable's value. Trimmed rather than wrapped: the list is a menu,
        // and the full text is on the pane beside it.
        var where = new TextBlock
        {
            Text = detail,
            FontSize = 10.5,
            Foreground = Brand.Muted,
            VerticalAlignment = VerticalAlignment.Center,
            TextTrimming = TextTrimming.CharacterEllipsis,
            MaxWidth = 210,
        };

        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 7 };
        row.Children.Add(badge);
        row.Children.Add(name);
        if (!string.IsNullOrWhiteSpace(detail)) row.Children.Add(where);
        return row;
    }

    private static FontFamily Mono =>
        Brand.Mono;

    private static string LabelFor(SqlItemKind k) => k switch
    {
        SqlItemKind.Keyword => "kw",
        SqlItemKind.Table => "tbl",
        SqlItemKind.View => "view",
        SqlItemKind.Variable => "var",
        _ => "col",
    };

    /// <summary>
    /// A completion kind, in the same vocabulary the table pills use — so a
    /// keyword badge and a status pill are coloured by one palette rather than
    /// by two lists that drift.
    /// </summary>
    private static ValueTone ToneFor(SqlItemKind k) => k switch
    {
        SqlItemKind.Keyword => ValueTone.None,
        SqlItemKind.Table => ValueTone.Active,
        SqlItemKind.View => ValueTone.Negative,
        SqlItemKind.Variable => ValueTone.Warning,
        _ => ValueTone.Positive,
    };

    public void Complete(TextArea textArea, ISegment completionSegment, EventArgs e)
    {
        // Replace what was typed, not the segment AvaloniaEdit guessed: a
        // variable's prefix sits inside braces the segment does not know about.
        var start = Math.Max(0, completionSegment.EndOffset - replacing);
        var length = completionSegment.EndOffset - start;

        if (kind == SqlItemKind.Variable)
        {
            var doc = textArea.Document;
            var (built, caret) = VarCompletion.Insert(doc.Text, completionSegment.EndOffset, Text);
            doc.Text = built;
            textArea.Caret.Offset = Math.Min(caret, doc.TextLength);
            return;
        }

        textArea.Document.Replace(start, length, Text);
    }
}

/// <summary>
/// Colours each line from the core's own lexer.
///
/// A line transformer rather than a highlighting definition, so the colours
/// come from SqlHighlighter — the same code that decides what a keyword is for
/// the WPF build. A TextMate grammar would be a second, slightly different
/// answer to that question.
/// </summary>
public sealed class SqlColouriser : DocumentColorizingTransformer
{
    protected override void ColorizeLine(DocumentLine line)
    {
        if (line.Length == 0) return;

        var text = CurrentContext.Document.GetText(line);

        // Tokenize returns the runs in order but not where they start, so the
        // offset is carried along. Plain runs are skipped rather than painted
        // the default colour, which saves a transform per word.
        var at = 0;
        foreach (var t in SqlHighlighter.Tokenize(text))
        {
            var start = at;
            at += t.Text.Length;

            var brush = t.Kind switch
            {
                SqlTokenKind.Keyword => Brand.Purple,
                SqlTokenKind.String => Brand.Success,
                SqlTokenKind.Number => Brand.BlueAccent,
                SqlTokenKind.Comment => Brand.Muted,
                _ => (IBrush?)null,
            };
            if (brush is null || t.Text.Length == 0) continue;

            ChangeLinePart(line.Offset + start, line.Offset + at,
                           el => el.TextRunProperties.SetForegroundBrush(brush));
        }
    }
}
