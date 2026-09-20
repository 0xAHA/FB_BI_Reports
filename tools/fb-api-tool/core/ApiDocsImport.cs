using System.IO;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace FbApiTool;

/// <summary>
/// Reads a server's own <c>/apidocs.json</c> and turns it into a catalog.
///
/// The document is not OpenAPI — it is Fishbowl's own shape:
///
///   { "version": "26.9",
///     "sections": [ { "name", "description", "endpoints": [
///        { "id", "title", "description",
///          "endpoint":       { "verb", "path", "hide" },
///          "queryParameters":[ { "name", "type", "description" } ],
///          "attributes":     [ { "name", "type", "optional", "description",
///                                "children": [ … ] } ],
///          "requestObject":  { "title": { "verb", "endpointUrl" }, "curl" } } ] } ] }
///
/// Everything the request form needs is in there, which is why the tool can
/// scaffold a new endpoint without a code change: the path gives the path
/// parameters, queryParameters gives the query form, and the attribute tree
/// gives both the schema table and a request body template.
/// </summary>
public static class ApiDocsImport
{
    /// <summary>
    /// The memo endpoints are published ONCE against a placeholder object, so
    /// taking them literally would put a useless "/api/&lt;OBJECT ENDPOINT&gt;/…"
    /// row in the sidebar and permanently report five endpoints as missing.
    /// They are expanded to the order types that actually accept memos.
    /// </summary>
    public const string ObjectPlaceholder = "<OBJECT ENDPOINT>";

    private static readonly (string Path, string Category)[] MemoObjects =
    [
        ("/api/manufacture-orders", "MO Memos"),
        ("/api/purchase-orders",    "PO Memos"),
        ("/api/sales-orders",       "SO Memos"),
        ("/api/work-orders",        "WO Memos"),
    ];

    public static string DocsUrl(string baseUrl) => baseUrl.TrimEnd('/') + "/apidocs.json";

