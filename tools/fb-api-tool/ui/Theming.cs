using Avalonia;
using Avalonia.Styling;

namespace FbApiTool.Ui;

/// <summary>
/// Which end of the palette is in use.
///
/// One switch, applied to the application, because every colour in the tool is
/// now a token rather than a literal — the markup reads them as
/// DynamicResource and the code through <see cref="Brand"/>, so changing the
/// variant repaints the window with nothing to restart.
///
/// That is the whole reason the literals had to go first. A hardcoded #FFFFFF
/// is a patch of light theme that survives the switch, and enough of them is
/// how a dark mode ends up unreadable rather than dark.
/// </summary>
public static class Theming
{
    /// <summary>
    /// Apply a stored preference: "light", "dark", or anything else for
    /// "follow the desktop".
    ///
    /// Default is Avalonia's name for the system variant, not for light.
    /// </summary>
    public static void Apply(string? theme)
    {
        if (Application.Current is not { } app) return;

        app.RequestedThemeVariant = theme switch
        {
            "light" => ThemeVariant.Light,
            "dark" => ThemeVariant.Dark,
            _ => ThemeVariant.Default,
        };
    }
}
