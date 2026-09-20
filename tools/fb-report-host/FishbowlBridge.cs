using System.Runtime.InteropServices;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace FbReportHost;

/// <summary>
/// The object exposed to page JS as chrome.webview.hostObjects.fb.
///
/// runQuery is SYNCHRONOUS in Fishbowl and there are 238 call sites across the
/// report suite, so the shim reaches it through hostObjects.SYNC — the only
/// WebView2 path that blocks JS until the host answers. postMessage cannot do
/// this, which is why the bridge is a COM host object rather than a message
/// channel.
///
/// A sync call blocks the UI thread for the duration of the query. That is
/// deliberate: it is exactly what the Fishbowl client does, so a report that
/// feels sluggish here feels sluggish there too. The awaits below are pushed
/// onto the thread pool so the blocking wait cannot deadlock on the UI
/// SynchronizationContext.
/// </summary>
[ComVisible(true)]
[ClassInterface(ClassInterfaceType.AutoDual)]
public class FishbowlBridge
{
    private readonly FishbowlClient _fb;
    private readonly Action<string, string> _log;      // (message, kind)
    private readonly Func<string, string?> _settingGet;
    private readonly Action<string, string> _settingSet;
    private readonly Action<string, string> _openModule;

    public FishbowlBridge(
        FishbowlClient fb,
        Action<string, string> log,
        Func<string, string?> settingGet,
        Action<string, string> settingSet,
        Action<string, string> openModule)
    {
        _fb = fb; _log = log;
        _settingGet = settingGet; _settingSet = settingSet;
        _openModule = openModule;
    }

    /// <summary>Report-scoped blob for loadReportData / saveReportData.</summary>
    public string ReportKey { get; set; } = "";

    private static T Block<T>(Func<Task<T>> f) => Task.Run(f).GetAwaiter().GetResult();

    // ── QUERY ───────────────────────────────────────────────────────────

    public string RunQuery(string sql)
    {
        try
        {
            _log(Shorten(sql), "query");
            return Block(() => _fb.DataQueryAsync(sql));
        }
        catch (Exception ex)
        {
            _log("runQuery failed: " + ex.Message, "error");
            // Fishbowl's runQuery returns nothing rather than throwing unless
            // showErrors is on, and report code overwhelmingly assumes a
            // parseable array comes back.
            return "[]";
        }
    }

    /// <summary>Same call, but surfaced through the async proxy for runQueryAsync.</summary>
    public string RunQueryAsync(string sql) => RunQuery(sql);

    // ── REST ────────────────────────────────────────────────────────────

    public string RunRest(string requestJson)
    {
        _log("REST " + Shorten(requestJson), "info");
        try { return Block(() => _fb.RestAsync(requestJson)); }
        catch (AggregateException ae) when (ae.InnerException is FishbowlRestException fre) { throw new COMException(fre.Json); }
        catch (FishbowlRestException fre) { throw new COMException(fre.Json); }
    }

    // ── LEGACY SOCKET ───────────────────────────────────────────────────

    public string RunApiRequest(string requestType, string payloadJson)
    {
        _log("legacy " + requestType, "info");
        try { return _fb.LegacyRequest(requestType, payloadJson); }
        catch (Exception ex)
        {
            _log("runApiRequest failed: " + ex.Message, "error");
            throw new COMException("runApiRequest(" + requestType + ") failed: " + ex.Message);
        }
    }

    // ── USER / ENVIRONMENT ──────────────────────────────────────────────

    public string GetUser() => _fb.User?.ToJsonString() ?? "{}";

    /// <summary>
    /// Exact match against the login response's moduleAccessList, which already
    /// enumerates every granted right (890 of them on a full-rights account,
    /// with "Full Rights" itself listed alongside the specific ones). Treating
    /// "Full Rights" as a blanket yes would answer true for a MISSPELLED right
    /// too, which silently hides the typo in a report's permission check.
    /// </summary>
    public bool HasUserAccess(string right) => _fb.Rights.Contains(right);

    public string GetLocationGroupList()
    {
        try
        {
            var json = Block(() => _fb.DataQueryAsync(
                "SELECT id FROM locationgroup WHERE activeFlag = 1 ORDER BY name"));
            var ids = new JsonArray();
            if (JsonNode.Parse(json) is JsonArray rows)
                foreach (var r in rows)
                    if (r?["id"] is JsonNode id) ids.Add(JsonValue.Create(id.GetValue<int>()));
            return ids.ToJsonString();
        }
        catch { return "[]"; }
    }

    public string GetProperty(string name, string dflt)
    {
        try
        {
            var sql = "SELECT value FROM systemproperty WHERE name = '" + Esc(name) + "' LIMIT 1";
            if (JsonNode.Parse(Block(() => _fb.DataQueryAsync(sql))) is JsonArray a && a.Count > 0)
            {
                var v = a[0]?["value"];
                if (v is not null) return v.ToString();
            }
        }
        catch { /* fall through to the default */ }
        return dflt;
    }