    /// <summary>
    /// Fetch the document. Deliberately unauthenticated — /apidocs.json is
    /// served without a token, so the version can be checked before sign-in.
    /// </summary>
    public static async Task<string> FetchAsync(string baseUrl, CancellationToken ct = default)
    {
        using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(60) };
        using var res = await http.GetAsync(DocsUrl(baseUrl), ct);
        var text = await res.Content.ReadAsStringAsync(ct);
        if (!res.IsSuccessStatusCode)
            throw new InvalidOperationException(
                $"{DocsUrl(baseUrl)} returned {(int)res.StatusCode}. Is the server running and is this the right address?");
        if (string.IsNullOrWhiteSpace(text))
            throw new InvalidOperationException("The server returned an empty document.");
        return text;
    }

    public static ApiCatalog Parse(string json)
    {
        var root = JsonNode.Parse(json)?.AsObject()
                   ?? throw new InvalidDataException("apidocs.json is not a JSON object.");

        var cat = new ApiCatalog
        {
            Version = root["version"]?.GetValue<string>() ?? "",
            Source = "apidocs.json",
            Generated = DateTime.Now.ToString("yyyy-MM-dd"),
        };

        if (root["sections"] is not JsonArray sections)
            throw new InvalidDataException("apidocs.json has no \"sections\" array — is this really a Fishbowl API document?");

        foreach (var sn in sections)
        {
            if (sn?.AsObject() is not { } section) continue;
            var sectionName = section["name"]?.GetValue<string>() ?? "Other";
            if (section["endpoints"] is not JsonArray endpoints) continue;

            foreach (var en in endpoints)
            {
                if (en?.AsObject() is not { } e) continue;
                var ep = e["endpoint"]?.AsObject();
                var verb = ep?["verb"]?.GetValue<string>();
                // A blank verb marks a documentation-only entry (the JSON import
                // note), and "hide" marks one the server does not want listed.
                if (string.IsNullOrWhiteSpace(verb)) continue;
                if (ep?["hide"]?.GetValue<bool>() == true) continue;

                // endpoint.path is the structured field and is the one to
                // trust. The endpointUrl inside requestObject is display text
                // for a curl sample and is not always right: 26.9 publishes
                // "Update a manufacture order" with endpointUrl
                // /api/manufacture-orders, dropping the /{id}, which collides
                // it with Create and silently overwrote Create in the catalog.
                var rawPath = (ep?["path"]?.GetValue<string>() ?? "").Trim();
                if (rawPath.Length > 0)
                {
                    if (!rawPath.StartsWith("/api", StringComparison.OrdinalIgnoreCase) &&
                        !rawPath.TrimStart('/').StartsWith(ObjectPlaceholder, StringComparison.Ordinal))
                        rawPath = "/api" + (rawPath.StartsWith('/') ? rawPath : "/" + rawPath);
                }
                else
                {
                    rawPath = (e["requestObject"]?["title"]?["endpointUrl"]?.GetValue<string>() ?? "").Trim();
                    if (rawPath.Length == 0) continue;
                }

                foreach (var built in Build(e, verb!.ToUpperInvariant(), rawPath, sectionName))
                    cat.Endpoints.Add(built);
            }
        }

        return cat;
    }

    /// <summary>One documented entry becomes one endpoint — or several, when it is a memo template.</summary>
    private static IEnumerable<ApiEndpoint> Build(JsonObject e, string verb, string rawPath, string section)
    {
        var id = e["id"]?.GetValue<string>() ?? "";
        var title = e["title"]?.GetValue<string>() ?? id;
        var desc = e["description"]?.GetValue<string>() ?? "";

        var attrs = new List<ApiAttr>();
        if (e["attributes"] is JsonArray aa) Flatten(aa, "", attrs);

        var qps = new List<ApiParam>();
        if (e["queryParameters"] is JsonArray qa)
            foreach (var q in qa)
                if (q?.AsObject() is { } qo)
                    qps.Add(new ApiParam
                    {
                        Name = qo["name"]?.GetValue<string>() ?? "",
                        Description = qo["description"]?.GetValue<string>() ?? "",
                    });

        // A body template only makes sense where a body is accepted at all.
        var body = verb is "POST" or "PUT" or "PATCH" && e["attributes"] is JsonArray ba && ba.Count > 0
            ? BuildBody(ba)
            : null;

        if (!rawPath.Contains(ObjectPlaceholder, StringComparison.Ordinal))
        {
            yield return Make(id, section, verb, rawPath, title, desc, qps, attrs, body);
            yield break;
        }

        foreach (var (objPath, objCat) in MemoObjects)
        {
            var path = rawPath.Replace(ObjectPlaceholder, objPath, StringComparison.Ordinal);
            if (!path.StartsWith("/api", StringComparison.OrdinalIgnoreCase))
                path = "/api/" + path.TrimStart('/');
            // The object path already carries /api, so collapse any doubling.
            path = path.Replace("/api/api/", "/api/", StringComparison.Ordinal);
            var slug = objCat.Split(' ')[0].ToLowerInvariant();
            yield return Make(slug + "-" + id, objCat, verb, path, title, desc, qps, attrs, body);
        }
    }

    private static ApiEndpoint Make(string id, string cat, string verb, string path, string name,
                                    string desc, List<ApiParam> qps, List<ApiAttr> attrs, string? body)
    {
        var norm = ApiEndpoint.Normalise(path);
        return new ApiEndpoint
        {
            Id = string.IsNullOrWhiteSpace(id) ? Slug(verb + "-" + norm) : id,
            Category = cat,
            Method = verb,
            Path = norm,
            Name = name,
            Description = desc,
            RequiresAuth = !norm.Equals("/api/login", StringComparison.OrdinalIgnoreCase),
            PathParams = PathParamsOf(norm),
            QueryParams = qps,
            Attributes = attrs,
            BodySample = body,
        };
    }

    private static string Slug(string s) =>
        new(s.ToLowerInvariant().Select(c => char.IsLetterOrDigit(c) ? c : '-').ToArray());

    /// <summary>The {placeholders} in a path, in the order they appear.</summary>
    public static List<string> PathParamsOf(string path) =>
        System.Text.RegularExpressions.Regex.Matches(path, @"\{([A-Za-z0-9_]+)\}")
              .Select(m => m.Groups[1].Value).ToList();

    // ── ATTRIBUTES ──────────────────────────────────────────────────────

    /// <summary>
    /// Flatten the nested attribute tree to the dotted paths the schema table
    /// shows: a list's children are addressed through "[]" and an object's
    /// through ".", so a serial number ends up as
    /// trackingItems[].serialNumbers[].numbers[].value.
    /// </summary>
    public static void Flatten(JsonArray nodes, string prefix, List<ApiAttr> into)
    {
        foreach (var n in nodes)
        {
            if (n?.AsObject() is not { } o) continue;
            var name = o["name"]?.GetValue<string>() ?? "";
            var type = o["type"]?.GetValue<string>() ?? "";
            var full = prefix + name;

            into.Add(new ApiAttr
            {
                Name = full,
                Type = type,
                Optional = o["optional"]?.GetValue<bool>() == true,
                Description = o["description"]?.GetValue<string>() ?? "",
            });

            if (o["children"] is JsonArray kids && kids.Count > 0)
                Flatten(kids, full + (IsList(type) ? "[]." : "."), into);
        }
    }

    private static bool IsList(string type) =>
        type.Contains("list", StringComparison.OrdinalIgnoreCase) ||
        type.Contains("array", StringComparison.OrdinalIgnoreCase);

    // ── BODY TEMPLATE ───────────────────────────────────────────────────

    /// <summary>
    /// Turn the attribute tree into an editable request body.
    ///
    /// A list becomes a one-element array so the shape of its members is
    /// visible and editable; every scalar gets the empty value for its
    /// documented type. This reproduces the bodies the HTML tool carried by
    /// hand, which is what makes a scaffolded endpoint usable immediately
    /// rather than leaving the user to invent the JSON from the schema table.
    /// </summary>
    public static string BuildBody(JsonArray attributes)
    {
        var sb = new StringBuilder();
        WriteObject(attributes, sb, 0);
        return sb.ToString();
    }

    private static void WriteObject(JsonArray attrs, StringBuilder sb, int depth)
    {
        var pad = new string(' ', (depth + 1) * 2);
        sb.Append("{\n");
        for (var i = 0; i < attrs.Count; i++)
        {
            if (attrs[i]?.AsObject() is not { } o) continue;
            sb.Append(pad).Append('"').Append(o["name"]?.GetValue<string>()).Append("\": ");
            WriteValue(o, sb, depth + 1);
            if (i < attrs.Count - 1) sb.Append(',');
            sb.Append('\n');
        }
        sb.Append(new string(' ', depth * 2)).Append('}');
    }

    private static void WriteValue(JsonObject attr, StringBuilder sb, int depth)
    {
        var type = attr["type"]?.GetValue<string>() ?? "string";
        var kids = attr["children"] as JsonArray;

        if (IsList(type))
        {
            if (kids is null || kids.Count == 0) { sb.Append("[]"); return; }
            sb.Append("[\n").Append(new string(' ', (depth + 1) * 2));
            WriteObject(kids, sb, depth + 1);
            sb.Append('\n').Append(new string(' ', depth * 2)).Append(']');
            return;
        }

        if (kids is { Count: > 0 }) { WriteObject(kids, sb, depth); return; }

        sb.Append(Empty(type));
    }

    /// <summary>The placeholder value for a documented type.</summary>
    private static string Empty(string type)
    {
        var t = type.ToLowerInvariant();
        if (t.StartsWith("bool")) return "true";
        if (t.StartsWith("int") || t.StartsWith("long") || t.StartsWith("number") ||
            t.StartsWith("quantity") || t.StartsWith("money") || t.StartsWith("decimal") ||
            t.StartsWith("double") || t.StartsWith("float")) return "0";
        return "\"\"";
    }
}
