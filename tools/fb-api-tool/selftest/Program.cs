using System.Text.Json.Nodes;
using FbReportHost;   // the shared REST client

namespace FbApiTool;

/// <summary>
/// Everything in the API tool that does not need a window: the catalog, the
/// /apidocs.json importer, the diff engine and the request runner.
///
///   dotnet run --project selftest -- [server] [user] [password]
///
/// Without credentials it runs the offline checks, plus the importer against
/// the live document if the server is reachable. The single most important
/// check here is that a body template GENERATED from the server's field tree
/// matches the one a human wrote into the catalog: that equivalence is the
/// whole basis for letting the tool scaffold an endpoint it has never seen.
/// </summary>
internal static class Program
{
    private static int _fail;

    private static async Task<int> Main(string[] args)
    {
        var server = args.Length > 0 ? args[0] : "http://localhost:2456";
        var user = args.Length > 1 ? args[1] : null;
        var pass = args.Length > 2 ? args[2] : null;

        var root = FindProject();
        if (root is null) { Console.Error.WriteLine("Could not find the fb-api-tool folder."); return 1; }
        var catalogPath = Path.Combine(root, "assets", "catalog.json");
        Console.WriteLine("project : " + root);
        Console.WriteLine("catalog : " + catalogPath + "\n");

        Section("1. The shipped catalog");
        ApiCatalog shipped;
        try { shipped = ApiCatalog.Read(catalogPath); }
        catch (Exception ex) { Check("catalog reads", false, ex.Message); return Done(); }

        Check("catalog reads", true, shipped.Endpoints.Count + " endpoints, v" + shipped.Version);
        Check("every endpoint has a verb and a path",
              shipped.Endpoints.All(e => e.Method.Length > 0 && e.Path.StartsWith('/')), "");
        Check("every endpoint has an id", shipped.Endpoints.All(e => e.Id.Length > 0), "");
        Check("ids are unique",
              shipped.Endpoints.Select(e => e.Id).Distinct().Count() == shipped.Endpoints.Count,
              Dupes(shipped.Endpoints.Select(e => e.Id)));
        Check("method+path keys are unique",
              shipped.Endpoints.Select(e => e.Key).Distinct().Count() == shipped.Endpoints.Count,
              Dupes(shipped.Endpoints.Select(e => e.Key)));
        Check("every category has an icon",
              shipped.Categories.All(c => shipped.CategoryIcons.ContainsKey(c)),
              string.Join(", ", shipped.Categories.Where(c => !shipped.CategoryIcons.ContainsKey(c))));
        // Exactly two endpoints are reachable without a token, and both by
        // design: /api/login is how you GET one, and /apidocs.json is served
        // unauthenticated so a client can check the version before signing in.
        // Anything else in this list would be a mistake in the catalog.
        var open = shipped.Endpoints.Where(e => !e.RequiresAuth).Select(e => e.Path).OrderBy(p => p).ToList();
        Check("only login and apidocs.json are marked as needing no token",
              open.SequenceEqual(["/api/login", "/apidocs.json"]), string.Join(", ", open));
        Check("path parameters match the path text",
              shipped.Endpoints.All(e => e.PathParams.OrderBy(x => x)
                    .SequenceEqual(ApiDocsImport.PathParamsOf(e.Path).OrderBy(x => x))),
              First(shipped.Endpoints.Where(e => !e.PathParams.OrderBy(x => x)
                    .SequenceEqual(ApiDocsImport.PathParamsOf(e.Path).OrderBy(x => x))).Select(e => e.Key)));

        Section("2. Path normalisation");
        Check("\":id\" and \"{id}\" collapse to one spelling",
              ApiEndpoint.Normalise("/api/parts/:id/inventory/add") == "/api/parts/{id}/inventory/add", "");
        Check("a missing leading slash is added", ApiEndpoint.Normalise("api/parts") == "/api/parts", "");
        Check("a trailing slash is dropped", ApiEndpoint.Normalise("/api/parts/") == "/api/parts", "");
        Check("the root survives", ApiEndpoint.Normalise("/") == "/", "");

        Section("3. Body templates generated from a field tree");
        // The exact tree the docs publish for Add Inventory, abridged to the
        // shapes that matter: an object, a scalar, and a list of objects.
        var tree = JsonNode.Parse("""
        [
          { "name": "location", "type": "reference object", "optional": true,
            "children": [ { "name": "id", "type": "integer" } ] },
          { "name": "quantity", "type": "quantity" },
          { "name": "unitCost", "type": "money", "optional": true },
          { "name": "note",     "type": "string", "optional": true },
          { "name": "oneTime",  "type": "boolean" },
          { "name": "trackingItems", "type": "list", "optional": true,
            "children": [
              { "name": "value", "type": "string" },
              { "name": "partTracking", "type": "reference object",
                "children": [ { "name": "id", "type": "integer" } ] }
            ] }
        ]
        """)!.AsArray();

        var body = ApiDocsImport.BuildBody(tree);
        Check("the template is valid JSON", Parses(body), Trim(body));
        var o = JsonNode.Parse(body)!.AsObject();
        Check("an integer becomes 0", o["location"]!["id"]!.GetValue<int>() == 0, "");
        Check("a quantity becomes 0", o["quantity"]!.GetValue<int>() == 0, "");
        Check("money becomes 0", o["unitCost"]!.GetValue<int>() == 0, "");
        Check("a string becomes \"\"", o["note"]!.GetValue<string>() == "", "");
        Check("a boolean becomes true", o["oneTime"]!.GetValue<bool>(), "");
        Check("a list becomes a one-element array, so its shape is editable",
              o["trackingItems"] is JsonArray { Count: 1 }, "");
        Check("nested objects inside a list survive",
              o["trackingItems"]![0]!["partTracking"]!["id"]!.GetValue<int>() == 0, "");

        Section("4. Attribute flattening");
        var flat = new List<ApiAttr>();
        ApiDocsImport.Flatten(tree, "", flat);
        Check("an object child uses a dot", flat.Any(a => a.Name == "location.id"), "");
        Check("a list child uses []", flat.Any(a => a.Name == "trackingItems[].value"), "");
        Check("nesting through both composes",
              flat.Any(a => a.Name == "trackingItems[].partTracking.id"), "");
        Check("optional is carried through",
              flat.First(a => a.Name == "location").Optional &&
              !flat.First(a => a.Name == "quantity").Optional, "");

        Section("5. Reading the live /apidocs.json");
        string? docsJson = null;
        try { docsJson = await ApiDocsImport.FetchAsync(server); }
        catch (Exception ex) { Console.WriteLine("  (skipped — " + ex.Message + ")"); }

        ApiCatalog? live = null;
        if (docsJson is not null)
        {
            live = ApiDocsImport.Parse(docsJson);
            Check("parsed", live.Endpoints.Count > 0, live.Endpoints.Count + " endpoints, v" + live.Version);
            Check("a version came back", live.Version.Length > 0, live.Version);
            Check("every path starts /api", live.Endpoints.All(e => e.Path.StartsWith("/api")),
                  First(live.Endpoints.Where(e => !e.Path.StartsWith("/api")).Select(e => e.Path)));
            Check("no \":param\" left unconverted", live.Endpoints.All(e => !e.Path.Contains(':')),
                  First(live.Endpoints.Where(e => e.Path.Contains(':')).Select(e => e.Path)));

            // The memo endpoints are published once against a placeholder. Left
            // literal they would be unusable AND would report as missing forever.
            Check("the <OBJECT ENDPOINT> placeholder is gone",
                  live.Endpoints.All(e => !e.Path.Contains(ApiDocsImport.ObjectPlaceholder)),
                  First(live.Endpoints.Where(e => e.Path.Contains(ApiDocsImport.ObjectPlaceholder)).Select(e => e.Path)));
            Check("memos expanded to the concrete order types",
                  live.Endpoints.Any(e => e.Path == "/api/sales-orders/{id}/memos") &&
                  live.Endpoints.Any(e => e.Path == "/api/work-orders/{id}/memos"),
                  live.Endpoints.Count(e => e.Path.EndsWith("/memos")) + " memo list endpoints");

            Check("POSTs with fields got a body template",
                  live.Endpoints.Where(e => e.Method == "POST" && e.Attributes.Count > 0)
                      .All(e => e.BodySample is not null), "");
            Check("every generated body is valid JSON",
                  live.Endpoints.Where(e => e.BodySample is not null).All(e => Parses(e.BodySample!)),
                  First(live.Endpoints.Where(e => e.BodySample is not null && !Parses(e.BodySample!)).Select(e => e.Key)));
            Check("GETs got no body template",
                  live.Endpoints.Where(e => e.Method == "GET").All(e => e.BodySample is null), "");

            // THE claim this whole feature rests on: a scaffolded body is the
            // same body a person wrote by hand.
            var mine = shipped.Endpoints.FirstOrDefault(e => e.Key == "POST /api/parts/{id}/inventory/add");
            var theirs = live.Endpoints.FirstOrDefault(e => e.Key == "POST /api/parts/{id}/inventory/add");
            if (mine?.BodySample is not null && theirs?.BodySample is not null)
                Check("a generated body matches the hand-written one (Add Inventory)",
                      Same(mine.BodySample, theirs.BodySample),
                      Same(mine.BodySample, theirs.BodySample) ? "identical" : Trim(theirs.BodySample));
            else Console.WriteLine("  (skipped the body-equivalence check — endpoint not in both)");

            var flatMine = mine?.Attributes.Select(a => a.Name).OrderBy(x => x).ToList() ?? [];
            var flatTheirs = theirs?.Attributes.Select(a => a.Name).OrderBy(x => x).ToList() ?? [];
            if (flatMine.Count > 0 && flatTheirs.Count > 0)
                Check("generated field paths match the hand-written ones",
                      flatMine.SequenceEqual(flatTheirs),
                      flatMine.SequenceEqual(flatTheirs) ? flatMine.Count + " fields"
                          : "only here: " + string.Join(",", flatMine.Except(flatTheirs).Take(4)) +
                            " / only there: " + string.Join(",", flatTheirs.Except(flatMine).Take(4)));
        }

        if (live is not null)
        {
            Section("5b. What this server would actually propose");
            var real = CatalogDiff.Compare(shipped, live);
            Console.WriteLine("  " + real.Summary);
            foreach (var c in real.Changes.Where(x => x.Kind != ChangeKind.MissingFromServer).Take(12))
                Console.WriteLine("    " + c.KindLabel.PadRight(8) + " " + c.Header + "   " + First(c.Details));
            if (real.AddedCount + real.ChangedCount > 12) Console.WriteLine("    …");

            // The catalog was built against this API version, so a pile of
            // additions here would mean the importer is mis-reading paths
            // rather than that the server has genuinely grown 50 endpoints.
            Check("the same-version diff is small enough to be believable",
                  real.AddedCount + real.ChangedCount < 30,
                  real.Summary);
            Check("applying it never loses a catalogued endpoint",
                  CatalogDiff.Apply(shipped, real).Endpoints.Count >= shipped.Endpoints.Count,
                  shipped.Endpoints.Count + " → " + CatalogDiff.Apply(shipped, real).Endpoints.Count);
        }

        Section("6. Diff and merge");
        // A synthetic pair, so the check does not depend on which server is up.
        var baseline = ApiCatalog.Read(catalogPath);
        var incoming = ApiCatalog.Read(catalogPath);
        incoming.Version = "99.9";
        incoming.Endpoints.Add(new ApiEndpoint
        {
            Id = "brand-new", Category = "Widgets", Method = "GET", Path = "/api/widgets",
            Name = "Search widgets",
            QueryParams = [new ApiParam { Name = "pageSize", Description = "How many." }],
        });
        var victim = incoming.Endpoints.First(e => e.Key == "GET /api/parts/inventory");
        victim.QueryParams.Add(new ApiParam { Name = "newFilter", Description = "Added in 99.9." });
        var removed = incoming.Endpoints.First(e => e.Key == "GET /api/location-groups");
        incoming.Endpoints.Remove(removed);

        var diff = CatalogDiff.Compare(baseline, incoming);
        Check("the version difference is noticed", diff.VersionDiffers, diff.CurrentVersion + " → " + diff.IncomingVersion);
        Check("a new endpoint is proposed", diff.Changes.Any(c => c.Kind == ChangeKind.Added && c.Key == "GET /api/widgets"), "");
        Check("a new query parameter is proposed",
              diff.Changes.Any(c => c.Kind == ChangeKind.Changed && c.Key == "GET /api/parts/inventory" &&
                                    c.Details.Any(d => d.Contains("newFilter"))), "");
        Check("a dropped endpoint is reported, not assumed deleted",
              diff.Changes.Any(c => c.Kind == ChangeKind.MissingFromServer && c.Key == "GET /api/location-groups"), "");
        Check("removals default to NOT applying",
              diff.Changes.Where(c => c.Kind == ChangeKind.MissingFromServer).All(c => !c.Apply), "");
        Check("additions default to applying",
              diff.Changes.Where(c => c.Kind == ChangeKind.Added).All(c => c.Apply), "");
        Check("nothing is both added and removed",
              !diff.Changes.Where(c => c.Kind == ChangeKind.Added)
                   .Select(c => c.Key)
                   .Intersect(diff.Changes.Where(c => c.Kind == ChangeKind.MissingFromServer).Select(c => c.Key))
                   .Any(), "");

        var merged = CatalogDiff.Apply(baseline, diff);
        Check("the merge adds the new endpoint", merged.Endpoints.Any(e => e.Key == "GET /api/widgets"), "");
        Check("the merge refreshes the changed one",
              merged.Endpoints.First(e => e.Key == "GET /api/parts/inventory")
                    .QueryParams.Any(q => q.Name == "newFilter"), "");
        Check("the merge KEEPS what the server did not mention",
              merged.Endpoints.Any(e => e.Key == "GET /api/location-groups"), "");
        Check("the version moves to the server's", merged.Version == "99.9", merged.Version);
        Check("a scaffolded category gets an icon", merged.CategoryIcons.ContainsKey("Widgets"), "");
        Check("nothing was lost", merged.Endpoints.Count == baseline.Endpoints.Count + 1,
              baseline.Endpoints.Count + " → " + merged.Endpoints.Count);

        // And a curated note must survive a refresh of the same endpoint.
        var noted = ApiCatalog.Read(catalogPath);
        var target = noted.Endpoints.First(e => e.Key == "GET /api/parts/inventory");
        target.Description = "Searches for inventory. LOCAL NOTE: beware page 1 indexing.";
        var diff2 = CatalogDiff.Compare(noted, incoming);
        var merged2 = CatalogDiff.Apply(noted, diff2);
        Check("a curated description is never overwritten by an update",
              merged2.Endpoints.First(e => e.Key == "GET /api/parts/inventory")
                     .Description.Contains("LOCAL NOTE"), "");

        Section("7. Idempotence");
        var again = CatalogDiff.Compare(merged, incoming);
        Check("re-comparing after a merge proposes no further additions", again.AddedCount == 0, again.Summary);
        Check("re-comparing proposes no further changes", again.ChangedCount == 0, again.Summary);

        Section("8. URL building");
        Check("no query means no question mark",
              ApiRunner.BuildUrl("http://h:2456/", "/api/parts", []) == "http://h:2456/api/parts", "");
        Check("values are escaped",
              ApiRunner.BuildUrl("http://h:2456", "/api/parts", [new("num", "A B&C")])
                  == "http://h:2456/api/parts?num=A%20B%26C", "");
        Check("a second parameter uses &",
              ApiRunner.BuildUrl("http://h:2456", "/api/p", [new("a", "1"), new("b", "2")])
                  == "http://h:2456/api/p?a=1&b=2", "");

        Section("9. Response shaping");
        var (cols, rows) = ApiRunner.Tabulate("""{"totalCount":2,"results":[{"id":1,"num":"A"},{"id":2,"num":"B"}]}""");
        Check("the paged envelope is unwrapped", rows.Count == 2, rows.Count + " rows");
        Check("columns come from the rows", cols.SequenceEqual(["id", "num"]), string.Join(",", cols));
        var (_, bare) = ApiRunner.Tabulate("""[{"id":7}]""");
        Check("a bare array works too", bare.Count == 1, "");
        var (_, one) = ApiRunner.Tabulate("""{"id":7,"num":"X"}""");
        Check("a single object becomes one row", one.Count == 1, "");
        Check("non-JSON yields nothing rather than throwing",
              ApiRunner.Tabulate("not json").Rows.Count == 0, "");

        Section("9b. Import payloads");
        Check("the catalog carries the import names", shipped.ImportNames.Count > 0,
              shipped.ImportNames.Count + " names");
        Check("directions are classified",
              shipped.ImportNames.Any(n => n.CanImport && !n.CanExport) &&
              shipped.ImportNames.Any(n => n.CanExport && !n.CanImport) &&
              shipped.ImportNames.Any(n => n.CanImport && n.CanExport),
              shipped.ImportNames.Count(n => n.CanImport) + " import, " +
              shipped.ImportNames.Count(n => n.CanExport) + " export");

        // Add-Inventory takes its header template from a DIFFERENTLY named
        // export; without the alias the pre-fill silently 404s.
        Check("the header alias is applied",
              shipped.HeaderNameFor("Add-Inventory") == "Inventory-Quantities",
              shipped.HeaderNameFor("Add-Inventory"));
        Check("a name with no alias is used as it stands",
              shipped.HeaderNameFor("Customers") == "Customers", "");

        var row = ImportPayload.ParseRow(@"""a"",""b,c"",""d""""e""");
        Check("a quoted comma stays inside its field", row.Count == 3, string.Join(" | ", row));
        Check("a doubled quote unescapes", row[2] == @"d""e", row[2]);

        var csv = "\"Num\",\"Description\"\n\"A-1\",\"Widget, large\"";
        var asJson = ImportPayload.CsvToJson(csv);
        Check("CSV becomes a 2-D array, not an array of objects",
              JsonNode.Parse(asJson) is JsonArray { Count: 2 } outer && outer[0] is JsonArray, Trim(asJson));
        Check("the header row leads", JsonNode.Parse(asJson)![0]![0]!.GetValue<string>() == "Num", "");
        Check("a comma inside a value survives the trip",
              JsonNode.Parse(asJson)![1]![1]!.GetValue<string>() == "Widget, large", "");
        Check("and it converts back unchanged",
              ImportPayload.JsonToCsv(asJson).Replace("\r", "") == csv, Trim(ImportPayload.JsonToCsv(asJson)));

        // Not the documented shape, but people paste it often enough that
        // converting is friendlier than refusing.
        var fromObjects = ImportPayload.JsonToCsv("""[{"Num":"A-1","Desc":"x"}]""");
        Check("an array of objects is converted rather than refused",
              fromObjects.StartsWith("\"Num\",\"Desc\""), Trim(fromObjects));

        var tmplCsv = ImportPayload.Template(["Num", "Desc"], json: false);
        Check("a CSV template is the header row alone",
              tmplCsv.Trim() == "\"Num\",\"Desc\"", tmplCsv.Trim());
        var tmplJson = ImportPayload.Template(["Num", "Desc"], json: true);
        Check("a JSON template carries a blank data row to fill in",
              JsonNode.Parse(tmplJson) is JsonArray { Count: 2 } tj && tj[1]![0]!.GetValue<string>() == "",
              Trim(tmplJson));

        Check("headers are read off an export response",
              ImportPayload.HeadersFrom("\"Num\",\"Desc\"\r\n\"A\",\"B\"").SequenceEqual(["Num", "Desc"]), "");
        Check("JSON is told apart from CSV by content, not by extension",
              ImportPayload.LooksJson("  [[\"a\"]]") && !ImportPayload.LooksJson("\"a\",\"b\""), "");


        Section("9c. SQL editor");
        // The editor is chosen from the DOCUMENTATION, not from a hard-coded
        // path, so a catalog updated from a newer server still gets it.
        var dq = shipped.Endpoints.FirstOrDefault(e => e.Path.EndsWith("/data-query"));
        Check("data-query is in the catalog", dq is not null, dq?.Key ?? "");
        Check("its SQL parameter is recognised",
              dq is not null && dq.QueryParams.Any(SqlFormat.IsSqlParam),
              string.Join(", ", dq?.QueryParams.Select(q => q.Name) ?? []));
        Check("an ordinary parameter is not mistaken for SQL",
              !SqlFormat.IsSqlParam(new ApiParam { Name = "query", Description = "Search text." }) &&
              !SqlFormat.IsSqlParam(new ApiParam { Name = "pageSize", Description = "SQL to be run." }), "");

        var pretty = SqlFormat.Pretty("select a,b from part p left join uom u on u.id=p.uomId where p.activeFlag=1 and a>0 order by a");
        var plines = pretty.Split('\n');
        Check("each clause starts a line", plines.Length >= 5, plines.Length + " lines");
        Check("SELECT leads", plines[0].StartsWith("select", StringComparison.OrdinalIgnoreCase), plines[0]);
        Check("LEFT JOIN is kept whole, not split at JOIN",
              pretty.Contains("\nleft join", StringComparison.OrdinalIgnoreCase) &&
              !pretty.Contains("left \njoin", StringComparison.OrdinalIgnoreCase), Trim(pretty));
        Check("ON gets its own line", plines.Any(l => l.TrimStart().StartsWith("on", StringComparison.OrdinalIgnoreCase)), "");
        Check("AND is indented under its condition",
              plines.Any(l => l.StartsWith("  and", StringComparison.OrdinalIgnoreCase)), Trim(pretty));

        Check("UNION ALL is kept whole",
              SqlFormat.Pretty("select 1 union all select 2").Contains("union all", StringComparison.OrdinalIgnoreCase), "");
        Check("formatting twice changes nothing more",
              SqlFormat.Pretty(pretty) == pretty, "");
        Check("an empty query survives", SqlFormat.Pretty("   ") == "", "");

        // Comment and literal handling is the part worth being careful about:
        // squeezing a string literal would change what the query matches.
        Check("a line comment is dropped",
              SqlFormat.StripComments("SELECT 1 -- a note\nFROM part") == "SELECT 1 FROM part",
              SqlFormat.StripComments("SELECT 1 -- a note\nFROM part"));
        Check("a comment marker inside a literal is left alone",
              SqlFormat.StripComments("SELECT '-- not a comment' FROM t") == "SELECT '-- not a comment' FROM t",
              SqlFormat.StripComments("SELECT '-- not a comment' FROM t"));
        Check("spacing inside a literal is preserved",
              SqlFormat.StripComments("SELECT 'a   b'  FROM t") == "SELECT 'a   b' FROM t",
              SqlFormat.StripComments("SELECT 'a   b'  FROM t"));
        Check("a doubled quote inside a literal survives",
              SqlFormat.StripComments("SELECT 'it''s' FROM t") == "SELECT 'it''s' FROM t",
              SqlFormat.StripComments("SELECT 'it''s' FROM t"));


        Section("9d. SQL syntax colouring");
        var toks = SqlHighlighter.Tokenize("SELECT id -- a note\nFROM part WHERE num = 'A-1' AND qty > 12.5");
        string Kinds(SqlTokenKind k) => string.Join("|", toks.Where(t => t.Kind == k).Select(t => t.Text.Trim()));

        // Nothing may be dropped: the runs are concatenated back into the
        // editor, so a lost character would silently corrupt the query.
        Check("every character survives tokenising",
              string.Concat(toks.Select(t => t.Text)) == "SELECT id -- a note\nFROM part WHERE num = 'A-1' AND qty > 12.5",
              toks.Count + " tokens");
        Check("keywords are found", Kinds(SqlTokenKind.Keyword).Contains("SELECT") &&
                                    Kinds(SqlTokenKind.Keyword).Contains("FROM") &&
                                    Kinds(SqlTokenKind.Keyword).Contains("WHERE"), Kinds(SqlTokenKind.Keyword));
        Check("a table name is not a keyword",
              toks.Any(t => t.Text == "part" && t.Kind == SqlTokenKind.Plain), "");
        Check("the literal is one token", Kinds(SqlTokenKind.String) == "'A-1'", Kinds(SqlTokenKind.String));
        Check("the number is one token", Kinds(SqlTokenKind.Number) == "12.5", Kinds(SqlTokenKind.Number));
        Check("the comment stops at the newline",
              Kinds(SqlTokenKind.Comment) == "-- a note", Kinds(SqlTokenKind.Comment));

        // An editor holds unfinished statements most of the time, so the lexer
        // has to cope with them rather than throw or hang.
        var loose = SqlHighlighter.Tokenize("SELECT 'unterminated");
        Check("an unterminated literal does not hang",
              string.Concat(loose.Select(t => t.Text)) == "SELECT 'unterminated", loose.Count + " tokens");
        var blockC = SqlHighlighter.Tokenize("/* still typing");
        Check("an unterminated block comment does not hang",
              blockC.Count == 1 && blockC[0].Kind == SqlTokenKind.Comment, blockC.Count + " tokens");
        Check("empty input gives no tokens", SqlHighlighter.Tokenize("").Count == 0, "");

        Check("keyword matching ignores case",
              SqlHighlighter.Tokenize("select").Single().Kind == SqlTokenKind.Keyword, "");
        Check("a doubled quote does not end the literal",
              SqlHighlighter.Tokenize("'it''s'").Single(t => t.Kind == SqlTokenKind.String).Text == "'it''s'", "");


        Section("9e. SQL keyword casing and spacing");
        var cased = SqlFormat.Pretty("select id from part where num = 'lower case string' and qty > 0");
        Check("reserved words are uppercased",
              cased.Contains("SELECT") && cased.Contains("FROM") && cased.Contains("WHERE"), Trim(cased));
        Check("identifiers keep their case",
              cased.Contains("id") && cased.Contains("part") && cased.Contains("num"), Trim(cased));

        // The whole reason this runs on tokens rather than a regex: a literal
        // is data, and uppercasing inside it changes what the query matches.
        Check("a keyword inside a string literal is untouched",
              SqlFormat.Pretty("SELECT * FROM t WHERE a = 'select from where'")
                       .Contains("'select from where'"),
              Trim(SqlFormat.Pretty("SELECT * FROM t WHERE a = 'select from where'")));
        Check("a keyword inside a comment is untouched",
              SqlFormat.Pretty("SELECT 1 -- select from where\nFROM t").Contains("-- select from where"),
              Trim(SqlFormat.Pretty("SELECT 1 -- select from where\nFROM t")));
        Check("a comment keeps its own line, so it swallows nothing",
              SqlFormat.Pretty("SELECT 1 -- note\nFROM t").Split('\n')
                       .Any(l => l.Trim() == "-- note"),
              Trim(SqlFormat.Pretty("SELECT 1 -- note\nFROM t")));

        var spaced = SqlFormat.Pretty("select a , b ,count( * ) from t . u where ( a = 1 )");
        Check("no space before a comma", !spaced.Contains(" ,"), Trim(spaced));
        Check("no space after an opening bracket", !spaced.Contains("( "), Trim(spaced));
        Check("no space before a closing bracket", !spaced.Contains(" )"), Trim(spaced));
        Check("a qualified name keeps no spaces around its dot",
              spaced.Contains("t.u"), Trim(spaced));

        Check("LEFT OUTER JOIN is kept on one line",
              SqlFormat.Pretty("select 1 from a left outer join b on a.id=b.id")
                       .Split('\n').Any(l => l.Trim().StartsWith("LEFT OUTER JOIN")),
              Trim(SqlFormat.Pretty("select 1 from a left outer join b on a.id=b.id")));
        Check("formatting is stable on a second pass",
              SqlFormat.Pretty(cased) == cased, Trim(SqlFormat.Pretty(cased)));

        Section("9f. Value tones");
        Check("a completed status reads positive",
              Tone.Classify("Fulfilled") == ValueTone.Positive &&
              Tone.Classify("Shipped") == ValueTone.Positive, "");
        Check("an in-flight status reads active",
              Tone.Classify("Issued") == ValueTone.Active &&
              Tone.Classify("In Progress") == ValueTone.Active, "");
        Check("a status wanting a human reads warning",
              Tone.Classify("Pending Approval") == ValueTone.Warning &&
              Tone.Classify("Closed Short") == ValueTone.Warning, "");
        Check("an undone status reads negative",
              Tone.Classify("Voided") == ValueTone.Negative &&
              Tone.Classify("Cancelled") == ValueTone.Negative, "");
        Check("a not-started status reads quiet", Tone.Classify("Entered") == ValueTone.Quiet, "");
        Check("booleans are classified", Tone.Classify("true") == ValueTone.Positive &&
                                         Tone.Classify("false") == ValueTone.Negative, "");
        Check("matching ignores case", Tone.Classify("fulfilled") == ValueTone.Positive, "");
        Check("null and blank read as empty",
              Tone.Classify(null) == ValueTone.Empty && Tone.Classify("") == ValueTone.Empty &&
              Tone.Classify("null") == ValueTone.Empty, "");

        // A chip on an unrecognised value would be a lie; substring matching is
        // exactly how that happens, so it is not done.
        Check("an unknown value gets no chip",
              !Tone.IsChip("WIDGET-A") && !Tone.IsChip("Shipped goods to Acme") && !Tone.IsChip("10042"),
              "");
        Check("a recognised value does", Tone.IsChip("Fulfilled") && Tone.IsChip("Voided"), "");

        Section("9g. JSON colouring");
        var jt = JsonHighlighter.Tokenize("""{"num": "SO-1", "status": "Fulfilled", "qty": -12.5, "ok": true, "note": null}""");
        Check("every character survives tokenising",
              string.Concat(jt.Select(t => t.Text)) ==
              """{"num": "SO-1", "status": "Fulfilled", "qty": -12.5, "ok": true, "note": null}""",
              jt.Count + " tokens");
        Check("a name before a colon is a key",
              jt.Count(t => t.Kind == JsonTokenKind.Key) == 5,
              string.Join(" ", jt.Where(t => t.Kind == JsonTokenKind.Key).Select(t => t.Text)));
        Check("an ordinary string value is text",
              jt.Any(t => t.Kind == JsonTokenKind.Text && t.Text == "\"SO-1\""), "");
        Check("a negative decimal is one number token",
              jt.Any(t => t.Kind == JsonTokenKind.Number && t.Text == "-12.5"), "");
        Check("true and null are their own kinds",
              jt.Any(t => t.Kind == JsonTokenKind.True && t.Text == "true") &&
              jt.Any(t => t.Kind == JsonTokenKind.Null), "");

        // The point of the exercise: a status inside JSON is coloured the same
        // way it is in the table.
        Check("a status string is coloured by meaning, not as plain text",
              jt.Any(t => t.Kind == JsonTokenKind.True && t.Text == "\"Fulfilled\""),
              string.Join(" ", jt.Where(t => t.Kind == JsonTokenKind.True).Select(t => t.Text)));
        Check("a voided status reads negative",
              JsonHighlighter.Tokenize("""{"s":"Voided"}""")
                             .Any(t => t.Kind == JsonTokenKind.False && t.Text == "\"Voided\""), "");

        var escaped = JsonHighlighter.Tokenize(RawWithEscapes);
        Check("an escaped quote does not end the string",
              escaped.Count(t => t.Kind == JsonTokenKind.Text) == 1 &&
              escaped.Single(t => t.Kind == JsonTokenKind.Text).Text.EndsWith("\""),
              string.Join(" | ", escaped.Select(t => t.Kind + ":" + t.Text)));
        Check("truncated JSON still tokenises",
              JsonHighlighter.Tokenize("""{"a": "unterminated""").Count > 0, "");
        Check("\"nullable\" is not the null literal",
              JsonHighlighter.Tokenize("""{"a":"nullable"}""").All(t => t.Kind != JsonTokenKind.Null), "");


        Section("9h. Table sorting");
        // The whole point: a string sort gives 10, 15, 2, 20 on an id column.
        var ids = new[] { "10", "15", "2", "20", "3" };
        var byNumber = ids.OrderBy(x => x, Comparer<string>.Create(RowComparer.CompareValues)).ToArray();
        Check("numbers sort as numbers", byNumber.SequenceEqual(["2", "3", "10", "15", "20"]),
              string.Join(", ", byNumber));

        var text = new[] { "Widget", "apple", "Zebra" };
        var byText = text.OrderBy(x => x, Comparer<string>.Create(RowComparer.CompareValues)).ToArray();
        Check("text still sorts as text, ignoring case",
              byText.SequenceEqual(["apple", "Widget", "Zebra"]), string.Join(", ", byText));

        var dates = new[] { "2026-03-01T00:00:00", "2025-12-31T23:00:00", "2026-01-15T08:30:00" };
        var byDate = dates.OrderBy(x => x, Comparer<string>.Create(RowComparer.CompareValues)).ToArray();
        Check("dates sort chronologically", byDate[0].StartsWith("2025-12-31"), string.Join(", ", byDate));

        Check("negatives and decimals order correctly",
              RowComparer.CompareValues("-5", "2") < 0 && RowComparer.CompareValues("2.5", "10") < 0, "");
        Check("money and percentages are read as numbers",
              RowComparer.CompareValues("$1,200.00", "$300.00") > 0 &&
              RowComparer.CompareValues("9%", "80%") < 0, "");

        // Deciding per pair, not per column: a quantity column with "N/A" in it
        // must not sort the rest of the column as text.
        Check("a mixed pair falls back to text for that pair alone",
              RowComparer.CompareValues("N/A", "5") != 0 &&
              RowComparer.CompareValues("2", "10") < 0, "");

        Check("blanks and nulls gather at one end",
              RowComparer.CompareValues("", "5") < 0 && RowComparer.CompareValues("null", "5") < 0 &&
              RowComparer.CompareValues("", "null") == 0, "");

        // A bare year is an id far more often than it is a date. Letting
        // DateTime.TryParse have it would sort an id column by imaginary years.
        Check("a bare integer is a number, not a year",
              !RowComparer.TryDate("2024", out _) && RowComparer.TryNumber("2024", out _), "");
        Check("a non-numeric string is not a number",
              !RowComparer.TryNumber("WIDGET-1", out _) && !RowComparer.TryNumber("-", out _), "");

        var comparer = new RowComparer("qty", descending: false);
        var rowA = new Dictionary<string, string> { ["qty"] = "9" };
        var rowB = new Dictionary<string, string> { ["qty"] = "80" };
        Check("the row comparer reads the named column", comparer.Compare(rowA, rowB) < 0, "");
        Check("descending inverts it", new RowComparer("qty", true).Compare(rowA, rowB) > 0, "");
        Check("a missing column does not throw",
              comparer.Compare(new Dictionary<string, string>(), rowB) != 0, "");

        Section("9i. Keyword completion");
        // Completion offers the same words the highlighter colours, so nothing
        // can be suggested that then fails to light up.
        Check("the keyword list is shared with the highlighter",
              SqlHighlighter.Keywords.Contains("SELECT") && SqlHighlighter.Keywords.Contains("INNER"),
              SqlHighlighter.Keywords.Count + " keywords");
        var se = SqlHighlighter.Keywords.Where(k => k.StartsWith("SE", StringComparison.OrdinalIgnoreCase)).ToList();
        Check("a two-letter prefix narrows to a usable list", se.Count is > 0 and < 8, string.Join(", ", se));
        Check("prefix matching ignores case",
              SqlHighlighter.Keywords.Any(k => k.StartsWith("se", StringComparison.OrdinalIgnoreCase)), "");


        Section("9j. Kept query results");
        // Work against the real store, then put it back as it was.
        var beforeRuns = QueryHistory.List().Count;

        var fakeBody = """[{"id":1,"num":"A"},{"id":2,"num":"B"}]""";
        var fakeResult = new ApiResult("GET", "http://x/api/data-query", 200, "OK",
                                       fakeBody, true, 12, fakeBody.Length, [], [], null);

        var run = QueryHistory.Save("http://x", "SELECT id, num FROM part", fakeResult, 2, "selftest-A");
        Check("a result is kept", run is not null, run?.Id ?? "");
        Check("it appears in the list", QueryHistory.List().Any(r => r.Id == run!.Id), "");
        Check("the body comes back byte for byte", QueryHistory.Body(run!.Id) == fakeBody, "");
        Check("the metadata is kept",
              QueryHistory.List().First(r => r.Id == run.Id) is { RowCount: 2, Status: 200 }, "");
        Check("a label is used as the summary",
              QueryHistory.List().First(r => r.Id == run.Id).Summary == "selftest-A", "");

        QueryHistory.Rename(run.Id, null);
        Check("without a label the SQL is the summary",
              QueryHistory.List().First(r => r.Id == run.Id).Summary.StartsWith("SELECT id, num"), "");

        Check("a missing body is not listed as available",
              QueryHistory.Body("no-such-run-id") is null, "");

        QueryHistory.Delete(run.Id);
        Check("delete removes it", !QueryHistory.List().Any(r => r.Id == run.Id), "");
        Check("the store is back as it was", QueryHistory.List().Count == beforeRuns, "");

        Section("9k. Comparing two results");
        var colsOld = new List<string> { "id", "num", "status" };
        var rowsOld = new List<Dictionary<string, string>>
        {
            new() { ["id"] = "1", ["num"] = "A", ["status"] = "Entered" },
            new() { ["id"] = "2", ["num"] = "B", ["status"] = "Issued" },
            new() { ["id"] = "3", ["num"] = "C", ["status"] = "Issued" },
        };
        var rowsNew = new List<Dictionary<string, string>>
        {
            new() { ["id"] = "1", ["num"] = "A", ["status"] = "Entered" },   // unchanged
            new() { ["id"] = "2", ["num"] = "B", ["status"] = "Fulfilled" }, // changed
            new() { ["id"] = "4", ["num"] = "D", ["status"] = "Entered" },   // added; 3 removed
        };

        var d = QueryDiff.Compare(colsOld, rowsOld, colsOld, rowsNew);
        Check("it matches on a unique column", d.Summary.Contains("matched on \"id\""), Trim(d.Summary));
        Check("unchanged rows are not reported", d.Rows.Count == 3, d.Rows.Count + " rows");
        Check("one added, one removed, one changed",
              d.Summary.Contains("1 added") && d.Summary.Contains("1 removed") && d.Summary.Contains("1 changed"),
              Trim(d.Summary));
        Check("the marker column leads", d.Columns[0] == QueryDiffResult.MarkerColumn, string.Join(",", d.Columns));

        var changedRow = d.Rows.First(r => r[QueryDiffResult.MarkerColumn] == "~");
        Check("a changed field shows old and new", changedRow["status"].Contains("Entered") == false &&
              changedRow["status"].Contains("Issued") && changedRow["status"].Contains("Fulfilled"),
              changedRow["status"]);
        Check("fields that did not move are left alone", changedRow["num"] == "B", changedRow["num"]);

        Check("identical results say so",
              !QueryDiff.Compare(colsOld, rowsOld, colsOld, rowsOld).Any, "");
        Check("and say it in words",
              QueryDiff.Compare(colsOld, rowsOld, colsOld, rowsOld).Summary.Contains("identical"), "");

        // A repeated "id" — a join will do that — is not a key. Using it anyway
        // would pair unrelated rows and report nonsense.
        var dupCols = new List<string> { "id", "line" };
        // BOTH columns have to repeat, or the other one is a perfectly good key.
        var dupA = new List<Dictionary<string, string>>
        {
            new() { ["id"] = "1", ["line"] = "x" },
            new() { ["id"] = "1", ["line"] = "x" },
        };
        var dupB = new List<Dictionary<string, string>>
        {
            new() { ["id"] = "1", ["line"] = "x" },
            new() { ["id"] = "1", ["line"] = "z" },
        };
        var dd = QueryDiff.Compare(dupCols, dupA, dupCols, dupB);
        Check("a repeated column is rejected as a key",
              dd.Summary.Contains("no unique key column"), Trim(dd.Summary));
        Check("without a key it compares whole rows",
              dd.Summary.Contains("1 added") && dd.Summary.Contains("1 removed") &&
              dd.Summary.Contains("0 changed"), Trim(dd.Summary));

        Check("comparing against an empty result reports every row as added",
              QueryDiff.Compare(colsOld, [], colsOld, rowsNew).Summary.Contains("3 added"),
              Trim(QueryDiff.Compare(colsOld, [], colsOld, rowsNew).Summary));


        Section("9l. CSV export");
        var csvCols = new List<string> { "num", "description", "qty" };
        var csvRows = new List<Dictionary<string, string>>
        {
            new() { ["num"] = "00123", ["description"] = "Widget, large", ["qty"] = "5" },
            new() { ["num"] = "A-2", ["description"] = "He said \"hi\"", ["qty"] = "" },
        };

        var csvOut = ResultExport.ToCsv(csvCols, csvRows);
        var csvLines = csvOut.Split("\r\n", StringSplitOptions.RemoveEmptyEntries);
        Check("a header row leads", csvLines[0] == "\"num\",\"description\",\"qty\"", csvLines[0]);
        Check("one line per row", csvLines.Length == 3, csvLines.Length + " lines");
        Check("a comma inside a value stays inside its quotes",
              csvLines[1].Contains("\"Widget, large\""), csvLines[1]);
        Check("an embedded quote is doubled",
              csvLines[2].Contains("\"He said \"\"hi\"\"\""), csvLines[2]);
        Check("an empty cell is an empty quoted field", csvLines[2].EndsWith(",\"\""), csvLines[2]);

        // Quoting everything is the point: unquoted, a spreadsheet reads 00123
        // as the number 123 and the part number is gone.
        Check("a leading zero is preserved", csvLines[1].Contains("\"00123\""), csvLines[1]);

        // It has to survive the trip back, or it was never really CSV.
        var reparsed = ImportPayload.ParseRow(csvLines[2]);
        Check("it parses back to the same fields",
              reparsed.Count == 3 && reparsed[1] == "He said \"hi\"" && reparsed[2] == "",
              string.Join(" | ", reparsed));

        Check("a missing column becomes an empty field",
              ResultExport.ToCsv(["num", "absent"], csvRows).Split("\r\n")[1].EndsWith(",\"\""),
              ResultExport.ToCsv(["num", "absent"], csvRows).Split("\r\n")[1]);
        Check("no rows still yields a header", ResultExport.ToCsv(csvCols, []).Trim() ==
              "\"num\",\"description\",\"qty\"", "");

        var name = ResultExport.SuggestName("Execute data query", "csv");
        Check("the suggested name is usable",
              name.EndsWith(".csv") && !name.Any(c => Path.GetInvalidFileNameChars().Contains(c)), name);
        Check("an awkward endpoint name is made safe",
              !ResultExport.SuggestName("GET /api/parts?x=1", "json")
                           .Any(c => Path.GetInvalidFileNameChars().Contains(c)),
              ResultExport.SuggestName("GET /api/parts?x=1", "json"));


        Section("9m. Variables");
        // Typing the reference form into the Name column is the obvious
        // mistake: stored literally it can never match, and the only symptom
        // is a request that refuses to send.
        Check("a name typed with braces is stored without them",
              new Variable { Name = "{{soId}}" }.Name == "soId",
              new Variable { Name = "{{soId}}" }.Name);
        Check("and it then resolves in a field",
              Variables.Expand("/api/sales-orders/{{soId}}",
                               new[] { new Variable { Name = "{{soId}}", Value = "35" } })
                  == "/api/sales-orders/35",
              Variables.Expand("/api/sales-orders/{{soId}}",
                               new[] { new Variable { Name = "{{soId}}", Value = "35" } }));
        Check("whitespace inside the braces is fine too",
              new Variable { Name = "{{ soId }}" }.Name == "soId",
              new Variable { Name = "{{ soId }}" }.Name);
        var vals = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            ["partId"] = "42",
            ["num"] = "A B",
        };

