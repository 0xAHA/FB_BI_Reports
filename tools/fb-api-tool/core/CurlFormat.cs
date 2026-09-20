using System.Text;
using System.Text.RegularExpressions;

namespace FbApiTool;

/// <summary>A request read out of a cURL command line.</summary>
public sealed record CurlRequest(
    string Method,
    string Url,
    List<KeyValuePair<string, string>> Headers,
    string? Body);

/// <summary>
/// cURL in and out, and the BI-report call shape.
///
/// cURL is how an API problem actually gets reported: a colleague pastes the
/// command they ran, or asks for the one you ran. Fishbowl's own
/// /apidocs.json ships a cURL sample for every endpoint, so it is already the
/// lingua franca here.
/// </summary>
public static partial class CurlFormat
{
    /// <summary>What a token is replaced with. Never the token itself.</summary>
    public const string TokenPlaceholder = "<TOKEN>";

    // ── OUT ─────────────────────────────────────────────────────────────

    /// <summary>
    /// The current request as a cURL command.
    ///
    /// The bearer token is always replaced with a placeholder. A cURL command
    /// exists to be pasted into a ticket or a chat window, and a live session
    /// token pasted there is a credential leak — so it is never included, even
    /// though that makes the command one edit short of runnable.
    /// </summary>
    public static string ToCurl(string method, string url,
                                IEnumerable<KeyValuePair<string, string>> headers,
                                string? body, string contentType, bool authenticated)
    {
        var sb = new StringBuilder();
        sb.Append("curl --location \\\n");
        sb.Append("--request ").Append(method.ToUpperInvariant()).Append(' ')
          .Append(Quote(url)).Append(" \\\n");

        if (!string.IsNullOrEmpty(body))
            sb.Append("--header ").Append(Quote("Content-Type: " + contentType)).Append(" \\\n");

        if (authenticated)
            sb.Append("--header ").Append(Quote("Authorization: Bearer " + TokenPlaceholder)).Append(" \\\n");

        foreach (var h in headers)
        {
            if (string.IsNullOrWhiteSpace(h.Key)) continue;
            if (h.Key.Equals("Authorization", StringComparison.OrdinalIgnoreCase)) continue;
            sb.Append("--header ").Append(Quote(h.Key + ": " + h.Value)).Append(" \\\n");
        }

        if (!string.IsNullOrEmpty(body))
            sb.Append("--data-raw ").Append(Quote(body)).Append('\n');
        else
            sb.Length -= 3;                        // drop the trailing " \\\n"

        return sb.ToString().TrimEnd();
    }

    /// <summary>
    /// The same request as a <c>runRestApiAsync</c> call, ready to paste into a
    /// BI report.
    ///
    /// The report runs inside the Fishbowl client and uses the session the
    /// client already holds, so there is no token and no server address — which
    /// is exactly the part people get wrong when translating a cURL command by
    /// hand.
    /// </summary>
    public static string ToRunRestApiAsync(string method, string path,
                                           IEnumerable<KeyValuePair<string, string>> query,
                                           string? body, string contentType)
    {
        var sb = new StringBuilder();
        sb.Append("const result = await runRestApiAsync({\n");
        sb.Append("  method: '").Append(method.ToUpperInvariant()).Append("',\n");
        sb.Append("  path: '").Append(Js(path)).Append("',\n");

        var q = query.Where(p => !string.IsNullOrWhiteSpace(p.Key)).ToList();
        if (q.Count > 0)
        {
            sb.Append("  queryParameters: [\n");
            foreach (var p in q)
                sb.Append("    ['").Append(Js(p.Key)).Append("', '").Append(Js(p.Value)).Append("'],\n");
            sb.Append("  ],\n");
        }

        if (!string.IsNullOrEmpty(body))
        {
            // A JSON body reads far better as an object literal than as an
            // escaped string, and that is how it gets edited afterwards.
            if (contentType.Contains("json", StringComparison.OrdinalIgnoreCase) && LooksLikeJson(body))
                sb.Append("  body: JSON.stringify(").Append(Indent(body.Trim(), "  ")).Append("),\n");
            else
            {
                sb.Append("  body: '").Append(Js(body)).Append("',\n");
                sb.Append("  contentType: '").Append(Js(contentType)).Append("',\n");
            }
        }

        sb.Append("});\n");
        return sb.ToString();
    }

    // ── IN ──────────────────────────────────────────────────────────────

    [GeneratedRegex(@"^(?:curl|CURL)\b")]
    private static partial Regex StartsWithCurl();

