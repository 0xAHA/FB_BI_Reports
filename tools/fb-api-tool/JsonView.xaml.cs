using System.Windows;
using System.Windows.Controls;
using System.Windows.Documents;

namespace FbApiTool;

/// <summary>
/// The coloured, read-only view of a response body.
///
/// Read-only means none of the caret gymnastics the SQL editor needs: the
/// document is built once per response and never edited, so it is just a
/// rendering of the tokens.
///
/// Large responses are capped. A 60,000-line document is several hundred
/// thousand Runs and will lock the window up for tens of seconds building
/// something nobody is going to scroll through; the Raw tab still holds all of
/// it, so nothing is actually lost.
/// </summary>
public partial class JsonView : UserControl
{
    private const int MaxLines = 4000;

    public JsonView() => InitializeComponent();

    /// <summary>The text currently shown, for Copy.</summary>
    public string Text { get; private set; } = "";

    /// <summary>Render JSON with colouring.</summary>
    public void SetJson(string json)
    {
        Text = json ?? "";
        Render(Text, colour: true);
    }

    /// <summary>Render text that is not JSON — an error page, say — plainly.</summary>
    public void SetPlain(string text)
    {
        Text = text ?? "";
        Render(Text, colour: false);
    }

    public void Clear() => SetPlain("");

    private void Render(string text, bool colour)
    {
        var doc = new FlowDocument
        {
            PageWidth = double.NaN,
            FontFamily = Box.FontFamily,
            FontSize = Box.FontSize,
            Foreground = Palette.Text,
        };

        var lines = text.Replace("\r\n", "\n").Replace('\r', '\n').Split('\n');
        var shown = Math.Min(lines.Length, MaxLines);

        for (var i = 0; i < shown; i++)
        {
            var p = new Paragraph { Margin = new Thickness(0) };
            if (lines[i].Length == 0) p.Inlines.Add(new Run(""));
            else if (!colour) p.Inlines.Add(new Run(lines[i]) { Foreground = Palette.Text });
            else
                foreach (var t in JsonHighlighter.Tokenize(lines[i]))
                    p.Inlines.Add(new Run(t.Text)
                    {
                        Foreground = Palette.ForJson(t.Kind),
                        FontWeight = t.Kind is JsonTokenKind.Key or JsonTokenKind.True or JsonTokenKind.False
                            ? FontWeights.SemiBold : FontWeights.Normal,
                        FontStyle = t.Kind == JsonTokenKind.Null ? FontStyles.Italic : FontStyles.Normal,
                    });
            doc.Blocks.Add(p);
        }

        if (lines.Length > shown)
        {
            var note = new Paragraph(new Run(
                $"… {lines.Length - shown:N0} more lines. The Raw tab has all of it."))
            {
                Margin = new Thickness(0, 8, 0, 0),
                Foreground = Palette.Muted,
                FontStyle = FontStyles.Italic,
            };
            doc.Blocks.Add(note);
        }

        Box.Document = doc;
    }

}