        Check("a placeholder is replaced",
              Variables.Expand("/api/parts/{{partId}}", vals) == "/api/parts/42", "");
        Check("spacing inside the braces is tolerated",
              Variables.Expand("{{ partId }}", vals) == "42", "");
        Check("matching ignores case", Variables.Expand("{{PARTID}}", vals) == "42", "");
        Check("several in one string", Variables.Expand("{{num}}/{{partId}}", vals) == "A B/42", "");

        // The important one. Substituting an empty string would build a URL that
        // looks valid and quietly asks for the wrong record; leaving the
        // placeholder makes the send check catch it by name.
        Check("an unknown name is left exactly as it is",
              Variables.Expand("/api/parts/{{missing}}", vals) == "/api/parts/{{missing}}", "");
        Check("and is reported as unresolved",
              Variables.Unresolved("{{missing}}/{{partId}}", vals).SequenceEqual(["missing"]),
              string.Join(",", Variables.Unresolved("{{missing}}/{{partId}}", vals)));
        Check("references are listed without duplicates",
              Variables.Referenced("{{a}} {{b}} {{a}}").SequenceEqual(["a", "b"]), "");
        Check("text with no placeholders is untouched",
              Variables.Expand("/api/parts", vals) == "/api/parts", "");

        Section("9m2. Completing a {{name}} as you type");

