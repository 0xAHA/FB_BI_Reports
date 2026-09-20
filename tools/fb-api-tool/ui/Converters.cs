using System.Globalization;
using Avalonia.Data.Converters;
using Avalonia.Media;

namespace FbApiTool.Ui;

/// <summary>
/// The brand palette, as brushes.
///
/// The same values as Brand.axaml and as scripts/fb-styles.css. They are
/// needed from code as well as from markup — a badge whose colour depends on
/// a verb cannot be a static resource — so they live here too, frozen once.
/// </summary>
public static class Brand
{
    public static readonly IBrush Blue = Make("#2d9cdb");
    public static readonly IBrush BlueAccent = Make("#1e7bb4");
    public static readonly IBrush Success = Make("#1B7A46");
    public static readonly IBrush Warning = Make("#B26A14");
    public static readonly IBrush Negative = Make("#C43046");
    public static readonly IBrush Purple = Make("#845EEB");

    public static readonly IBrush TintBlue = Make("#DEEAF4");
    public static readonly IBrush Sage = Make("#DBE8E1");
    public static readonly IBrush Maroon = Make("#F0D7DD");
    public static readonly IBrush PurpleBg = Make("#D9CEF7");
    public static readonly IBrush Amber = Make("#B26A14");
    public static readonly IBrush AmberBg = Make("#FBEDC4");

    /// <summary>
    /// A verb's ink: blue for a read, green for a write, red for a delete,
    /// purple for anything else. Not an invented palette — these are the
    /// fb-styles semantic tokens.
    /// </summary>
    public static IBrush ForMethod(string? method) => (method ?? "").ToUpperInvariant() switch
    {
        "GET" => BlueAccent,
        "POST" or "PUT" or "PATCH" => Success,
        "DELETE" => Negative,
        _ => Purple,
    };

    /// <summary>The tint that verb sits on.</summary>
    public static IBrush FillForMethod(string? method) => (method ?? "").ToUpperInvariant() switch
    {
        "GET" => TintBlue,
        "POST" or "PUT" or "PATCH" => Sage,
        "DELETE" => Maroon,
        _ => PurpleBg,
    };

    private static IBrush Make(string hex)
    {
        var b = new SolidColorBrush(Color.Parse(hex));
        b.ToImmutable();
        return b.ToImmutable();
    }
}

/// <summary>One-way value converters. None of these has a sensible inverse.</summary>
public abstract class OneWay : IValueConverter
{
    public object? Convert(object? value, Type t, object? p, CultureInfo c) => Map(value, p);

    public object ConvertBack(object? value, Type t, object? p, CultureInfo c) =>
        throw new NotSupportedException();

    protected abstract object? Map(object? value, object? parameter);
}

/// <summary>A proposed catalog change: green gained, blue moved, red would go.</summary>
public sealed class ChangeKindBrush : OneWay
{
    protected override object? Map(object? v, object? _) => v switch
    {
        ChangeKind.Added => Brand.Success,
        ChangeKind.Changed => Brand.BlueAccent,
        _ => Brand.Negative,
    };
}

/// <summary>A completion badge's ink — the same language the editor itself uses.</summary>
public sealed class SqlKindInk : OneWay
{
    protected override object? Map(object? v, object? _) => v switch
    {
        SqlItemKind.Keyword => Brand.Purple,
        SqlItemKind.Table => Brand.BlueAccent,
        SqlItemKind.View => Brand.Negative,
        SqlItemKind.Variable => Brand.Amber,
        _ => Brand.Success,
    };
}

/// <summary>The same badge's fill.</summary>
public sealed class SqlKindFill : OneWay
{
    protected override object? Map(object? v, object? _) => v switch
    {
        SqlItemKind.Keyword => Brand.PurpleBg,
        SqlItemKind.Table => Brand.TintBlue,
        SqlItemKind.View => Brand.Maroon,
        SqlItemKind.Variable => Brand.AmberBg,
        _ => Brand.Sage,
    };
}

/// <summary>A schema row: a view gets its own colour, not a shade of a table's.</summary>
public sealed class ViewInk : OneWay
{
    protected override object? Map(object? v, object? _) => v is true ? Brand.Purple : Brand.BlueAccent;
}

public sealed class ViewFill : OneWay
{
    protected override object? Map(object? v, object? _) => v is true ? Brand.PurpleBg : Brand.TintBlue;
}

/// <summary>An endpoint's verb pill.</summary>
public sealed class MethodInk : OneWay
{
    protected override object? Map(object? v, object? _) => Brand.ForMethod(v as string);
}

public sealed class MethodFill : OneWay
{
    protected override object? Map(object? v, object? _) => Brand.FillForMethod(v as string);
}
