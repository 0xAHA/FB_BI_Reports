using System.IO;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace FbReportHost;

/// <summary>
/// Everything that talks to Fishbowl. Two transports:
///
///   REST   http://host:2456/api/... — the modern path. Because these calls
///          are made by HttpClient rather than by the page, no Origin header
///          is sent and the browser's same-origin policy never applies. That
///          is the whole reason this host exists rather than a local web page.
///
///   LEGACY TCP 28192, int32 big-endian length prefix + UTF-8 JSON. Browser
///          JS cannot open a raw socket at all, so a page-based harness has to
///          stub every runApiRequest call. This can actually send them.
/// </summary>
public sealed class FishbowlClient
{
    private readonly HttpClient _http = new() { Timeout = TimeSpan.FromMinutes(5) };

    public string BaseUrl { get; set; } = "http://localhost:2456";
    public string? Token { get; private set; }
    public JsonNode? User { get; private set; }
    public bool IsLoggedIn => !string.IsNullOrEmpty(Token);

    /// <summary>Access-right strings from the login response, e.g. "Sales Order-View".</summary>
    public HashSet<string> Rights { get; } = new(StringComparer.OrdinalIgnoreCase);

    public string AppName { get; set; } = "FB Report Host";
    public int AppId { get; set; } = 9317;

    // ── REST ────────────────────────────────────────────────────────────

    public async Task LoginAsync(string user, string pass, string? mfa = null)
    {
        var body = new JsonObject
        {
            ["appName"] = AppName,
            ["appDescription"] = "Local host for Fishbowl BI reports",
            ["appId"] = AppId,
            ["username"] = user,
            ["password"] = pass,
        };
        if (!string.IsNullOrWhiteSpace(mfa)) body["mfaCode"] = mfa;

        using var req = new HttpRequestMessage(HttpMethod.Post, BaseUrl.TrimEnd('/') + "/api/login")
        {
            Content = new StringContent(body.ToJsonString(), Encoding.UTF8, "application/json")
        };
        using var res = await _http.SendAsync(req);
        var text = await res.Content.ReadAsStringAsync();

        if (!res.IsSuccessStatusCode)
        {
            // MFA arrives as a 401 carrying an "MFA: Required" HEADER, not as a
            // body field — checking the body alone reads it as a bad password.
            if (res.Headers.TryGetValues("MFA", out var mfaHeader))
                throw new InvalidOperationException("MFA required (" + string.Join(",", mfaHeader) + "). Enter the code and sign in again.");

            throw new InvalidOperationException(LoginFailure(res.StatusCode, text));
        }

        var node = JsonNode.Parse(text);
        Token = node?["token"]?.GetValue<string>()
                ?? throw new InvalidOperationException("Login succeeded but returned no token.");
        User = node?["user"];

        Rights.Clear();
        if (User?["moduleAccessList"] is JsonArray arr)
            foreach (var r in arr) if (r is not null) Rights.Add(r.GetValue<string>());
    }

    public async Task LogoutAsync()
    {
        if (!IsLoggedIn) return;
        try { using var _ = await SendAsync(HttpMethod.Post, "/api/logout", null, null); } catch { /* best effort */ }
        Token = null; User = null; Rights.Clear();
    }

    private async Task<HttpResponseMessage> SendAsync(HttpMethod method, string path, string? body, string? contentType)
    {
        var url = BaseUrl.TrimEnd('/') + (path.StartsWith('/') ? path : "/" + path);
        using var req = new HttpRequestMessage(method, url);
        if (!string.IsNullOrEmpty(Token))
            req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", Token);
        if (body is not null)
            req.Content = new StringContent(body, Encoding.UTF8, contentType ?? "application/json");
        return await _http.SendAsync(req);
    }

    /// <summary>A SELECT through /api/data-query. Returns the raw JSON array text.</summary>
    public async Task<string> DataQueryAsync(string sql)
    {
        var url = "/api/data-query?query=" + Uri.EscapeDataString(sql);
        using var res = await SendAsync(HttpMethod.Get, url, null, null);
        var text = await res.Content.ReadAsStringAsync();
        if (!res.IsSuccessStatusCode)
            throw new InvalidOperationException($"Query failed ({(int)res.StatusCode}): {Trim(text)}");
        return string.IsNullOrWhiteSpace(text) ? "[]" : text;
    }

    /// <summary>
    /// The runRestApiAsync contract: {path, method, queryParameters, body, contentType}.
    /// Returns the response text; the JS shim parses it.
    /// </summary>
    public async Task<string> RestAsync(string requestJson)
    {
        var o = JsonNode.Parse(requestJson)?.AsObject()
                ?? throw new ArgumentException("runRestApiAsync: the request must be an object.");
        var path = o["path"]?.GetValue<string>()
                   ?? throw new ArgumentException("runRestApiAsync: `path` is required.");
        var method = new HttpMethod((o["method"]?.GetValue<string>() ?? "GET").ToUpperInvariant());

        if (o["queryParameters"] is JsonArray qp && qp.Count > 0)
        {
            var sb = new StringBuilder(path.Contains('?') ? "&" : "?");
            foreach (var pair in qp)
            {
                if (pair is not JsonArray kv || kv.Count < 2) continue;
                sb.Append(Uri.EscapeDataString(kv[0]!.ToString()))
                  .Append('=')
                  .Append(Uri.EscapeDataString(kv[1]?.ToString() ?? ""))
                  .Append('&');
            }
            path += sb.ToString().TrimEnd('&', '?');
        }

        var body = o["body"]?.GetValue<string>();
        var ctype = o["contentType"]?.GetValue<string>();
        using var res = await SendAsync(method, path, body, ctype);
        var text = await res.Content.ReadAsStringAsync();
        if (!res.IsSuccessStatusCode)
        {
            // Mirror the client's rejection shape so report error handling that
            // reads err.status / err.message behaves the same way here.
            var err = new JsonObject
            {
                ["status"] = (int)res.StatusCode,
                ["message"] = Trim(text),
            };
            throw new FishbowlRestException(err.ToJsonString());
        }
        return text;
    }

