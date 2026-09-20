using System.Diagnostics;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace FbApiTool;

/// <summary>What came back, in enough detail to debug an integration with.</summary>
public sealed record ApiResult(
    string Method,
    string Url,
    int Status,
    string Reason,
    string Body,
    bool IsJson,
    long Millis,
    long Bytes,
    List<KeyValuePair<string, string>> ResponseHeaders,
    List<KeyValuePair<string, string>> RequestHeaders,
    string? RequestBody)
{
    public bool Ok => Status is >= 200 and < 300;
}

/// <summary>
/// Sends the request the form describes.
///
/// A native HttpClient rather than the browser fetch the HTML tool had to use:
/// Fishbowl answers cross-origin calls with a 200 and no
/// Access-Control-Allow-Origin header, so a page served from anywhere other
/// than the server itself is blocked from reading any response. Nothing here
/// sends an Origin header at all, so that whole class of failure disappears —
/// which is the main reason this port is worth having.
/// </summary>
public sealed class ApiRunner
{
    private readonly HttpClient _http = new(new HttpClientHandler
    {
        // The tool is pointed at on-premise servers, which routinely run with a
        // self-signed certificate. Refusing those would make it useless for the
        // job it exists to do; it never leaves the operator's own network.
        ServerCertificateCustomValidationCallback = HttpClientHandler.DangerousAcceptAnyServerCertificateValidator,
        AllowAutoRedirect = true,
    })
    { Timeout = TimeSpan.FromMinutes(5) };

    /// <summary>Redacted before anything reaches the log.</summary>
    public const string Redacted = "Bearer …";

    public async Task<ApiResult> SendAsync(
        string baseUrl,
        string method,
        string path,
        IEnumerable<KeyValuePair<string, string>> query,
        IEnumerable<KeyValuePair<string, string>> headers,
        string? body,
        string contentType,
        string? token,
        CancellationToken ct = default)
    {
        var url = BuildUrl(baseUrl, path, query);
        using var req = new HttpRequestMessage(new HttpMethod(method.ToUpperInvariant()), url);

        var sent = new List<KeyValuePair<string, string>>();

        if (!string.IsNullOrEmpty(token))
        {
            req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
            sent.Add(new("Authorization", Redacted));
        }

        foreach (var h in headers)
        {
            if (string.IsNullOrWhiteSpace(h.Key)) continue;
            // Content-* headers belong on the content, not the request.
            if (h.Key.StartsWith("Content-", StringComparison.OrdinalIgnoreCase)) continue;
            req.Headers.TryAddWithoutValidation(h.Key, h.Value);
            sent.Add(new(h.Key, h.Value));
        }

        // A body goes wherever one was typed, GET included: /api/data-query
        // is documented as a GET carrying the SQL as application/sql, and the
        // server's own curl sample sends it that way.
        if (!string.IsNullOrEmpty(body))
        {
            req.Content = new StringContent(body ?? "", Encoding.UTF8);
            req.Content.Headers.ContentType = MediaTypeHeaderValue.Parse(contentType);
            sent.Add(new("Content-Type", contentType));
        }

        var sw = Stopwatch.StartNew();
        using var res = await _http.SendAsync(req, HttpCompletionOption.ResponseContentRead, ct);
        var text = await res.Content.ReadAsStringAsync(ct);
        sw.Stop();

        var got = new List<KeyValuePair<string, string>>();
        foreach (var h in res.Headers) got.Add(new(h.Key, string.Join(", ", h.Value)));
        foreach (var h in res.Content.Headers) got.Add(new(h.Key, string.Join(", ", h.Value)));

        return new ApiResult(
            method.ToUpperInvariant(), url, (int)res.StatusCode, res.ReasonPhrase ?? "",
            text, LooksLikeJson(text), sw.ElapsedMilliseconds,
            Encoding.UTF8.GetByteCount(text), got, sent, body);
    }

