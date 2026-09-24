namespace FbApiTool;

/// <summary>
/// The setting keys, in one place.
///
/// They were string literals spread across the window and the request pane,
/// which is fine until two of them disagree about a name and a preference
/// silently stops being read.
/// </summary>
public static class Prefs
{
    public const string DefaultView = "resp:defaultView";
    public const string KeepResults = "sql:keepResults";

    /// <summary>Whether a row limit is appended to a plain SELECT.</summary>
    public const string RowLimitOn = "sql:limitRows";
    public const string RowLimit_ = "sql:rowLimit";

    /// <summary>"light", "dark", or anything else for "follow the system".</summary>
    public const string Theme = "ui:theme";

    public const string IdleEnabled = "idle:enabled";
    public const string IdleMinutes_ = "idle:minutes";
    public const string GraceSeconds_ = "idle:graceSeconds";

    /// <summary>Set once the tour has been finished or skipped.</summary>
    public const string TipsDone = "tips:done";

    public const int DefaultIdleMinutes = 10;
    public const int DefaultGraceSeconds = 120;

    /// <summary>
    /// How long before the idle countdown starts, clamped to something a
    /// person could have meant. A stored 0 would sign out the moment the mouse
    /// stopped, which reads as the tool dropping the connection by itself.
    /// </summary>
    public static int IdleMinutes(Func<string, string?> get) =>
        int.TryParse(get(IdleMinutes_), out var m) && m is >= 1 and <= 720 ? m : DefaultIdleMinutes;

    public static int GraceSeconds(Func<string, string?> get) =>
        int.TryParse(get(GraceSeconds_), out var s) && s is >= 10 and <= 900 ? s : DefaultGraceSeconds;

    public static bool IdleEnabledOr(Func<string, string?> get) => get(IdleEnabled) != "0";

    public const int DefaultRowLimit = 500;

    /// <summary>
    /// Off unless it has been turned on. A limit that appears by itself would
    /// silently truncate a query someone wrote expecting all of it, and a
    /// short result set that is quietly incomplete is worse than a slow one.
    /// </summary>
    public static bool RowLimitOnOr(Func<string, string?> get) => get(RowLimitOn) == "1";

    /// <summary>
    /// Which appearance to use: "light", "dark", or "system".
    ///
    /// System is the default and the honest one — a tool that ignores the
    /// desktop's own setting is the only dark window on a light screen, or the
    /// reverse. The other two are there because a screen share, a projector or
    /// a photograph has its own answer.
    /// </summary>
    public static string ThemeOr(Func<string, string?> get) =>
        get(Theme) is "light" or "dark" ? get(Theme)! : "system";

    /// <summary>
    /// How many rows, clamped to something that could have been meant. A
    /// stored 0 would append LIMIT 0 and return nothing at all, which reads as
    /// the query being broken rather than as a setting.
    /// </summary>
    public static int RowLimit(Func<string, string?> get) =>
        int.TryParse(get(RowLimit_), out var n) && n is >= 1 and <= 1_000_000 ? n : DefaultRowLimit;

    /// <summary>True while the tour still has to be offered.</summary>
    public static bool TourPending(Func<string, string?> get) => get(TipsDone) != "1";
}
