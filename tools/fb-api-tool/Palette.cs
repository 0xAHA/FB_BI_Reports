using System.Windows.Media;

namespace FbApiTool;

/// <summary>
/// The brushes the coloured views draw with, straight from the fb-styles
/// tokens so this tool, the report host and the reports agree.
///
/// Frozen and shared: a response can run to thousands of runs, and a fresh
/// brush per run is the difference between a table that scrolls and one that
/// stutters.
/// </summary>
public static class Palette
{
    public static readonly Brush Text = Make("#101010");      // --c-primary
    public static readonly Brush Sub = Make("#506872");       // --c-secondary
    public static readonly Brush Muted = Make("#8FA1A7");     // --c-tertiary

    public static readonly Brush Blue = Make("#2d9cdb");      // --fb-blue
    public static readonly Brush BlueAccent = Make("#1e7bb4"); // --fb-blue-accent
    public static readonly Brush Success = Make("#1B7A46");   // --fb-success
    public static readonly Brush Warning = Make("#B26A14");   // --fb-warning
    public static readonly Brush Negative = Make("#C43046");  // --fb-negative
    public static readonly Brush Purple = Make("#845EEB");    // --acc-purple

    // Chip fills, from the accent backgrounds fb-styles defines for exactly
    // this purpose — tinted enough to read as a chip, pale enough to keep the
    // text legible.
    public static readonly Brush SageBg = Make("#DBE8E1");    // --acc-sage
    public static readonly Brush TintBg = Make("#DEEAF4");    // --tint-blue
    public static readonly Brush YellowBg = Make("#FBEDC4");  // --acc-yellow-bg
    public static readonly Brush MaroonBg = Make("#F0D7DD");  // --acc-maroon-bg
    public static readonly Brush QuietBg = Make("#EBEEED");   // --bg-2
    public static readonly Brush Transparent = Brushes.Transparent;

    /// <summary>The text colour for a classified value.</summary>
    public static Brush Foreground(ValueTone tone) => tone switch
    {
        ValueTone.Positive => Success,
        ValueTone.Active => BlueAccent,
        ValueTone.Warning => Warning,
        ValueTone.Negative => Negative,
        ValueTone.Quiet => Sub,
        ValueTone.Empty => Muted,
        _ => Text,
    };

    /// <summary>The chip fill for a classified value, or transparent for plain text.</summary>
    public static Brush Background(ValueTone tone) => tone switch
    {
        ValueTone.Positive => SageBg,
        ValueTone.Active => TintBg,
        ValueTone.Warning => YellowBg,
        ValueTone.Negative => MaroonBg,
        ValueTone.Quiet => QuietBg,
        _ => Transparent,
    };

    public static Brush ForJson(JsonTokenKind kind) => kind switch
    {
        JsonTokenKind.Key => Purple,
        JsonTokenKind.Text => Success,
        JsonTokenKind.Number => BlueAccent,
        JsonTokenKind.True => Success,
        JsonTokenKind.False => Negative,
        JsonTokenKind.Null => Muted,
        _ => Sub,
    };

    private static Brush Make(string hex)
    {
        var b = new SolidColorBrush((Color)ColorConverter.ConvertFromString(hex));
        b.Freeze();
        return b;
    }
}