        // Where the caret is, and therefore what to offer.
        Check("inside a fresh pair the prefix is empty",
              VarCompletion.TokenAt("/api/sales-orders/{{", 20) is { Prefix: "" }, "");
        Check("a part-typed name is the prefix",
              VarCompletion.TokenAt("/api/sales-orders/{{so", 22) is { Prefix: "so" }, "");
        Check("and it knows where the braces started",
              VarCompletion.TokenAt("/api/sales-orders/{{so", 22)?.Start == 18, "");
        Check("outside any braces there is nothing to complete",
              VarCompletion.TokenAt("/api/sales-orders/35", 20) is null, "");
        Check("a closed placeholder to the left is not still open",
              VarCompletion.TokenAt("{{a}}/x", 7) is null, "");
        Check("the caret between the braces of a closed pair still counts",
              VarCompletion.TokenAt("{{so}}", 4) is { Prefix: "so" }, "");

        // Accepting one.
        var (filled, caret) = VarCompletion.Insert("/api/sales-orders/{{so}}", 22, "soId");
        Check("accepting rewrites the whole placeholder", filled == "/api/sales-orders/{{soId}}", filled);
        Check("and leaves the caret past the closing braces", caret == filled.Length, caret + " of " + filled.Length);

        var (reopened, _) = VarCompletion.Insert("/api/x/{{}}?q=1", 9, "id");
        Check("an empty pair is filled without doubling the braces",
              reopened == "/api/x/{{id}}?q=1", reopened);

