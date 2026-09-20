using System.Globalization;
using System.Windows;
using System.Windows.Data;
using System.Windows.Media;

namespace FbApiTool;

/// <summary>
/// The colours for the kinds the core reports, as converters rather than as
/// properties on the types themselves.
///
/// Those used to be the second half of a partial class, which worked only
/// while the model and the window were compiled into one assembly. The model
/// now lives in FbApiTool.Core, which by design cannot name a Brush, and a
/// partial cannot span two assemblies — so the mapping moved to where the
/// drawing is done. It has the same shape a second UI would need anyway.
/// </summary>
public abstract class KindConverter : IValueConverter
{
    public object Convert(object? value, Type t, object? p, CultureInfo c) => Map(value);
    public object ConvertBack(object? value, Type t, object? p, CultureInfo c) =>
        throw new NotSupportedException();

    protected abstract object Map(object? value);
}

/// <summary>A proposed catalog change: green gained, blue moved, red would go.</summary>
public sealed class ChangeKindBrush : KindConverter
{
    protected override object Map(object? v) => v switch
    {
        ChangeKind.Added => MethodColours.For("POST"),
        ChangeKind.Changed => MethodColours.For("GET"),
        _ => MethodColours.For("DELETE"),
    };
}

/// <summary>A completion badge's text colour — the same language the editor uses.</summary>
public sealed class SqlKindInk : KindConverter
{
    protected override object Map(object? v) => v switch
    {
        SqlItemKind.Keyword => MethodColours.For("OTHER"),    // --acc-purple
        SqlItemKind.Table => MethodColours.For("GET"),        // --fb-blue-accent
        SqlItemKind.View => MethodColours.For("DELETE"),      // a view is not a table
        SqlItemKind.Variable => MethodColours.Amber,          // not part of the schema at all
        _ => MethodColours.For("POST"),                       // --fb-success
    };
}

/// <summary>The same badge's fill.</summary>
public sealed class SqlKindFill : KindConverter
{
    protected override object Map(object? v) => v switch
    {
        SqlItemKind.Keyword => MethodColours.Fill("OTHER"),
        SqlItemKind.Table => MethodColours.Fill("GET"),
        SqlItemKind.View => MethodColours.Fill("DELETE"),
        SqlItemKind.Variable => MethodColours.AmberFill,
        _ => MethodColours.Fill("POST"),
    };
}

/// <summary>A schema row: a view gets its own colour, not a shade of a table's.</summary>
public sealed class ViewInk : KindConverter
{
    protected override object Map(object? v) =>
        v is true ? MethodColours.For("OTHER") : MethodColours.For("GET");
}

public sealed class ViewFill : KindConverter
{
    protected override object Map(object? v) =>
        v is true ? MethodColours.Fill("OTHER") : MethodColours.Fill("GET");
}

/// <summary>Shows the warning only on a view that materialises.</summary>
public sealed class BoolVisible : KindConverter
{
    protected override object Map(object? v) => v is true ? Visibility.Visible : Visibility.Collapsed;
}