    public static string BuildUrl(string baseUrl, string path, IEnumerable<KeyValuePair<string, string>> query)
    {
        var url = baseUrl.TrimEnd('/') + (path.StartsWith('/') ? path : "/" + path);
        var qs = query.Where(q => !string.IsNullOrWhiteSpace(q.Key))
                      .Select(q => Uri.EscapeDataString(q.Key) + "=" + Uri.EscapeDataString(q.Value ?? ""))
                      .ToList();
        return qs.Count == 0 ? url : url + (url.Contains('?') ? "&" : "?") + string.Join("&", qs);
    }

    /// <summary>
    /// The inverse of <see cref="BuildUrl"/>: take a URL somebody typed and
    /// get back the three pieces a request is made of.
    ///
    /// Typed by hand, it may be absolute or just a path, and the host may not
    /// be the one currently connected — pointing a single call at another
    /// server is a reasonable thing to want, so the host that was typed wins.
    /// Query values are unescaped here because they are escaped again on the
    /// way out, and doing neither or both is what turns a space into %2520.
    /// </summary>
    public static (string BaseUrl, string Path, List<KeyValuePair<string, string>> Query)
        SplitUrl(string? url, string fallbackBase)
    {
        var text = (url ?? "").Trim();
        string root, rest;

        var scheme = text.IndexOf("://", StringComparison.Ordinal);
        if (scheme > 0)
        {
            var slash = text.IndexOf('/', scheme + 3);
            root = slash < 0 ? text : text[..slash];
            rest = slash < 0 ? "/" : text[slash..];
        }
        else
        {
            root = fallbackBase;
            rest = text.StartsWith('/') ? text : "/" + text;
        }

        var query = new List<KeyValuePair<string, string>>();
        var mark = rest.IndexOf('?');
        var path = mark < 0 ? rest : rest[..mark];

        if (mark >= 0)
        {
            foreach (var pair in rest[(mark + 1)..].Split('&', StringSplitOptions.RemoveEmptyEntries))
            {
                var eq = pair.IndexOf('=');
                var k = eq < 0 ? pair : pair[..eq];
                var v = eq < 0 ? "" : pair[(eq + 1)..];
                query.Add(new KeyValuePair<string, string>(Unescape(k), Unescape(v)));
            }
        }

        return (root.TrimEnd('/'), path, query);
    }

    /// <summary>A malformed escape is left as typed rather than throwing.</summary>
    private static string Unescape(string s)
    {
        try { return Uri.UnescapeDataString(s); } catch { return s; }
    }

    private static bool LooksLikeJson(string s)
    {
        var t = s.TrimStart();
        if (t.Length == 0 || (t[0] != '{' && t[0] != '[')) return false;
        try { JsonNode.Parse(s); return true; } catch { return false; }
    }

    /// <summary>Pretty-print when it parses; hand it back untouched when it does not.</summary>
    public static string Pretty(string json)
    {
        try
        {
            using var doc = JsonDocument.Parse(json);
            return JsonSerializer.Serialize(doc.RootElement, new JsonSerializerOptions
            {
                WriteIndented = true,
                Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
            });
        }
        catch { return json; }
    }

    /// <summary>
    /// The rows of a JSON response, for the table view. Handles both a bare
    /// array and the paged envelope every search endpoint returns.
    /// </summary>
    public static (List<string> Columns, List<Dictionary<string, string>> Rows) Tabulate(string json)
    {
        var cols = new List<string>();
        var rows = new List<Dictionary<string, string>>();
        JsonNode? node;
        try { node = JsonNode.Parse(json); } catch { return (cols, rows); }

        var arr = node as JsonArray ?? node?["results"] as JsonArray ?? node?["rows"] as JsonArray;
        if (arr is null)
        {
            if (node is JsonObject single) arr = [single.DeepClone()];
            else return (cols, rows);
        }

        foreach (var item in arr)
        {
            if (item is not JsonObject o) continue;
            var row = new Dictionary<string, string>();
            foreach (var (k, v) in o)
            {
                if (!cols.Contains(k)) cols.Add(k);
                row[k] = v switch
                {
                    null => "",
                    JsonValue val => val.ToString(),
                    _ => v.ToJsonString(),          // nested object/array, shown as JSON
                };
            }
            rows.Add(row);
        }
        return (cols, rows);
    }
}
