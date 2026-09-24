using Avalonia;
using Avalonia.Controls;
using Avalonia.Media;
using AvaloniaEdit;
using AvaloniaEdit.Document;
using AvaloniaEdit.Rendering;

namespace FbApiTool.Ui;

/// <summary>
/// The formatted response, coloured.
///
/// Built on AvaloniaEdit rather than on a TextBlock full of runs, for the same
/// reason the SQL editor is: it virtualises. A 40,000-line data-query response
/// would otherwise be forty thousand inline runs in the visual tree, and the
/// WPF version had to cap the view at a few thousand lines and apologise for
/// it. Here the cap is gone because only what is on screen is ever built.
///
/// What to colour is <see cref="JsonHighlighter"/> in the core, shared with the
/// WPF build and with the table's own tone rules — so a status of "Voided"
/// reads the same red whether you are looking at the rows or at the document.
/// </summary>
public sealed class JsonView : UserControl
{
    private readonly TextEditor _editor = new();

    public string Text
    {
        get => _editor.Document.Text;
        set => _editor.Document.Text = value ?? "";
    }

    public JsonView()
    {
        _editor.IsReadOnly = true;
        _editor.ShowLineNumbers = false;
        _editor.WordWrap = false;
        _editor.FontFamily = Brand.Mono;
        _editor.FontSize = 12.5;
        // Bound, not assigned. A colour set once here keeps the value it had
        // when the control was built, so an editor opened in light mode
        // stayed white after the theme was switched under it.
        _editor.Bind(BackgroundProperty, App.Token("FbBgPrimary"));
        _editor.Bind(ForegroundProperty, App.Token("FbText"));
        _editor.Padding = new Thickness(8, 6);
        _editor.Options.EnableHyperlinks = false;
        _editor.Options.EnableEmailHyperlinks = false;

        _editor.TextArea.TextView.LineTransformers.Add(new JsonColouriser());

        Content = _editor;
    }

    public void Clear() => Text = "";
}

/// <summary>
/// Colours each line from the core's own JSON lexer.
///
/// The lexer works on text rather than on a parsed document, which is
/// deliberate: a truncated or malformed response still colours, and that is
/// exactly when someone is staring at one.
/// </summary>
public sealed class JsonColouriser : DocumentColorizingTransformer
{
    protected override void ColorizeLine(DocumentLine line)
    {
        if (line.Length == 0) return;

        var text = CurrentContext.Document.GetText(line);

        // The lexer returns the runs in order but not where they start, so the
        // offset is carried along.
        var at = 0;
        foreach (var t in JsonHighlighter.Tokenize(text))
        {
            var start = at;
            at += t.Text.Length;
            if (t.Text.Length == 0) continue;

            var brush = Ink(t.Kind);
            if (brush is null) continue;

            var bold = t.Kind is JsonTokenKind.Key or JsonTokenKind.True or JsonTokenKind.False;

            ChangeLinePart(line.Offset + start, line.Offset + at, el =>
            {
                el.TextRunProperties.SetForegroundBrush(brush);
                if (bold) el.TextRunProperties.SetTypeface(
                    new Typeface(el.TextRunProperties.Typeface.FontFamily, FontStyle.Normal, FontWeight.SemiBold));
            });
        }
    }

    /// <summary>
    /// A token's ink. Punctuation keeps the default colour rather than being
    /// painted grey — braces and commas are structure, and dimming every one
    /// of them makes a nested document harder to follow, not easier.
    /// </summary>
    private static IBrush? Ink(JsonTokenKind kind) => kind switch
    {
        JsonTokenKind.Key => Brand.BlueAccent,
        JsonTokenKind.Text => Brand.Purple,
        JsonTokenKind.Number => Brand.Amber,
        JsonTokenKind.True => Brand.Success,
        JsonTokenKind.False => Brand.Negative,
        JsonTokenKind.Null => Brand.Muted,
        _ => null,
    };
}