        var (unclosed, _) = VarCompletion.Insert("/api/x/{{so", 11, "soId");
        Check("an unclosed one gets its closing braces", unclosed == "/api/x/{{soId}}", unclosed);

        // What is offered.
        var pool = new[]
        {
            new Variable { Name = "soId", Value = "35" },
            new Variable { Name = "soNum", Value = "SO-10042" },
            new Variable { Name = "partId", Value = "1" },
            new Variable { Name = "", Value = "ignored" },
        };
        Check("an empty prefix offers them all", VarCompletion.Matches("", pool).Count == 3,
              VarCompletion.Matches("", pool).Count + "");
        Check("a prefix narrows it", VarCompletion.Matches("so", pool).Count == 2, "");
        Check("matching ignores case", VarCompletion.Matches("SO", pool).Count == 2, "");
        Check("each carries its value", VarCompletion.Matches("soI", pool)[0].Preview == "35", "");
        Check("and the text inserted is the reference form",
              VarCompletion.Matches("soI", pool)[0].Text == "{{soId}}", VarCompletion.Matches("soI", pool)[0].Text);
        Check("a name typed out in full is not offered back",
              VarCompletion.Matches("partId", pool).Count == 0, "");
        Check("a prefix matching nothing offers nothing",
              VarCompletion.Matches("zz", pool).Count == 0, "");

