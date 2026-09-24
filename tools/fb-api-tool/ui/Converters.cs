using System.Globalization;
using Avalonia;
using Avalonia.Data.Converters;
using Avalonia.Media;

namespace FbApiTool.Ui;

/// <summary>
/// The brand palette, reached from code.
///
/// Every one of these is a LOOKUP, not a constant. They used to be frozen
/// literals, which is fine until there are two themes: a badge built in code
/// kept its light-theme tint while the markup around it went dark, and the
/// result was a pale blue chip on a near-black page. Reading the resource each
/// time costs a dictionary hit and means the answer follows the theme.
///
/// The keys are the ones in Brand.axaml, which are the ones in
/// scripts/fb-styles.css — so this tool, the WPF build and the reports cannot
/// drift apart.
/// </summary>
public static class Brand
{
    public static IBrush Blue => Get("FbBlue", "#2d9cdb");
    public static IBrush BlueAccent => Get("FbBlueAccent", "#1e7bb4");
    public static IBrush Success => Get("FbSuccess", "#1B7A46");
    public static IBrush Warning => Get("FbWarning", "#B26A14");
    public static IBrush Negative => Get("FbNegative", "#C43046");
    public static IBrush Purple => Get("AccPurple", "#845EEB");
    public static IBrush Muted => Get("FbTextMuted", "#8FA1A7");
    public static IBrush Text => Get("FbText", "#101010");
    public static IBrush Sub => Get("FbTextSub", "#506872");

    public static IBrush Surface => Get("FbBgPrimary", "#FFFFFF");
    public static IBrush Panel => Get("FbBgPanel", "#F7FAFC");
    public static IBrush Border => Get("FbBorder", "#E3E3E3");
    public static IBrush Bg2 => Get("FbBg2", "#EBEEED");

    /// <summary>
    /// The monospace family. Not themed, but reached the same way: a
    /// variant-less FindResource against a dictionary that HAS variants
    /// returns UnsetValue, and casting that threw on every endpoint with a
    /// documented parameter.
    /// </summary>
    public static FontFamily Mono
    {
        get
        {
            var app = Application.Current;
            if (app is not null &&
                app.TryGetResource("FbMono", app.ActualThemeVariant, out var found) &&
                found is FontFamily family)
                return family;

            return FontFamily.Default;
        }
    }

    /// <summary>The bar, and what reads on it. Blue in both themes.</summary>
    public static IBrush BrandBar => Get("FbBrandBar", "#2d9cdb");
    public static IBrush OnBrand => Get("FbOnBrand", "#FFFFFF");
    public static IBrush OnBrandSub => Get("FbOnBrandSub", "#DEEAF4");

    public static IBrush TintBlue => Get("FbTint", "#DEEAF4");
    public static IBrush Sage => Get("AccSage", "#DBE8E1");
    public static IBrush Maroon => Get("AccMaroonBg", "#F0D7DD");
    public static IBrush PurpleBg => Get("AccPurpleBg", "#D9CEF7");
    public static IBrush Amber => Get("FbAmber", "#B26A14");
    public static IBrush AmberBg => Get("AccYellowBg", "#FBEDC4");

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

    /// <summary>
    /// The same answers as ForMethod / FillForMethod, but as token NAMES.
    ///
    /// A control built in code and handed a brush keeps that brush for ever,
    /// so every pill painted this way stayed on whichever theme was current
    /// when it was built. Given the key instead it can Bind, which is the code
    /// equivalent of {DynamicResource} and follows the theme like the markup
    /// does.
    /// </summary>
    public static string InkKeyForMethod(string? method) => (method ?? "").ToUpperInvariant() switch
    {
        "GET" => "MethodGet",
        "POST" or "PUT" or "PATCH" => "MethodPost",
        "DELETE" => "MethodDelete",
        _ => "MethodOther",
    };

    public static string FillKeyForMethod(string? method) => InkKeyForMethod(method) + "Bg";

    /// <summary>A value's tone, as the pair of token names that draw it.</summary>
    public static (string Ink, string Fill) KeysForTone(ValueTone tone) => tone switch
    {
        ValueTone.Positive => ("FbSuccess", "AccSage"),
        ValueTone.Active => ("FbBlueAccent", "FbTint"),
        ValueTone.Warning => ("FbAmber", "AccYellowBg"),
        ValueTone.Negative => ("FbNegative", "AccMaroonBg"),
        _ => ("FbTextMuted", "FbBg2"),
    };

    /// <summary>The tint that verb sits on.</summary>
    public static IBrush FillForMethod(string? method) => (method ?? "").ToUpperInvariant() switch
    {
        "GET" => TintBlue,
        "POST" or "PUT" or "PATCH" => Sage,
        "DELETE" => Maroon,
        _ => PurpleBg,
    };

    /// <summary>
    /// The current theme's value for a token, or the light one if the
    /// application is not up yet — which happens when a converter is exercised
    /// by the designer or by a test.
    /// </summary>
    private static IBrush Get(string key, string fallback)
    {
        var app = Application.Current;
        if (app is not null &&
            app.TryGetResource(key, app.ActualThemeVariant, out var found) &&
            found is IBrush brush)
            return brush;

        return new SolidColorBrush(Color.Parse(fallback)).ToImmutable();
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