    // ── LEGACY SOCKET ───────────────────────────────────────────────────

    public int LegacyPort { get; set; } = 28192;

    /// <summary>
    /// runApiRequest(type, json). The BI bridge takes an UN-enveloped request
    /// ({"ImportRq":{...}}) and wraps it; this does the same wrapping, using
    /// the REST token as the legacy Ticket Key, then unwraps the reply back to
    /// the un-enveloped form the reports expect.
    ///
    /// NOT yet exercised against a live server from this host — the envelope
    /// and framing follow the documented protocol, but treat the first real
    /// call as a test.
    /// </summary>
    public string LegacyRequest(string requestType, string payloadJson)
    {
        var inner = JsonNode.Parse(string.IsNullOrWhiteSpace(payloadJson) ? "{}" : payloadJson);

        // The report may pass either the bare body or {"ImportRq": body}.
        JsonNode? rqBody = inner?[requestType] ?? inner;

        var envelope = new JsonObject
        {
            ["FbiJson"] = new JsonObject
            {
                ["Ticket"] = new JsonObject { ["Key"] = Token ?? "" },
                ["FbiMsgsRq"] = new JsonObject { [requestType] = rqBody?.DeepClone() },
            }
        };

        var replyText = LegacyRoundTrip(envelope.ToJsonString());
        var reply = JsonNode.Parse(replyText);
        // Hand back the un-enveloped body, matching the BI bridge.
        var rs = reply?["FbiJson"]?["FbiMsgsRs"];
        return rs is null ? replyText : rs.ToJsonString();
    }

    private string LegacyRoundTrip(string json)
    {
        var host = new Uri(BaseUrl).Host;
        using var tcp = new TcpClient();
        tcp.Connect(host, LegacyPort);
        using var stream = tcp.GetStream();

        var payload = Encoding.UTF8.GetBytes(json);
        var len = BitConverter.GetBytes(payload.Length);
        if (BitConverter.IsLittleEndian) Array.Reverse(len);   // protocol is big-endian
        stream.Write(len, 0, 4);
        stream.Write(payload, 0, payload.Length);
        stream.Flush();

        var lenBuf = ReadExactly(stream, 4);
        if (BitConverter.IsLittleEndian) Array.Reverse(lenBuf);
        var replyLen = BitConverter.ToInt32(lenBuf, 0);
        if (replyLen <= 0 || replyLen > 128 * 1024 * 1024)
            throw new InvalidOperationException($"Legacy API returned an implausible length ({replyLen}).");
        return Encoding.UTF8.GetString(ReadExactly(stream, replyLen));
    }

    private static byte[] ReadExactly(NetworkStream s, int count)
    {
        var buf = new byte[count];
        var got = 0;
        while (got < count)
        {
            var n = s.Read(buf, got, count - got);
            if (n <= 0) throw new IOException("Legacy API closed the connection mid-message.");
            got += n;
        }
        return buf;
    }

    /// <summary>
    /// What to tell someone whose sign-in was refused.
    ///
    /// A rejected password is the ordinary case and the server's own payload
    /// says nothing a person can act on, so it is replaced outright. Anything
    /// else keeps its detail: a pending app approval, a disabled or locked
    /// account and an out-of-seats server are all refusals you cannot fix by
    /// retyping a password, and hiding them behind "incorrect password" sends
    /// people round in circles.
    /// </summary>
    private static string LoginFailure(System.Net.HttpStatusCode code, string body)
    {
        if (code == System.Net.HttpStatusCode.Unauthorized && !SaysMoreThanBadCredentials(body))
            return "Incorrect username or password.";

        return $"Login failed ({(int)code}): {Trim(Message(body) ?? body)}";
    }

    private static readonly string[] NotACredentialProblem =
        ["approv", "pending", "lock", "disabl", "inactiv", "expire", "licens", "seat", "mfa", "token"];

    private static bool SaysMoreThanBadCredentials(string body)
    {
        var m = (Message(body) ?? body).ToLowerInvariant();
        return NotACredentialProblem.Any(m.Contains);
    }

    /// <summary>The server's own statusMessage, when it sent one.</summary>
    private static string? Message(string body)
    {
        try
        {
            var o = JsonNode.Parse(body)?.AsObject();
            return o?["statusMessage"]?.ToString() ?? o?["message"]?.ToString();
        }
        catch { return null; }
    }

    private static string Trim(string s) =>
        s.Length <= 400 ? s : s[..400] + "…";
}

public sealed class FishbowlRestException(string json) : Exception(json)
{
    public string Json { get; } = json;
}
