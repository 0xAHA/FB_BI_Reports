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

    /// <summary>True while the tour still has to be offered.</summary>
    public static bool TourPending(Func<string, string?> get) => get(TipsDone) != "1";
}
