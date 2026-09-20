using System.IO;
using System.Reflection;

namespace FbApiTool;

/// <summary>
/// Which build this is.
///
/// "It does that on mine" is unanswerable without one. Two people running
/// FbApiTool.exe a fortnight apart have no way to tell whether they are
/// looking at the same program, and neither does a bug report.
///
/// Nothing is generated at compile time on purpose. A stamp written into a
/// source file has to be rewritten on every build, which makes every build a
/// full rebuild — a steep price for a line of text. Both halves are already
/// there to be read:
///
///   the date — when the executable itself was written;
///   the hash — the module version id, which the compiler makes fresh for
///              every compilation, so two builds of identical source still
///              differ and a rebuilt binary can never be mistaken for the one
///              it replaced.
/// </summary>
public static class BuildInfo
{
    /// <summary>e.g. "2026-09-21".</summary>
    public static string Date { get; } = BuiltOn().ToString("yyyy-MM-dd");

    /// <summary>e.g. "2026-09-21 06:41".</summary>
    public static string DateTimeText { get; } = BuiltOn().ToString("yyyy-MM-dd HH:mm");

    /// <summary>Seven hex characters that change with every compilation.</summary>
    public static string Hash { get; } =
        Assembly.GetExecutingAssembly().ManifestModule.ModuleVersionId.ToString("N")[..7];

    /// <summary>The version this was released as, e.g. "1.0.0".</summary>
    public static string Version { get; } =
        Assembly.GetExecutingAssembly()
                .GetCustomAttribute<AssemblyInformationalVersionAttribute>()?
                .InformationalVersion.Split('+')[0]
        ?? "1.0.0";

    /// <summary>What to show a person: "1.0.0 · 2026-09-21 · 4f2a9c1".</summary>
    public static string Full => Version + " · " + Date + " · " + Hash;

    /// <summary>The same, with the time, for a log nobody is reading by eye.</summary>
    public static string Long => Version + " · built " + DateTimeText + " · " + Hash;

    /// <summary>
    /// When the running executable was written.
    ///
    /// ProcessPath rather than Assembly.Location: a single-file build reports
    /// no location for the assembly, which is exactly the build most likely to
    /// be the one somebody is asking about.
    /// </summary>
    private static DateTime BuiltOn()
    {
        try
        {
            var exe = Environment.ProcessPath;
            if (!string.IsNullOrEmpty(exe) && File.Exists(exe)) return File.GetLastWriteTime(exe);
        }
        catch { /* fall through */ }

        return DateTime.Now;
    }
}