    // ISO code -> (symbol, locale). currency.symbol is NOT the symbol on a
    // real database — it holds a numeric GLYPH INDEX (this server returns "4"
    // for AUD), so anything numeric has to be discarded and the symbol derived
    // from the code instead.
    private static readonly Dictionary<string, (string Sym, string Loc)> Currencies = new(StringComparer.OrdinalIgnoreCase)
    {
        ["AUD"] = ("$", "en-AU"), ["USD"] = ("$", "en-US"), ["NZD"] = ("$", "en-NZ"),
        ["CAD"] = ("$", "en-CA"), ["GBP"] = ("£", "en-GB"), ["EUR"] = ("€", "en-IE"),
        ["JPY"] = ("¥", "ja-JP"), ["CNY"] = ("¥", "zh-CN"), ["INR"] = ("₹", "en-IN"),
        ["ZAR"] = ("R", "en-ZA"), ["CHF"] = ("CHF", "de-CH"), ["SGD"] = ("$", "en-SG"),
    };

    public string CurrencyLocale()
    {
        var sym = "$";
        var loc = "en-US";
        try
        {
            var sql = "SELECT code, symbol FROM currency WHERE homeCurrency = 1 LIMIT 1";
            if (JsonNode.Parse(Block(() => _fb.DataQueryAsync(sql))) is JsonArray a && a.Count > 0)
            {
                var code = a[0]?["code"]?.ToString() ?? "";
                var raw = a[0]?["symbol"]?.ToString() ?? "";

                if (Currencies.TryGetValue(code, out var hit)) { sym = hit.Sym; loc = hit.Loc; }
                else if (!string.IsNullOrWhiteSpace(code)) sym = code;

                // Only trust the stored symbol when it is genuinely a symbol:
                // not empty, not numeric, not a control character.
                var usable = raw.Length is > 0 and <= 3
                             && !double.TryParse(raw, out _)
                             && !raw.Any(char.IsControl)
                             && !raw.Any(char.IsDigit);
                if (usable) sym = raw;
            }
        }
        catch { /* fall through to the defaults */ }
        return new JsonObject { ["locale"] = loc, ["symbol"] = sym }.ToJsonString();
    }

    public string GetCompanyAddress(int locationGroupId, bool showCountry)
    {
        try
        {
            var sql =
                "SELECT a.name, a.address, a.city, a.zip, s.code AS state, c.name AS country " +
                "FROM company co JOIN address a ON a.accountId = co.accountId " +
                "LEFT JOIN stateconst s ON s.id = a.stateId " +
                "LEFT JOIN countryconst c ON c.id = a.countryId LIMIT 1";
            if (JsonNode.Parse(Block(() => _fb.DataQueryAsync(sql))) is JsonArray a && a.Count > 0)
            {
                var r = a[0]!;
                var bits = new List<string?>
                {
                    r["name"]?.ToString(), r["address"]?.ToString(),
                    string.Join(" ", new[] { r["city"]?.ToString(), r["state"]?.ToString(), r["zip"]?.ToString() }
                        .Where(x => !string.IsNullOrWhiteSpace(x)))
                };
                if (showCountry) bits.Add(r["country"]?.ToString());
                return string.Join("\n", bits.Where(x => !string.IsNullOrWhiteSpace(x)));
            }
        }
        catch { /* ignore */ }
        return "";
    }

    // ── NAVIGATION (no equivalent outside the client) ───────────────────

    public void OpenModule(string moduleName, string item)
    {
        _log("openModule(\"" + moduleName + "\", \"" + item + "\") — no-op outside the Fishbowl client", "warning");
        _openModule(moduleName, item);
    }

    // ── SETTINGS ────────────────────────────────────────────────────────

    public string LoadSettings(string key) => _settingGet("u:" + key) ?? "";
    public void SaveSettings(string key, string value) => _settingSet("u:" + key, value);
    public string LoadReportData() => _settingGet("r:" + ReportKey) ?? "";
    public void SaveReportData(string value) => _settingSet("r:" + ReportKey, value);

    // ── NOT AVAILABLE ───────────────────────────────────────────────────

    /// <summary>
    /// getAutoPo / getAutoMo run Fishbowl's own reorder engine and have no REST
    /// or SQL equivalent, so they cannot be reproduced here. Returning an empty
    /// array quietly would look like "nothing to reorder", which is worse than
    /// saying so.
    /// </summary>
    public string Unsupported(string fn) =>
        throw new COMException(fn + "() is not available outside the Fishbowl client — " +
                               "it runs Fishbowl's own engine and has no REST equivalent.");

    private static string Esc(string s) => s.Replace("'", "''");
    private static string Shorten(string s)
    {
        s = s.Replace("\r", " ").Replace("\n", " ").Trim();
        while (s.Contains("  ")) s = s.Replace("  ", " ");
        return s.Length <= 160 ? s : s[..160] + "…";
    }
}