    /// <summary>
    /// Read a cURL command. Returns null if it is not one.
    ///
    /// Handles the flags Fishbowl's samples and the browsers' "copy as cURL"
    /// actually emit, and ignores the rest rather than failing: an unrecognised
    /// flag in the middle should not cost you the URL and the body.
    /// </summary>
    public static CurlRequest? Parse(string? text)
    {
        if (string.IsNullOrWhiteSpace(text)) return null;

        var flat = text.Replace("\\\r\n", " ").Replace("\\\n", " ").Replace("^\r\n", " ")
                       .Replace('\r', ' ').Replace('\n', ' ').Trim();
        if (!StartsWithCurl().IsMatch(flat)) return null;

        var args = Split(flat);
        string? url = null, body = null, method = null;
        var headers = new List<KeyValuePair<string, string>>();

        for (var i = 1; i < args.Count; i++)
        {
            var a = args[i];
            string? Next() => i + 1 < args.Count ? args[++i] : null;

            switch (a)
            {
                case "-X" or "--request":
                    method = Next()?.ToUpperInvariant();
                    break;

                case "-H" or "--header":
                    if (Next() is { } h)
                    {
                        var c = h.IndexOf(':');
                        if (c > 0) headers.Add(new(h[..c].Trim(), h[(c + 1)..].Trim()));
                    }
                    break;

                case "-d" or "--data" or "--data-raw" or "--data-binary" or "--data-ascii":
                    body = Next();
                    break;

                case "-u" or "--user" or "-A" or "--user-agent" or "-e" or "--referer"
                     or "--connect-timeout" or "--max-time" or "-o" or "--output":
                    Next();                        // takes a value we do not use
                    break;

                case "--location" or "-L" or "-k" or "--insecure" or "-s" or "--silent"
                     or "-v" or "--verbose" or "-i" or "--include" or "-g" or "--globoff"
                     or "--compressed":
                    break;                         // no value

                default:
                    // An unknown flag may or may not take a value, and there
                    // is no way to tell. So a bare token is only believed to
                    // be the URL when it looks like one — otherwise
                    // "--retry 3" quietly makes "3" the address.
                    if (!a.StartsWith('-') && url is null && LooksLikeUrl(a)) url = a;
                    break;
            }
        }

        if (url is null) return null;

        // curl's own rule: a body with no -X is a POST.
        method ??= body is not null ? "POST" : "GET";
        return new CurlRequest(method, url, headers, body);
    }

    /// <summary>
    /// Could this token be a URL? curl accepts one without a scheme, so the
    /// test is loose: a scheme, a path, or a host:port.
    /// </summary>
    private static bool LooksLikeUrl(string s) =>
        s.Contains("://", StringComparison.Ordinal) ||
        s.Contains('/') ||
        (s.Split(':') is { Length: 2 } parts && parts[1].Length > 0 &&
         parts[1].All(char.IsDigit));

    /// <summary>Split a command line, honouring single and double quotes.</summary>
    private static List<string> Split(string line)
    {
        var args = new List<string>();
        var cur = new StringBuilder();
        char? quote = null;

        for (var i = 0; i < line.Length; i++)
        {
            var c = line[i];

            if (quote is { } q)
            {
                // Inside single quotes nothing escapes — that is POSIX, and it
                // is why the samples use them around JSON.
                if (c == q) { quote = null; continue; }
                if (c == '\\' && q == '"' && i + 1 < line.Length) { cur.Append(line[++i]); continue; }
                cur.Append(c);
                continue;
            }

            if (c is '\'' or '"') { quote = c; continue; }
            if (char.IsWhiteSpace(c))
            {
                if (cur.Length > 0) { args.Add(cur.ToString()); cur.Clear(); }
                continue;
            }
            if (c == '\\' && i + 1 < line.Length && char.IsWhiteSpace(line[i + 1])) continue;
            cur.Append(c);
        }

        if (cur.Length > 0) args.Add(cur.ToString());
        return args;
    }

    // ── helpers ─────────────────────────────────────────────────────────

    /// <summary>Single-quote for a shell, the way curl's own samples do.</summary>
    private static string Quote(string s) =>
        "'" + (s ?? "").Replace("'", "'\\''") + "'";

    private static string Js(string? s) =>
        (s ?? "").Replace("\\", "\\\\").Replace("'", "\\'").Replace("\n", "\\n").Replace("\r", "");

    private static string Indent(string text, string pad) =>
        string.Join('\n', text.Split('\n').Select((l, i) => i == 0 ? l : pad + l));

    private static bool LooksLikeJson(string s)
    {
        var t = s.TrimStart();
        return t.Length > 0 && (t[0] == '{' || t[0] == '[');
    }
}
