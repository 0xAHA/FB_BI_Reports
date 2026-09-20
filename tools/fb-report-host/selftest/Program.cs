using System.Text.Json.Nodes;

namespace FbReportHost;

/// <summary>
/// Exercises everything in the host that does not need a window: the report
/// loader, and the bridge methods page JS calls. Compiles the SHIPPING sources,
/// not copies, so a green run means the real host works.
///
///   dotnet run --project selftest -- [server] [user] [password] [appName] [appId]
///
/// With no credentials it runs the offline checks only. appName/appId default
/// to the host's own identity, which an administrator must approve once in
/// Fishbowl before the first sign-in succeeds; pass an already-approved pair to
/// test without waiting for that.
/// </summary>
internal static class Program
{
    private static int _fail;

    private static async Task<int> Main(string[] args)
    {
        var server = args.Length > 0 ? args[0] : "http://localhost:2456";
        var user = args.Length > 1 ? args[1] : null;
        var pass = args.Length > 2 ? args[2] : null;
        var appName = args.Length > 3 ? args[3] : null;
        var appId = args.Length > 4 && int.TryParse(args[4], out var n) ? n : (int?)null;

        var repo = FindRepo();
        if (repo is null) { Console.Error.WriteLine("Could not locate the repo root."); return 1; }
        Console.WriteLine("repo root: " + repo + "\n");

        Section("1. Report loader — .htm source + directive expansion");
        var htm = Path.Combine(repo, "Custom", "BrightSteel", "Product_Card.htm");
        if (File.Exists(htm))
        {
            var r = ReportLoader.Load(htm, [System.IO.Path.Combine(repo, "scripts")]);
            Check("name resolved", r.Name == "Product_Card", r.Name);
            Check("html non-trivial", r.Html.Length > 50_000, r.Html.Length.ToString("N0") + " bytes");
            Check("fb-lib expanded", r.Expanded.Any(x => x.Contains("fb-lib")), string.Join(", ", r.Expanded));
            Check("fb-styles expanded", r.Expanded.Any(x => x.Contains("fb-styles")), "");
            Check("no directives left", !r.Html.Contains("{% Script") && !r.Html.Contains("{% Style"), "");
            Check("FBLib really inlined", r.Html.Contains("window.FBLib"), "");
            Check("nothing missing", r.Missing.Count == 0, string.Join(", ", r.Missing));
        }
        else Console.WriteLine("  (skipped — Product_Card.htm not present)");

        Section("2. Report loader — Deployed/*.json envelope");
        var depDir = Path.Combine(repo, "Deployed");
        var dep = Directory.Exists(depDir)
            ? Directory.GetFiles(depDir, "*-Page.json").FirstOrDefault() : null;
        if (dep is not null)
        {
            var r = ReportLoader.Load(dep, [System.IO.Path.Combine(repo, "scripts")]);
            Check("unwrapped the envelope", r.Html.TrimStart().StartsWith("<!DOCTYPE", StringComparison.OrdinalIgnoreCase),
                  Path.GetFileName(dep) + " -> " + r.Name);
            Check("html non-trivial", r.Html.Length > 20_000, r.Html.Length.ToString("N0") + " bytes");

            // What the TREE labels it. Exports are written as "<name>-Page.json",
            // so showing the filename showed everyone a "-Page" suffix that is
            // not part of the report's name — the label has to come out of the
            // envelope, and only fall back to the filename when it cannot.
            var label = ReportLoader.LabelFor(dep);
            Check("tree label comes from the envelope", label == r.Name, label);
            Check("tree label is not the filename",
                  label != Path.GetFileNameWithoutExtension(dep), Path.GetFileNameWithoutExtension(dep));
            Check("label is cached, not re-read", ReferenceEquals(label, ReportLoader.LabelFor(dep)), "");
            if (File.Exists(htm))
                Check("a source report still labels by filename",
                      ReportLoader.LabelFor(htm) == Path.GetFileNameWithoutExtension(htm), "");

            var peek = ReportLoader.Peek(dep);
            Check("Peek agrees with the loader", peek.Name == r.Name, peek.Name);
            Check("Peek reports the export kind", peek.Kind.Contains(".json"), peek.Kind);
        }
        else Console.WriteLine("  (skipped — no Deployed/*-Page.json found)");

        Section("3. Library — import, de-duplicate, tree");
        Library.EnsureRoot();
        Check("root created", Directory.Exists(Library.Root), Library.Root);
        Check("IsReport discriminates",
              Library.IsReport("a.htm") && Library.IsReport("b.JSON") && !Library.IsReport("c.txt"), "");

        var sandbox = Path.Combine(Library.Root, "__selftest");
        if (Directory.Exists(sandbox)) Directory.Delete(sandbox, true);
        if (File.Exists(htm))
        {
            var first = Library.Import(htm, sandbox);
            Check("import copies in", File.Exists(first), Path.GetFileName(first));
            Check("original untouched", File.Exists(htm), "");

            // Importing the same file twice must not overwrite the first copy.
            var second = Library.Import(htm, sandbox);
            Check("second import is renamed, not clobbered",
                  File.Exists(first) && File.Exists(second) && first != second, Path.GetFileName(second!));

            // The three answers the conflict prompt can give. Getting Overwrite
            // wrong destroys an imported report and Skip wrong silently
            // duplicates one, so both are worth pinning down.
            Check("a collision is detected before anything is written",
                  Library.Collides(htm, sandbox), "");
            Check("Skip writes nothing and says so",
                  Library.Import(htm, sandbox, Library.OnConflict.Skip) is null,
                  Directory.GetFiles(sandbox).Length + " file(s) still there");
            Check("Skip left the file count alone", Directory.GetFiles(sandbox).Length == 2, "");

            File.WriteAllText(first!, "<!DOCTYPE html><title>clobbered</title>");
            var over = Library.Import(htm, sandbox, Library.OnConflict.Overwrite);
            Check("Overwrite replaces in place, keeping the name", over == first, Path.GetFileName(over!));
            Check("Overwrite really wrote the new content",
                  new FileInfo(first!).Length > 1000, new FileInfo(first!).Length + " bytes");
            Check("Overwrite added no third file", Directory.GetFiles(sandbox).Length == 2, "");

            var third = Library.Import(htm, sandbox, Library.OnConflict.KeepBoth);
            Check("KeepBoth suffixes rather than replacing",
                  third != first && third != second && File.Exists(third!), Path.GetFileName(third!));
            File.Delete(third!);

            var tree = Library.BuildTree();
            var node = tree.Children.FirstOrDefault(c => c.Name == "__selftest");
            Check("tree shows the new folder", node is { IsFolder: true }, "");
            Check("tree shows both files", node?.Children.Count == 2,
                  string.Join(", ", node?.Children.Select(c => c.Name) ?? []));
            Check("file nodes are not folders", node?.Children.All(c => !c.IsFolder) == true, "");

            // THE bug this section exists for: a report copied into the library
            // has no repo above it, so the directive can only be resolved from
            // the library's own _shared folder. Without that the report renders
            // its "fb-lib not loaded" guard instead of running.
            Check("library report finds no repo above it",
                  ReportLoader.FindRepoRoot(first) is null, Path.GetDirectoryName(first) ?? "");

            // Importing takes EVERY .js/.css in the folder, not a fixed pair —
            // this repo's reports also name fb-mfg, xlsx, pdfjs and pdfjs-worker.
            var imported = Library.ImportSharedFrom(Path.Combine(repo, "scripts"));
            Check("shared assets present after import", Library.SharedAssetsPresent,
                  string.Join(", ", Library.CoreAssets));
            Check("import takes every asset, not just the core two",
                  imported.Contains("fb-mfg.js"), string.Join(", ", imported));

            var fromLib = ReportLoader.Load(first);
            Check("library report expands from _shared",
                  fromLib.Expanded.Count == 2 && fromLib.Missing.Count == 0, fromLib.AssetSource ?? "(none)");
            Check("FBLib inlined for a library report", fromLib.Html.Contains("window.FBLib"), "");
            Check("no directives left in a library report",
                  !fromLib.Html.Contains("{% Script") && !fromLib.Html.Contains("{% Style"), "");

            // And with _shared emptied it must fail LOUDLY, not silently.
            foreach (var f in Directory.GetFiles(Library.SharedDir)) File.Delete(f);
            var bare = ReportLoader.Load(first);
            Check("without shared assets it reports the miss", bare.Missing.Count == 2,
                  string.Join(", ", bare.Missing));
            Check("and leaves the directive visible", bare.Html.Contains("{% Script"), "");

            // Put them back from the repo — restoring from the paths just
            // deleted would (and did) throw FileNotFound.
            Library.ImportSharedFrom(Path.Combine(repo, "scripts"));
            Check("shared assets restored after the destructive check",
                  Library.SharedAssetsPresent, Library.SharedDir);

            Directory.Delete(sandbox, true);
            Check("cleanup", !Directory.Exists(sandbox), "");
        }
        else Console.WriteLine("  (skipped the import checks — no source report to copy)");

        Section("4. Repo-root discovery walks up from a nested report");
        var found = ReportLoader.FindRepoRoot(Path.Combine(repo, "Custom", "Babor", "Babor_SO_Entry.htm"));
        Check("found from a nested path", found is not null && Directory.Exists(Path.Combine(found, "scripts")), found ?? "(null)");

        if (user is null)
        {
            Console.WriteLine("\n(no credentials supplied — skipping the live checks)");
            return Done();
        }

        Section("5. REST client — login");
        var fb = new FishbowlClient { BaseUrl = server };
        if (appName is not null) fb.AppName = appName;
        if (appId is not null) fb.AppId = appId.Value;
        try
        {
            await fb.LoginAsync(user, pass ?? "");
            Check("signed in", fb.IsLoggedIn, fb.User?["userFullName"]?.ToString() ?? "");
            Check("access rights parsed", fb.Rights.Count > 0, fb.Rights.Count + " rights");
        }
        catch (Exception ex) { Check("signed in", false, ex.Message); return Done(); }

        Section("6. Bridge — the methods page JS calls");
        var logged = new List<string>();
        var store = new Dictionary<string, string>();
        var bridge = new FishbowlBridge(fb,
            (m, k) => logged.Add(k + ": " + m),
            k => store.TryGetValue(k, out var v) ? v : null,
            (k, v) => store[k] = v,
            (m, i) => logged.Add("openModule " + m + "/" + i));

        var q = bridge.RunQuery("SELECT id, num FROM part WHERE activeFlag = 1 ORDER BY num LIMIT 3");
        Check("runQuery returns a JSON array", JsonNode.Parse(q) is JsonArray { Count: 3 }, Trim(q));

        var bad = bridge.RunQuery("SELECT * FROM table_that_does_not_exist");
        Check("a failed query returns [] not a throw", bad.Trim() == "[]", bad);

        Check("getUser", JsonNode.Parse(bridge.GetUser())?["userFullName"] is not null, "");
        Check("hasUserAccess(known right)", bridge.HasUserAccess("Sales Order-View"), "");
        Check("hasUserAccess(nonsense) is false", !bridge.HasUserAccess("No Such-Right"), "");

        var lgs = bridge.GetLocationGroupList();
        Check("getLocationGroupList", JsonNode.Parse(lgs) is JsonArray { Count: > 0 }, Trim(lgs));

        var dfmt = bridge.GetProperty("DateFormatShort", "MM/dd/yyyy");
        Check("getProperty(DateFormatShort)", !string.IsNullOrWhiteSpace(dfmt), dfmt);
        Check("getProperty falls back", bridge.GetProperty("NoSuchProperty", "fallback") == "fallback", "");

        var cur = bridge.CurrencyLocale();
        var sym = JsonNode.Parse(cur)?["symbol"]?.ToString() ?? "";
        // currency.symbol holds a numeric glyph index on a real database, so a
        // digit coming back here means the trap has been reintroduced.
        Check("currencyLocale gives a symbol, not a glyph index",
              sym.Length > 0 && !double.TryParse(sym, out _), cur);

        var rest = bridge.RunRest("{\"path\":\"/api/location-groups\",\"method\":\"GET\"}");
        Check("runRestApiAsync passthrough", rest.Contains("results") || rest.TrimStart().StartsWith('{'), Trim(rest));

        bridge.SaveSettings("selftest.key", "hello");
        Check("saveSettings / loadSettings round-trip", bridge.LoadSettings("selftest.key") == "hello", "");

        bridge.ReportKey = "SelfTest";
        bridge.SaveReportData("{\"x\":1}");
        Check("saveReportData / loadReportData round-trip", bridge.LoadReportData() == "{\"x\":1}", "");

        var unsupported = false;
        try { bridge.Unsupported("getAutoPo"); } catch { unsupported = true; }
        Check("getAutoPo throws rather than lying", unsupported, "");

        Section("7. REST error shape (what a report's catch block sees)");
        try
        {
            bridge.RunRest("{\"path\":\"/api/sales-orders/999999999\",\"method\":\"GET\"}");
            Check("a 404 throws", false, "no exception");
        }
        catch (Exception ex)
        {
            var hasStatus = ex.Message.Contains("\"status\"");
            Check("error carries {status,message}", hasStatus, Trim(ex.Message));
        }

        await fb.LogoutAsync();
        Check("signed out", !fb.IsLoggedIn, "");
        return Done();
    }

    private static string? FindRepo()
    {
        var d = new DirectoryInfo(AppContext.BaseDirectory);
        while (d is not null)
        {
            if (File.Exists(Path.Combine(d.FullName, "scripts", "fb-lib.js"))) return d.FullName;
            d = d.Parent;
        }
        return null;
    }

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
