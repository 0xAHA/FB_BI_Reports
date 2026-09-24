using System.Text;

namespace FbApiTool;

/// <summary>
/// A log file, and the place crashes go.
///
/// Deliberately the simplest thing that survives a crash: append a line, flush,
/// close. No buffering, no background writer, no logging framework — because
/// the entries that matter most are the last few before something threw, and a
/// buffered writer is exactly the thing that loses those.
///
/// It lives beside the settings rather than beside the executable: the exe is
/// often somewhere read-only, or on a share, or is one of several copies.
/// </summary>
public static class Log
{
    public static string File { get; } = Path.Combine(ApiCatalog.DataDir, "fb-api-tool.log");

    /// <summary>Crashes get their own file so the last one is never scrolled past.</summary>
    public static string CrashFile { get; } = Path.Combine(ApiCatalog.DataDir, "crash.log");

    private const long MaxBytes = 2 * 1024 * 1024;

    private static readonly Lock Gate = new();

    public static void Info(string message) => Write("INFO ", message);
    public static void Warn(string message) => Write("WARN ", message);

    /// <summary>
    /// Something went wrong but the tool carried on.
    ///
    /// The exception TYPE and message both go down, because "Could not save"
    /// on its own has never once been enough to work out why.
    /// </summary>
    public static void Error(string message, Exception? ex = null) =>
        Write("ERROR", ex is null ? message : message + " — " + Describe(ex));

    /// <summary>
    /// Something went wrong and did not. Written to both files: the crash file
    /// so it is the only thing in it, and the log so the entries leading up to
    /// it are in order beside it.
    /// </summary>
    public static void Crash(string where, Exception ex)
    {
        var text = new StringBuilder()
            .AppendLine("Fishbowl API Tool crashed.")
            .AppendLine(BuildInfo.Long)
            .AppendLine(DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss"))
            .AppendLine("caught by: " + where)
            .AppendLine()
            .AppendLine(ex.ToString())
            .ToString();

        Write("CRASH", where + " — " + Describe(ex));

        try
        {
            Directory.CreateDirectory(ApiCatalog.DataDir);
            System.IO.File.WriteAllText(CrashFile, text);
        }
        catch { /* nothing left to try */ }
    }

    private static string Describe(Exception ex)
    {
        var sb = new StringBuilder();
        for (var e = ex; e is not null; e = e.InnerException)
        {
            if (sb.Length > 0) sb.Append("  <- ");
            sb.Append(e.GetType().Name).Append(": ").Append(e.Message);
        }
        return sb.ToString();
    }

    /// <summary>
    /// Append one line.
    ///
    /// Every failure here is swallowed. A tool that cannot write its log has a
    /// problem; a tool that CRASHES because it cannot write its log has a
    /// worse one, and the second is entirely avoidable.
    /// </summary>
    private static void Write(string level, string message)
    {
        try
        {
            lock (Gate)
            {
                Directory.CreateDirectory(ApiCatalog.DataDir);
                Roll();

                System.IO.File.AppendAllText(File,
                    DateTime.Now.ToString("HH:mm:ss.fff") + "  " + level + "  " +
                    message.Replace("\r", "").Replace("\n", " · ") + Environment.NewLine);
            }
        }
        catch { /* logging must never be the thing that fails */ }
    }

    /// <summary>
    /// Keep one old file and start again.
    ///
    /// Two files rather than a numbered set: the question is always "what
    /// happened this run, and the one before", and a folder of twenty logs
    /// makes that harder to answer rather than easier.
    /// </summary>
    private static void Roll()
    {
        try
        {
            if (!System.IO.File.Exists(File)) return;
            if (new FileInfo(File).Length < MaxBytes) return;

            var old = File + ".1";
            if (System.IO.File.Exists(old)) System.IO.File.Delete(old);
            System.IO.File.Move(File, old);
        }
        catch { /* a log that will not roll is still a log */ }
    }
}