        Section("9m3. Editing the URL by hand");

        // The inverse of BuildUrl, for a URL somebody typed over.
        var split = ApiRunner.SplitUrl("http://box:2456/api/parts?num=A%20B&x=1", "http://fallback:2456");
        Check("the host is taken from what was typed", split.BaseUrl == "http://box:2456", split.BaseUrl);
        Check("so is the path", split.Path == "/api/parts", split.Path);
        Check("query values are unescaped exactly once",
              split.Query.Count == 2 && split.Query[0].Value == "A B", split.Query[0].Value);

        var rel = ApiRunner.SplitUrl("/api/parts?num=A-1", "http://localhost:2456");
        Check("a bare path falls back to the connected server",
              rel.BaseUrl == "http://localhost:2456", rel.BaseUrl);
        Check("and still splits its query", rel.Query.Count == 1 && rel.Query[0].Key == "num", "");

        var hostOnly = ApiRunner.SplitUrl("http://localhost:2456", "http://x");
        Check("a host with no path becomes /", hostOnly.Path == "/", hostOnly.Path);

        Check("a flag with no value survives",
              ApiRunner.SplitUrl("/api/x?debug", "http://y").Query is [{ Key: "debug", Value: "" }], "");

        // Round trip: what is split must rebuild to the same thing.
        var original = "http://localhost:2456/api/parts?num=A-1&limit=5";
        var roundTrip = ApiRunner.SplitUrl(original, "http://other");
        Check("split then rebuilt is unchanged",
              ApiRunner.BuildUrl(roundTrip.BaseUrl, roundTrip.Path, roundTrip.Query) == original,
              ApiRunner.BuildUrl(roundTrip.BaseUrl, roundTrip.Path, roundTrip.Query));

        Section("9n. Capturing from a response");
        const string created = """{"id":1007,"num":"SO-1007","customer":{"id":88,"name":"Acme"}}""";
        Check("a top-level field", Variables.Capture(created, "id") == "1007", "");
        Check("a nested field", Variables.Capture(created, "customer.id") == "88", "");
        Check("a string keeps its text, without the quotes",
              Variables.Capture(created, "num") == "SO-1007", "");
        Check("a path that is not there gives nothing",
              Variables.Capture(created, "nope.deeper") is null, "");

        const string paged = """{"totalCount":2,"results":[{"id":5,"num":"P-1"},{"id":6,"num":"P-2"}]}""";
        Check("an explicit index works", Variables.Capture(paged, "results[1].num") == "P-2", "");
        // Every search endpoint wraps its rows in this envelope; writing
        // results[0]. in front of every capture would be noise.
        Check("the paged envelope is stepped into automatically",
              Variables.Capture(paged, "id") == "5", "");
        Check("a bare array likewise",
              Variables.Capture("""[{"id":9}]""", "id") == "9", "");
        Check("malformed JSON captures nothing rather than throwing",
              Variables.Capture("{not json", "id") is null, "");

        var paths = Variables.Paths(paged);
        Check("paths are offered through the envelope",
              paths.Contains("id") && paths.Contains("num"), string.Join(", ", paths));
        var nestedPaths = Variables.Paths(created);
        Check("nested paths are dotted",
              nestedPaths.Contains("customer.name"), string.Join(", ", nestedPaths));

        Section("9o. cURL");
        var curl = CurlFormat.ToCurl("POST", "http://h:2456/api/sales-orders",
                                     [new("X-Trace", "abc")], """{"a":1}""", "application/json", true);
        Check("the verb and URL are there",
              curl.Contains("--request POST") && curl.Contains("/api/sales-orders"), Trim(curl));
        Check("the body is there", curl.Contains("""--data-raw '{"a":1}'"""), Trim(curl));
        Check("a custom header survives", curl.Contains("X-Trace: abc"), Trim(curl));

        // A cURL command exists to be pasted into a ticket. A live session token
        // pasted there is a credential leak, so it is never included.
        Check("the token is never in the output",
              curl.Contains(CurlFormat.TokenPlaceholder) && !curl.Contains("Bearer abc"), Trim(curl));

        var parsed = CurlFormat.Parse(curl);
        Check("its own output parses back", parsed is not null, "");
        Check("round-trips the verb", parsed!.Method == "POST", parsed.Method);
        Check("round-trips the URL", parsed.Url == "http://h:2456/api/sales-orders", parsed.Url);
        Check("round-trips the body", parsed.Body == """{"a":1}""", parsed.Body ?? "");

        // What Fishbowl's own docs emit, line continuations and all.
        var sample = CurlFormat.Parse("""
            curl --location \
            --request GET 'http://localhost:2456/api/parts?num=A-1' \
            --header 'Accept: application/json'
            """);
        Check("a multi-line sample parses", sample is not null, "");
        Check("the query string is kept", sample!.Url.Contains("num=A-1"), sample.Url);
        Check("a body-less command is a GET", sample.Method == "GET", sample.Method);
        Check("a body with no -X is a POST",
              CurlFormat.Parse("""curl 'http://h/x' --data-raw 'y'""")!.Method == "POST", "");
        Check("something that is not cURL is refused", CurlFormat.Parse("GET /api/parts") is null, "");
        Check("an unknown flag does not cost the URL",
              CurlFormat.Parse("""curl --compressed --retry 3 'http://h/x'""")?.Url == "http://h/x", "");

        var bi = CurlFormat.ToRunRestApiAsync("POST", "/api/sales-orders",
                                              [new("page", "1")], """{"a":1}""", "application/json");
        Check("the BI call has the right shape",
              bi.Contains("runRestApiAsync({") && bi.Contains("method: 'POST'") &&
              bi.Contains("path: '/api/sales-orders'"), Trim(bi));
        Check("query parameters come across as pairs",
              bi.Contains("['page', '1']"), Trim(bi));
        // A report runs inside the client and uses its session, so there is no
        // token and no server address — the part people get wrong by hand.
        Check("no token and no host reach the snippet",
              !bi.Contains("Bearer") && !bi.Contains("http"), Trim(bi));

        Section("9p. Server profiles");
        Check("localhost is not production", !Profiles.LooksLikeProduction("http://localhost:2456"), "");
        Check("a loopback address is not either", !Profiles.LooksLikeProduction("http://127.0.0.1:2456"), "");
        Check("an obvious sandbox is not",
              !Profiles.LooksLikeProduction("https://fb-uat.example.com") &&
              !Profiles.LooksLikeProduction("https://demo.example.com"), "");
        Check("anything else is suggested as production",
              Profiles.LooksLikeProduction("https://fishbowl.acme.com"), "");
        Check("writes are the verbs that get confirmed",
              Profiles.IsWrite("POST") && Profiles.IsWrite("DELETE") && Profiles.IsWrite("PUT") &&
              !Profiles.IsWrite("GET"), "");

