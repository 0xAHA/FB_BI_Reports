using System.Globalization;
using System.Windows;
using System.Windows.Data;

namespace FbApiTool;

/// <summary>
/// Turns a cell's value into the four things a chip needs to be drawn.
///
/// One converter with a <see cref="Part"/> rather than four classes, because
/// they all ask <see cref="Tone"/> the same question and only differ in which
/// answer they hand back.
/// </summary>
public sealed class ToneConverter(ToneConverter.Part part) : IValueConverter
{
    public enum Part { Foreground, Background, Weight, Style }

    public object Convert(object? value, Type targetType, object? parameter, CultureInfo culture)
    {
        var tone = Tone.Classify(value as string);

        return part switch
        {
            Part.Background => Palette.Background(tone),
            Part.Foreground => Palette.Foreground(tone),

            // A recognised status is the thing worth finding in a wide row.
            Part.Weight => tone is ValueTone.None or ValueTone.Empty
                ? FontWeights.Normal : FontWeights.SemiBold,

            // An empty cell is absence, not a value; italic says so without
            // taking up any more width.
            _ => tone == ValueTone.Empty ? FontStyles.Italic : FontStyles.Normal,
        };
    }

    public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture) =>
        throw new NotSupportedException("The response table is read-only.");
}