        Section("9q. Access rights");
        var held = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "Manufacture Order-View" };

        var mo = AccessRights.For(new ApiEndpoint { Description = "Retrieves an order. Requires MO_VIEW access right." }, held);
        Check("the documented right is found", mo is not null, mo?.Documented ?? "");
        Check("and mapped to what the server calls it", mo!.Right == "Manufacture Order-View", mo.Right ?? "");
        Check("a held right reads as held", mo.Held == true && !mo.Blocked, mo.Label);

        var po = AccessRights.For(new ApiEndpoint { Description = "Requires PO_VIEW." }, held);
        Check("a right the user lacks is flagged", po!.Held == false && po.Blocked, po.Label);

        // Nothing here infers a right from a path: a wrong prediction would send
        // someone to an administrator to fix a permission that was never wrong.
        Check("an endpoint documenting no right says nothing",
              AccessRights.For(new ApiEndpoint { Description = "Searches for parts." }, held) is null, "");
        // Two users the chip has nothing to offer, and so says nothing to.
        //
        // Full Rights means everything by definition. An EMPTY list is the
        // built-in administrator, who belongs to no user group at all, so the
        // login enumerates nothing — the absence of a rights record, not a user
        // without rights. Reading it as the latter put a cross on every
        // endpoint for the one account that can certainly call them all.
        var full = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "Full Rights" };
        Check("Full Rights produces no chip",
              AccessRights.For(new ApiEndpoint { Description = "Requires SO_VIEW." }, full) is null, "");
        Check("and neither does the built-in admin's empty list",
              AccessRights.For(new ApiEndpoint { Description = "Requires SO_VIEW." }, new HashSet<string>()) is null, "");
        Check("a restricted user still gets one",
              AccessRights.For(new ApiEndpoint { Description = "Requires MO_VIEW." }, held) is { Held: true }, "");

        // Not signed in is not a verdict.
        var nobody = AccessRights.For(new ApiEndpoint { Description = "Requires SO_VIEW." }, null);
        Check("with no session the chip does not claim anything",
              nobody!.Held is null && !nobody.Blocked && nobody.Label.Contains("sign in"), nobody.Label);

        var unknown = AccessRights.For(new ApiEndpoint { Description = "Requires WIDGET_FROB." }, held);
        Check("an unmapped right is reported but not judged",
              unknown is not null && unknown.Right is null && unknown.Held is null, unknown?.Label ?? "");

        Section("9r. SQL schema completion");
        var snap = new DbSchema.Snapshot { Server = "x" };
        snap.Tables["soitem"] = ["id", "soId", "qtyOrdered", "productNum"];
        snap.Tables["so"] = ["id", "num", "statusId"];
        snap.Tables["part"] = ["id", "num", "description"];

        static List<string> Words(List<SqlCompletion> items) => [.. items.Select(i => i.Text)];
        static string Show(List<SqlCompletion> items) =>
            string.Join(", ", items.Select(i => i.KindLabel + " " + i.Text +
                                                (i.Kind == SqlItemKind.Column ? " [" + i.Detail + "]" : "")));

        var aliases = DbSchema.Aliases("SELECT * FROM soitem si JOIN so ON so.id = si.soId");
        Check("an alias binds to its table", aliases["si"] == "soitem", "");
        Check("a table name qualifies itself", aliases["so"] == "so", "");
        // "FROM part WHERE" must not bind WHERE as an alias for part.
        Check("a keyword is not taken as an alias",
              !DbSchema.Aliases("SELECT * FROM part WHERE id = 1").ContainsKey("WHERE"),
              string.Join(",", DbSchema.Aliases("SELECT * FROM part WHERE id = 1").Keys));

        Section("9r2. Where the caret is");
        Check("an empty statement is the start", SqlContext.Place("") == SqlPlace.Start, "");
        Check("after SELECT comes a column list",
              SqlContext.Place("SELECT ") == SqlPlace.SelectList, "");
        Check("straight after FROM comes a table",
              SqlContext.Place("SELECT a FROM ") == SqlPlace.TableName &&
              SqlContext.Place("SELECT a FROM so") == SqlPlace.TableName, "");
        Check("past the table name it is no longer a table",
              SqlContext.Place("SELECT a FROM soitem ") == SqlPlace.Unknown, "");
        Check("after JOIN comes a table too",
              SqlContext.Place("SELECT a FROM x JOIN ") == SqlPlace.TableName, "");
        Check("WHERE and ON are conditions",
              SqlContext.Place("SELECT a FROM x WHERE ") == SqlPlace.Condition &&
              SqlContext.Place("SELECT a FROM x JOIN y ON ") == SqlPlace.Condition, "");
        Check("ORDER BY is a column list",
              SqlContext.Place("SELECT a FROM x ORDER BY ") == SqlPlace.ColumnList, "");
        Check("a semicolon starts over",
              SqlContext.Place("SELECT 1 FROM x; ") == SqlPlace.Start, "");
        Check("columns are preferred where they belong",
              SqlContext.PrefersColumns(SqlPlace.SelectList) &&
              SqlContext.PrefersColumns(SqlPlace.Condition) &&
              !SqlContext.PrefersColumns(SqlPlace.Start), "");

        Section("9r3. What gets offered");
        var qualified = DbSchema.Suggest(snap, "SELECT * FROM soitem si", "si", "q");
        Check("a qualifier offers that table's columns only",
              Words(qualified).SequenceEqual(["qtyOrdered"]), Show(qualified));
        Check("and each says which table it is on",
              qualified[0].Kind == SqlItemKind.Column && qualified[0].Detail == "soitem", Show(qualified));
        Check("an unknown qualifier offers nothing",
              DbSchema.Suggest(snap, "SELECT 1", "nosuch", "").Count == 0, "");

        // Straight after FROM only a table can be legal.
        var afterFrom = DbSchema.Suggest(snap, "SELECT * FROM so", "", "so", before: "SELECT * FROM so");
        Check("after FROM, only tables are offered",
              afterFrom.Count > 0 && afterFrom.All(i => i.Kind == SqlItemKind.Table), Show(afterFrom));
        Check("and each says how wide it is",
              afterFrom.First(i => i.Text == "so").Detail == "3 cols", Show(afterFrom));

        // The one that matters: columns come from the tables the statement names.
        var scoped = DbSchema.Suggest(snap, "SELECT  FROM soitem si", "", "qty", before: "SELECT qty");
        Check("columns are scoped to the tables in the statement",
              Words(scoped).Contains("qtyOrdered"), Show(scoped));
        Check("a scoped column names its table",
              scoped.First(i => i.Text == "qtyOrdered").Detail == "soitem", Show(scoped));

        var unrelated = DbSchema.Suggest(snap, "SELECT  FROM so", "", "qty", before: "SELECT qty");
        Check("a column from a table not in the statement is not offered",
              !Words(unrelated).Contains("qtyOrdered"), Show(unrelated));

        // Position decides the order, never what is excluded: a keyword is legal
        // almost everywhere, so hiding one would be worse than ranking it second.
        var inWhere = DbSchema.Suggest(snap, "SELECT * FROM so WHERE n", "", "n",
                                       before: "SELECT * FROM so WHERE n");
        Check("in a WHERE clause a column comes first",
              inWhere.Count > 0 && inWhere[0].Kind == SqlItemKind.Column, Show(inWhere));
        Check("but keywords are still there",
              inWhere.Any(i => i.Kind == SqlItemKind.Keyword) ||
              !SqlHighlighter.Keywords.Any(k => k.StartsWith("n", StringComparison.OrdinalIgnoreCase)),
              Show(inWhere));

        var atStart = DbSchema.Suggest(snap, "sel", "", "sel", before: "sel");
        Check("at the start of a statement a keyword comes first",
              atStart.Count > 0 && atStart[0].Kind == SqlItemKind.Keyword, Show(atStart));
        Check("keywords are offered in upper case",
              atStart[0].Text == "SELECT", atStart[0].Text);

        // A column on more than one table names them rather than picking one.
        var shared = DbSchema.Suggest(snap, "SELECT  FROM so JOIN part ON 1=1", "", "id",
                                      before: "SELECT id");
        Check("a column on several tables lists them",
              shared.First(i => i.Text == "id").Detail.Contains("part") &&
              shared.First(i => i.Text == "id").Detail.Contains("so"),
              Show(shared));

        Check("an aliased table counts as in scope",
              DbSchema.InScope(snap, "SELECT * FROM soitem si JOIN part p ON p.id = si.id")
                      .OrderBy(t => t).SequenceEqual(["part", "soitem"]), "");

        // Before any FROM there is nothing to scope to, so a short prefix would
        // match thousands of columns and bury the keywords.
        var early = DbSchema.Suggest(snap, "SELECT st", "", "st", before: "SELECT st");
        Check("with no table named a short prefix stays keyword-led",
              !Words(early).Contains("statusId"), Show(early));
        var longer = DbSchema.Suggest(snap, "SELECT sta", "", "sta", before: "SELECT sta");
        Check("a longer prefix does reach the columns",
              Words(longer).Contains("statusId"), Show(longer));

        Check("with no schema it still offers keywords",
              Words(DbSchema.Suggest(null, "SELECT 1", "", "sel")).Contains("SELECT"), "");

        var parsedSchema = DbSchema.Parse("srv", """[{"t":"part","c":"id"},{"t":"part","c":"num"}]""");
        Check("a data-query result becomes a snapshot",
              parsedSchema.Tables["part"].SequenceEqual(["id", "num"]), "");
        Check("column order is kept", parsedSchema.ColumnCount == 2, "");


        Section("9s. Saved requests");
        var beforeSaved = SavedRequests.Load().Count;
        var req = new SavedRequest
        {
            Name = "selftest-request",
            EndpointId = "part-get",
            Method = "GET",
            Path = "/api/parts/{id}",
            PathValues = { ["id"] = "{{partId}}" },
            Query = { new NameValue { Name = "page", Value = "1" } },
            Captures = { new CaptureRule { Path = "id", Variable = "partId" } },
        };
        SavedRequests.Put(req);
        var loaded = SavedRequests.Load().FirstOrDefault(r => r.Name == "selftest-request");
        Check("a request is kept", loaded is not null, "");
        // Saving the expanded value would weld the request to one server.
        Check("placeholders are kept, not their current values",
              loaded!.PathValues["id"] == "{{partId}}", loaded.PathValues["id"]);
        Check("query and capture rules survive",
              loaded.Query.Count == 1 && loaded.Captures.Count == 1, "");

        req.Name = "selftest-request";
        req.Method = "POST";
        SavedRequests.Put(req);
        Check("saving the same name replaces rather than duplicates",
              SavedRequests.Load().Count(r => r.Name == "selftest-request") == 1, "");

        SavedRequests.Remove(loaded.Id);
        SavedRequests.Save(SavedRequests.Load().Where(r => r.Name != "selftest-request").ToList());
        Check("the store is back as it was", SavedRequests.Load().Count == beforeSaved,
              SavedRequests.Load().Count + " vs " + beforeSaved);


        Section("9t. Schema browser");
        var browse = new DbSchema.Snapshot { Server = "x" };
        browse.Tables["soitem"] = ["id", "soId", "qtyOrdered", "qtyCommitted"];
        browse.Tables["so"] = ["id", "num", "statusId"];
        browse.Tables["part"] = ["id", "num", "description"];

        static List<TableNode> Tables(List<SchemaGroup> g) =>
            [.. g.FirstOrDefault(x => x.Name == "Tables")?.Items ?? []];
        static string Named(List<SchemaGroup> g) =>
            string.Join(", ", g.Select(x => x.Name + x.CountLabel));

        var all = SchemaBrowser.Build(browse, "");
        Check("with no filter every table is listed", Tables(all).Count == 3, Named(all));
        Check("and they are in order",
              Tables(all).Select(t => t.Name).SequenceEqual(["part", "so", "soitem"]),
              string.Join(",", Tables(all).Select(t => t.Name)));
        Check("a table carries its columns",
              Tables(all).First(t => t.Name == "so").Columns.Count == 3, "");
        Check("a column knows its table",
              Tables(all).First(t => t.Name == "so").Columns[0].Table == "so", "");
        Check("and inserts qualified",
              Tables(all).First(t => t.Name == "so").Columns[0].Insert == "so.id", "");

        var byTable = SchemaBrowser.Build(browse, "soit");
        Check("a table matches by name",
              Tables(byTable).Count == 1 && Tables(byTable)[0].Name == "soitem", Named(byTable));
        Check("a table matched by name keeps all its columns",
              Tables(byTable)[0].Columns.Count == 4, Tables(byTable)[0].Columns.Count + " columns");

        // Finding which table holds a column is most of what this is opened for.
        var byColumn = SchemaBrowser.Build(browse, "qtyCommitted");
        Check("a table matches through its columns",
              Tables(byColumn).Count == 1 && Tables(byColumn)[0].Name == "soitem", Named(byColumn));
        Check("and shows only the columns that matched",
              Tables(byColumn)[0].Columns.Count == 1 &&
              Tables(byColumn)[0].Columns[0].Name == "qtyCommitted", "");
        Check("expanded, so the match is visible without a click",
              Tables(byColumn)[0].IsExpanded, "");
        Check("whereas a name match stays collapsed", !Tables(byTable)[0].IsExpanded, "");

        Check("a term can match several tables",
              Tables(SchemaBrowser.Build(browse, "num")).Count == 2,
              Named(SchemaBrowser.Build(browse, "num")));
        Check("matching ignores case",
              Tables(SchemaBrowser.Build(browse, "SOITEM")).Count == 1, "");
        Check("no match gives nothing", SchemaBrowser.Build(browse, "zzz").Count == 0, "");
        Check("no schema gives nothing rather than throwing",
              SchemaBrowser.Build(null, "so").Count == 0, "");
        Check("the summary says what is loaded",
              SchemaBrowser.Describe(browse, all).Contains("3 of 3 tables"),
              SchemaBrowser.Describe(browse, all));
        Check("and says when nothing is",
              SchemaBrowser.Describe(null, []).Contains("Not loaded"), "");


        Section("9u. The credential vault");
        // Against the real Windows vault, then cleaned up.
        var vaultKey = CredentialStore.TargetFor("http://selftest.invalid:2456", "selftest-user");
        CredentialStore.Delete(vaultKey);

        Check("nothing is stored to begin with", !CredentialStore.Exists(vaultKey), "");
        var wrote = CredentialStore.Save(vaultKey, "selftest-user", "p@ss word é中");
        Check("a password is stored", wrote, wrote ? "" : "CredWrite refused");

        if (wrote)
        {
            // Unicode and spaces both have to survive the marshalling.
            Check("it comes back exactly", CredentialStore.Load(vaultKey) == "p@ss word é中",
                  CredentialStore.Load(vaultKey) ?? "(null)");
            Check("and reads as present", CredentialStore.Exists(vaultKey), "");

            CredentialStore.Save(vaultKey, "selftest-user", "second");
            Check("saving again replaces it", CredentialStore.Load(vaultKey) == "second", "");

            Check("deleting removes it",
                  CredentialStore.Delete(vaultKey) && !CredentialStore.Exists(vaultKey), "");
        }

        Check("an unknown key reads as nothing, not an error",
              CredentialStore.Load("FbApiTool:no-such-thing:nobody") is null, "");
        Check("deleting something absent does not throw",
              !CredentialStore.Delete("FbApiTool:no-such-thing:nobody"), "");

        // The key has to separate servers: the same person routinely has
        // different passwords on a sandbox and on a customer's box.
        Check("the key is per server and user",
              CredentialStore.TargetFor("http://a:2456", "bob") !=
              CredentialStore.TargetFor("http://b:2456", "bob") &&
              CredentialStore.TargetFor("http://a:2456", "bob") !=
              CredentialStore.TargetFor("http://a:2456", "sue"), "");
        Check("and a trailing slash does not make a different key",
              CredentialStore.TargetFor("http://a:2456/", "bob") ==
              CredentialStore.TargetFor("http://a:2456", "bob"), "");
        Check("the key is namespaced so it is recognisable in the vault",
              CredentialStore.TargetFor("http://a", "bob").StartsWith("FbApiTool:"), "");


        Section("9v. Views in the schema");
        // information_schema.COLUMNS covers views as well as base tables, so
        // they were always in the list — just indistinguishable.
        var mixed = DbSchema.Parse("srv", """
            [{"tbl":"part","col":"id","kind":"BASE TABLE"},
             {"tbl":"part","col":"num","kind":"BASE TABLE"},
             {"tbl":"qohview","col":"partId","kind":"VIEW"},
             {"tbl":"qohview","col":"qty","kind":"VIEW"}]
            """);
        Check("both kinds are read", mixed.Tables.Count == 2, mixed.Tables.Count + " names");
        Check("a view is marked as one", mixed.IsView("qohview") && !mixed.IsView("part"), "");
        Check("the counts separate", mixed.ViewCount == 1 && mixed.ColumnCount == 4, "");

        DbSchema.ApplyHeavyViews(mixed, """[{"n":"qohview"}]""");
        Check("a materialising view is flagged", mixed.IsHeavy("qohview"), "");
        Check("and a plain table is not", !mixed.IsHeavy("part"), "");

        // A cache written before views were understood loads fine and is
        // quietly wrong, so it is versioned out rather than trusted.
        var legacy = DbSchema.Parse("srv", """[{"t":"part","c":"id"}]""");
        Check("the old column names still parse",
              legacy.Tables.ContainsKey("part") && legacy.ViewCount == 0, "");
        Check("a fresh snapshot is stamped with the current version",
              legacy.Version == DbSchema.CacheVersion, legacy.Version.ToString());

        var groups = SchemaBrowser.Build(mixed, "");
        Check("the browser separates them",
              groups.Count == 2 && groups[0].Name == "Tables" && groups[1].Name == "Views",
              string.Join(",", groups.Select(g => g.Name + g.CountLabel)));
        Check("a table is labelled tbl",
              groups[0].Items[0].KindLabel == "tbl" && !groups[0].Items[0].IsView, "");
        Check("a view is labelled view",
              groups[1].Items[0].KindLabel == "view" && groups[1].Items[0].IsView, "");
        Check("and carries the warning",
              groups[1].Items[0].IsHeavy && groups[1].Items[0].Hint.Contains("GROUP BY"),
              groups[1].Items[0].Hint);

        Check("a group is dropped when empty",
              SchemaBrowser.Build(legacy, "").Count == 1, "");
        Check("the summary counts each kind",
              SchemaBrowser.Describe(mixed, groups).Contains("1 of 1 tables") &&
              SchemaBrowser.Describe(mixed, groups).Contains("1 of 1 views"),
              SchemaBrowser.Describe(mixed, groups));

        // Completion has to tell them apart too.
        var viewHit = DbSchema.Suggest(mixed, "SELECT 1 FROM qoh", "", "qoh",
                                       before: "SELECT 1 FROM qoh");
        Check("a view is offered as a view, not a table",
              viewHit.Count == 1 && viewHit[0].Kind == SqlItemKind.View, viewHit[0].KindLabel);
        Check("and its cost is on the row",
              viewHit[0].Detail.Contains("materialises"), viewHit[0].Detail);

        Section("9v2. Preferences");

        static Func<string, string?> Store(params string[] pairs)
        {
            var d = new Dictionary<string, string>();
            for (var i = 0; i + 1 < pairs.Length; i += 2) d[pairs[i]] = pairs[i + 1];
            return k => d.TryGetValue(k, out var v) ? v : null;
        }

        Check("an unset idle time is the default",
              Prefs.IdleMinutes(Store()) == Prefs.DefaultIdleMinutes, Prefs.DefaultIdleMinutes + "");
        Check("a stored one is used",
              Prefs.IdleMinutes(Store(Prefs.IdleMinutes_, "25")) == 25, "");

        // A zero here would sign the user out the moment the mouse stopped,
        // which reads as the tool dropping the connection by itself.
        Check("zero is refused, not obeyed",
              Prefs.IdleMinutes(Store(Prefs.IdleMinutes_, "0")) == Prefs.DefaultIdleMinutes, "");
        Check("so is a negative", Prefs.IdleMinutes(Store(Prefs.IdleMinutes_, "-5")) == Prefs.DefaultIdleMinutes, "");
        Check("so is nonsense", Prefs.IdleMinutes(Store(Prefs.IdleMinutes_, "soon")) == Prefs.DefaultIdleMinutes, "");
        Check("and so is a week", Prefs.IdleMinutes(Store(Prefs.IdleMinutes_, "99999")) == Prefs.DefaultIdleMinutes, "");

        Check("the grace period clamps the same way",
              Prefs.GraceSeconds(Store(Prefs.GraceSeconds_, "1")) == Prefs.DefaultGraceSeconds, "");
        Check("a sensible grace period is kept",
              Prefs.GraceSeconds(Store(Prefs.GraceSeconds_, "45")) == 45, "");

        // Absent means on, for both: a tool that has never been configured
        // should still release its licence and still explain itself.
        Check("idle sign-out is on unless turned off", Prefs.IdleEnabledOr(Store()), "");
        Check("and off when it is", !Prefs.IdleEnabledOr(Store(Prefs.IdleEnabled, "0")), "");
        Check("the tour is pending on a fresh install", Prefs.TourPending(Store()), "");
        Check("and not once it has run", !Prefs.TourPending(Store(Prefs.TipsDone, "1")), "");

        // The watch has to take the configured timings, not its own defaults.
        var configured = new IdleWatch { IdleAfter = TimeSpan.FromMinutes(3), Grace = TimeSpan.FromSeconds(30) };
        Check("the watch takes a configured idle time", configured.IdleAfter == TimeSpan.FromMinutes(3), "");
        Check("and a configured grace period", configured.Grace == TimeSpan.FromSeconds(30), "");

        Section("9w. Idle sign-out");
        // Seat-limited licences: a held session is a seat nobody else can have.
        var watch = new IdleWatch(TimeSpan.FromMinutes(10), TimeSpan.FromMinutes(2));
        var t0 = new DateTime(2026, 1, 1, 9, 0, 0, DateTimeKind.Utc);
        watch.Touch(t0);

        Check("disabled, nothing ever happens",
              watch.State(t0.AddHours(3)) == IdleState.Active, "");

        watch.Enabled = true;
        Check("just used is active", watch.State(t0.AddMinutes(1)) == IdleState.Active, "");
        Check("still active just before the threshold",
              watch.State(t0.AddMinutes(9.9)) == IdleState.Active, "");
        Check("warns at the threshold", watch.State(t0.AddMinutes(10)) == IdleState.Warning, "");
        Check("still only warning inside the grace period",
              watch.State(t0.AddMinutes(11.9)) == IdleState.Warning, "");
        Check("expires once the grace period is over",
              watch.State(t0.AddMinutes(12)) == IdleState.Expired, "");

        Check("the countdown counts down",
              watch.SecondsLeft(t0.AddMinutes(11)) == 60 &&
              watch.SecondsLeft(t0.AddMinutes(11.5)) == 30,
              watch.SecondsLeft(t0.AddMinutes(11)) + "s");
        Check("and says what will happen",
              watch.Message(t0.AddMinutes(11)).Contains("signing out in 60s"),
              watch.Message(t0.AddMinutes(11)));
        Check("no countdown while active", watch.SecondsLeft(t0.AddMinutes(1)) == 0, "");

        // Any activity has to reset it, or the warning is just noise.
        watch.Touch(t0.AddMinutes(11));
        Check("activity during the warning resets it",
              watch.State(t0.AddMinutes(11.5)) == IdleState.Active, "");
        Check("and the clock starts again from there",
              watch.State(t0.AddMinutes(21.5)) == IdleState.Warning, "");


        Section("10. Catalog round-trip");
        var tmp = Path.Combine(Path.GetTempPath(), "fbapitool-selftest-" + Guid.NewGuid().ToString("N")[..8] + ".json");
        File.WriteAllText(tmp, System.Text.Json.JsonSerializer.Serialize(merged, ApiCatalog.Json));
        var back = ApiCatalog.Read(tmp);
        Check("saving and reloading keeps every endpoint", back.Endpoints.Count == merged.Endpoints.Count, "");
        Check("and keeps the body templates",
              back.Endpoints.Count(e => e.BodySample is not null) == merged.Endpoints.Count(e => e.BodySample is not null), "");
        Check("and keeps the field lists",
              back.Endpoints.Sum(e => e.Attributes.Count) == merged.Endpoints.Sum(e => e.Attributes.Count), "");
        File.Delete(tmp);

        if (user is null)
        {
            Console.WriteLine("\n(no credentials supplied — skipping the live request checks)");
            return Done();
        }

        Section("11. Live request");
        var fb = new FishbowlClient { BaseUrl = server, AppName = "Fishbowl Advanced API Tool", AppId = 101 };
        try
        {
            await fb.LoginAsync(user, pass ?? "");
            Check("signed in", fb.IsLoggedIn, fb.User?["userFullName"]?.ToString() ?? "");
        }
        catch (Exception ex) { Check("signed in", false, ex.Message); return Done(); }

        Section("11b. Access rights against the real user");

        // A deliberately restricted user, so the mapping is exercised rather
        // than short-circuited. The real accounts on this server both hold
        // Full Rights, which by design produces no chip at all.
        var limited = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
            { "Sales Order-View", "Inventory-Show Part Cost" };

        // The prose form of a right is followed by ordinary words. A greedy
        // match swallowed them, producing a right name nobody holds and
        // reporting an entitled user as blocked.
        var prose = new ApiEndpoint
        {
            Id = "probe", Method = "GET", Path = "/probe",
            Description = "Requires the Sales Order-View access right to call this.",
        };
        var proseCheck = AccessRights.For(prose, limited);
        Check("the prose form stops at the right name",
              proseCheck?.Right == "Sales Order-View", proseCheck?.Right ?? "(none)");
        Check("and is not reported as blocked", proseCheck?.Blocked == false, proseCheck?.Label ?? "");

        var multi = new ApiEndpoint
        {
            Id = "probe2", Method = "GET", Path = "/probe2",
            Description = "Requires Inventory-Show Part Cost before the cost column is returned.",
        };
        Check("a multi-word right after the dash survives",
              AccessRights.For(multi, limited)?.Right == "Inventory-Show Part Cost",
              AccessRights.For(multi, limited)?.Right ?? "(none)");

        var soGet = shipped.Endpoints.FirstOrDefault(e => e.Key == "GET /api/sales-orders/{id}");
        Check("the endpoint is in the catalog", soGet is not null, soGet?.Key ?? "");

        if (soGet is not null)
        {
            var mapped = AccessRights.For(soGet, limited);
            Check("its right is read from the description", mapped?.Documented == "SO_VIEW", mapped?.Documented ?? "(none)");
            Check("and maps to the server's own name", mapped?.Right == "Sales Order-View", mapped?.Right ?? "(unmapped)");
            Check("a holder is reported as having it", mapped?.Held == true, mapped?.Label ?? "");

            var without = AccessRights.For(soGet, new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "Part-View" });
            Check("and a non-holder as blocked", without?.Blocked == true, without?.Label ?? "");

            // The built-in administrator belongs to no user group, so the login
            // enumerates nothing. That is no rights RECORD, not no rights.
            Check("the built-in admin's empty list is not read as 'blocked'",
                  AccessRights.For(soGet, new HashSet<string>()) is null, "no chip");

            Check("nor is a Full Rights holder",
                  AccessRights.For(soGet, new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "Full Rights" }) is null,
                  "no chip");

            Check("signed out, it says so rather than guessing",
                  AccessRights.For(soGet, null)?.Held is null, AccessRights.For(soGet, null)?.Label ?? "");
        }

        // What the live account actually is, and what that means for the chip.
        Check("the login returned rights", fb.Rights.Count > 0, fb.Rights.Count + " rights");
        Check("Sales Order-View is among them", fb.Rights.Contains("Sales Order-View"), "");
        Check("so is Full Rights", fb.Rights.Contains("Full Rights"), "");
        Check("so this user gets no chips at all",
              shipped.Endpoints.All(e => AccessRights.For(e, fb.Rights) is null), "cannot be blocked");

        // Every right the catalog documents, against a restricted user.
        Console.WriteLine();
        foreach (var e in shipped.Endpoints)
        {
            var c = AccessRights.For(e, limited);
            if (c is null) continue;
            Console.WriteLine("        " + e.Key.PadRight(34) + " " + c.Documented.PadRight(12) +
                              " -> " + (c.Right ?? "(unmapped)").PadRight(24) +
                              " held=" + (c.Held?.ToString() ?? "unknown"));
        }

        Console.WriteLine();
        Console.WriteLine("        " + shipped.Endpoints.Count(e => AccessRights.For(e, limited) is not null) +
                          " of " + shipped.Endpoints.Count + " endpoints document an access right at all.");
        Console.WriteLine();



        var runner = new ApiRunner();
        var r = await runner.SendAsync(server, "GET", "/api/location-groups", [], [], null, "application/json", fb.Token);
        Check("a catalogued GET succeeds", r.Ok, r.Status + " " + r.Reason + " in " + r.Millis + " ms");
        Check("the response is recognised as JSON", r.IsJson, Trim(r.Body));
        Check("the table view finds rows", ApiRunner.Tabulate(r.Body).Rows.Count > 0, "");
        Check("the token never reaches the log",
              r.RequestHeaders.All(h => !h.Value.Contains(fb.Token ?? "\0")),
              string.Join(", ", r.RequestHeaders.Select(h => h.Key + "=" + h.Value)));

        var q = await runner.SendAsync(server, "GET", "/api/data-query",
            [new("query", "SELECT id, num FROM part ORDER BY num LIMIT 2")], [], null, "application/json", fb.Token);
        Check("a query parameter round-trips", q.Ok && q.IsJson, q.Status + " " + Trim(q.Body));

        var missing = await runner.SendAsync(server, "GET", "/api/sales-orders/999999999", [], [], null, "application/json", fb.Token);
        Check("a 404 comes back as a result, not an exception", missing.Status == 404, missing.Status.ToString());

        await fb.LogoutAsync();
        Check("signed out", !fb.IsLoggedIn, "");
        return Done();
    }

    // ── helpers ─────────────────────────────────────────────────────────

    /// <summary>{"a":"he said \"hi\""} — a value containing escaped quotes.</summary>
    private const string RawWithEscapes = "{\"a\":\"he said \\\"hi\\\"\"}";

    private static string? FindProject()
    {
        var d = new DirectoryInfo(AppContext.BaseDirectory);
        while (d is not null)
        {
            if (File.Exists(Path.Combine(d.FullName, "assets", "catalog.json"))) return d.FullName;
            d = d.Parent;
        }
        return null;
    }

    private static bool Parses(string json)
    {
        try { return JsonNode.Parse(json) is not null; } catch { return false; }
    }

    /// <summary>Compare two JSON documents by structure, not by whitespace.</summary>
    private static bool Same(string a, string b)
    {
        try
        {
            return JsonNode.Parse(a)!.ToJsonString() == JsonNode.Parse(b)!.ToJsonString();
        }
        catch { return false; }
    }

    private static string Dupes(IEnumerable<string> xs)
    {
        var d = xs.GroupBy(x => x, StringComparer.OrdinalIgnoreCase)
                  .Where(g => g.Count() > 1).Select(g => g.Key).Take(4).ToList();
        return d.Count == 0 ? "" : "duplicated: " + string.Join(", ", d);
    }

    private static string First(IEnumerable<string> xs) => xs.FirstOrDefault() ?? "";

    private static void Section(string s) => Console.WriteLine("\n=== " + s + " ===");

    private static void Check(string what, bool ok, string detail)
    {
        if (!ok) _fail++;
        Console.ForegroundColor = ok ? ConsoleColor.Green : ConsoleColor.Red;
        Console.Write(ok ? "  PASS  " : "  FAIL  ");
        Console.ResetColor();
        Console.WriteLine(what + (string.IsNullOrWhiteSpace(detail) ? "" : "   [" + detail + "]"));
    }

    private static string Trim(string s)
    {
        s = s.Replace("\r", " ").Replace("\n", " ").Trim();
        return s.Length <= 90 ? s : s[..90] + "…";
    }

    private static int Done()
    {
        Console.WriteLine();
        if (_fail == 0) { Console.ForegroundColor = ConsoleColor.Green; Console.WriteLine("All checks passed."); }
        else { Console.ForegroundColor = ConsoleColor.Red; Console.WriteLine(_fail + " check(s) FAILED."); }
        Console.ResetColor();
        return _fail == 0 ? 0 : 1;
    }
}
