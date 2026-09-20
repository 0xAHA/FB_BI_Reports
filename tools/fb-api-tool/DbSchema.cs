using System.IO;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace FbApiTool;

/// <summary>
/// The tables and columns of the connected database, for SQL completion.
///
/// Read from the server rather than from a schema file checked into a repo,
/// because the answer is instance-specific: custom fields, and whatever
/// version that database is actually on. Cached per server, since it changes
/// about as often as an upgrade.
///
/// Keyword completion alone is the least useful kind — nobody forgets SELECT.
/// The payoff is <c>soitem.</c> offering its columns.
/// </summary>
public static partial class DbSchema
{
    /// <summary>
    /// What a cache file has to say to be usable.
    ///
    /// Bumped whenever the snapshot learns something new, because a file
    /// written before that simply does not contain it — and the failure is
    /// silent: an old cache loads perfectly well and is just quietly wrong.
    /// Version 2 added views.
    /// </summary>
    public const int CacheVersion = 2;

    /// <summary>Every table and view, and the columns on it.</summary>
    public sealed class Snapshot
    {
        public int Version { get; set; }
        public string Server { get; set; } = "";
        public DateTime LoadedAt { get; set; }
        public Dictionary<string, List<string>> Tables { get; set; } =
            new(StringComparer.OrdinalIgnoreCase);

        /// <summary>
        /// Which of those names are views rather than base tables.
        ///
        /// They were always in the list — information_schema.COLUMNS covers
        /// both — but indistinguishable, and the difference matters: a view
        /// is a different thing to query and some of them are expensive.
        /// </summary>
        public HashSet<string> Views { get; set; } = new(StringComparer.OrdinalIgnoreCase);

        /// <summary>
        /// Views whose definition uses GROUP BY, UNION or DISTINCT.
        ///
        /// MySQL cannot push a WHERE into one of these — it materialises the
        /// whole view first and filters afterwards. On this database that is
        /// 27 of the 48 views, and it is the difference between a 2 ms query
        /// and a 2 s one, so the browser says so.
        /// </summary>
        public HashSet<string> HeavyViews { get; set; } = new(StringComparer.OrdinalIgnoreCase);

        public bool IsView(string name) => Views.Contains(name);
        public bool IsHeavy(string name) => HeavyViews.Contains(name);

        public int ColumnCount => Tables.Sum(t => t.Value.Count);
        public int ViewCount => Views.Count;
    }

    private static readonly JsonSerializerOptions Json = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
    };

    private static string CacheFile(string server) =>
        Path.Combine(ApiCatalog.DataDir, "schema-" + Slug(server) + ".json");

    private static string Slug(string s) =>
        new(( s ?? "").Select(c => char.IsLetterOrDigit(c) ? char.ToLowerInvariant(c) : '-').ToArray());

    /// <summary>
    /// Every column, with what it belongs to. One round trip, joined to
    /// TABLES so a view can be told from a base table.
    /// </summary>
    public const string Query =
        "SELECT c.TABLE_NAME AS tbl, c.COLUMN_NAME AS col, t.TABLE_TYPE AS kind " +
        "FROM information_schema.COLUMNS c " +
        "JOIN information_schema.TABLES t " +
        "  ON t.TABLE_SCHEMA = c.TABLE_SCHEMA AND t.TABLE_NAME = c.TABLE_NAME " +
        "WHERE c.TABLE_SCHEMA = DATABASE() " +
        "ORDER BY c.TABLE_NAME, c.ORDINAL_POSITION";

    /// <summary>
    /// The views MySQL has to materialise before it can filter them.
    ///
    /// Matched on the definition text rather than by name, because the
    /// answer is per database and a hard-coded list would rot. LIKE rather
    /// than REGEXP: it is enough here and is portable across versions.
    /// </summary>
    public const string HeavyViewQuery =
        "SELECT TABLE_NAME AS n FROM information_schema.VIEWS " +
        "WHERE TABLE_SCHEMA = DATABASE() AND (" +
        "  UPPER(VIEW_DEFINITION) LIKE '%GROUP BY%' OR " +
        "  UPPER(VIEW_DEFINITION) LIKE '%UNION%' OR " +
        "  UPPER(VIEW_DEFINITION) LIKE '%DISTINCT%')";

    public static Snapshot? Cached(string server)
    {
        try
        {
            var f = CacheFile(server);
            if (!File.Exists(f)) return null;

            var snap = JsonSerializer.Deserialize<Snapshot>(File.ReadAllText(f), Json);

            // Too old to trust. Returning null re-reads it from the server,
            // which is a second or two once, rather than leaving the user
            // looking at 368 "tables" and no views.
            return snap?.Version == CacheVersion ? snap : null;
        }
        catch { return null; }
    }

    public static void Cache(Snapshot snapshot)
    {
        try
        {
            Directory.CreateDirectory(ApiCatalog.DataDir);
            File.WriteAllText(CacheFile(snapshot.Server), JsonSerializer.Serialize(snapshot, Json));
        }
        catch { }
    }

    /// <summary>Build a snapshot from what /api/data-query returned.</summary>
    public static Snapshot Parse(string server, string json)
    {
        var snap = new Snapshot { Version = CacheVersion, Server = server, LoadedAt = DateTime.Now };
        JsonNode? root;
        try { root = JsonNode.Parse(json); } catch { return snap; }

        var rows = root as JsonArray ?? root?["results"] as JsonArray;
        if (rows is null) return snap;

        foreach (var r in rows)
        {
            if (r is not JsonObject o) continue;

            // "tbl"/"col" now; "t"/"c" is what a cache written by an older
            // build holds, and re-reading the whole schema to rename two
            // keys would be a poor trade.
            var t = (o["tbl"] ?? o["t"])?.ToString();
            var c = (o["col"] ?? o["c"])?.ToString();
            if (string.IsNullOrEmpty(t) || string.IsNullOrEmpty(c)) continue;

            if (!snap.Tables.TryGetValue(t, out var cols)) snap.Tables[t] = cols = [];
            cols.Add(c);

            if (o["kind"]?.ToString() is { } kind &&
                kind.Contains("VIEW", StringComparison.OrdinalIgnoreCase))
                snap.Views.Add(t);
        }
        return snap;
    }

    /// <summary>Record which views materialise, from the second query.</summary>
    public static void ApplyHeavyViews(Snapshot snap, string json)
    {
        JsonNode? root;
        try { root = JsonNode.Parse(json); } catch { return; }

        var rows = root as JsonArray ?? root?["results"] as JsonArray;
        if (rows is null) return;

        foreach (var r in rows)
            if (r is JsonObject o && o["n"]?.ToString() is { Length: > 0 } name)
                snap.HeavyViews.Add(name);
    }

    // ── COMPLETION ──────────────────────────────────────────────────────

    // FROM part p / JOIN uom AS u — the alias, if there is one.
    //
    // The lookahead is load-bearing. Without it the optional alias group
    // matches the NEXT clause keyword and consumes it, so in
    // "FROM so JOIN part" the JOIN is eaten as an alias for so and part is
    // never seen at all — which silently halved the tables in scope.
    [GeneratedRegex(@"\b(?:FROM|JOIN)\s+([A-Za-z_][A-Za-z0-9_]*)" +
                    @"(?:\s+(?:AS\s+)?(?!(?:AS|ON|USING|WHERE|JOIN|INNER|LEFT|RIGHT|FULL|CROSS|OUTER|" +
                    @"GROUP|ORDER|HAVING|LIMIT|OFFSET|UNION|INTERSECT|EXCEPT|SET|VALUES)\b)" +
                    @"([A-Za-z_][A-Za-z0-9_]*))?",
                    RegexOptions.IgnoreCase)]
    private static partial Regex FromRx();

    /// <summary>
    /// What the aliases in this statement refer to.
    ///
    /// The second word after FROM is only an alias if it is not a keyword —
    /// "FROM part WHERE" would otherwise bind "WHERE" as an alias for part.
    /// </summary>
    public static Dictionary<string, string> Aliases(string sql)
    {
        var map = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (Match m in FromRx().Matches(sql ?? ""))
        {
            var table = m.Groups[1].Value;
            map[table] = table;                     // the table name works as its own qualifier

            var alias = m.Groups[2].Value;
            if (alias.Length > 0 && !SqlHighlighter.Keywords.Contains(alias)) map[alias] = table;
        }
        return map;
    }

    /// <summary>
    /// The completions to offer, given the statement, the text before the
    /// caret, and the word being typed.
    ///
    /// Ordering is by what can legally or plausibly come next, which is most of
    /// the value:
    ///
    ///   after a qualifier and a dot — that table's columns, and nothing else;
    ///   straight after FROM or JOIN — table names, since nothing else is legal;
    ///   in a SELECT list, a WHERE or an ORDER BY — columns first, keywords after;
    ///   at the start of a statement — keywords first.
    ///
    /// Columns come from the tables THIS statement names. Offering every column
    /// in the database once a FROM is written buries the handful that could be
    /// meant under thousands that could not.
    ///
    /// Nothing legal is ever excluded — a keyword is valid almost everywhere,
    /// so the guess only changes the order.
    /// </summary>
    public static List<SqlCompletion> Suggest(Snapshot? schema, string statement, string qualifier,
                                              string prefix, int max = 14, string? before = null)
    {
        var place = SqlContext.Place(before);

        // ── a qualifier: that table only ──────────────────────────────
        if (qualifier.Length > 0)
        {
            if (schema is null) return [];

            var aliases = Aliases(statement);
            if (!aliases.TryGetValue(qualifier, out var table)) table = qualifier;
            if (!schema.Tables.TryGetValue(table, out var qcols)) return [];

            return [.. qcols.Where(c => Hit(c, prefix))
                            .Select(c => new SqlCompletion(c, SqlItemKind.Column, table))
                            .Take(max)];
        }

        // ── straight after FROM or JOIN: a table name ─────────────────
        if (schema is not null && place == SqlPlace.TableName)
        {
            return [.. schema.Tables.Keys.Where(t => Hit(t, prefix))
                        .OrderBy(t => t.Length).ThenBy(t => t, StringComparer.OrdinalIgnoreCase)
                        .Select(t => Entry(schema, t))
                        .Take(max)];
        }

        if (prefix.Length == 0) return [];

        var keywords = SqlHighlighter.Keywords.Where(k => Hit(k, prefix))
            .OrderBy(k => k.Length).ThenBy(k => k, StringComparer.OrdinalIgnoreCase)
            .Select(k => new SqlCompletion(k.ToUpperInvariant(), SqlItemKind.Keyword, "keyword"))
            .ToList();

        if (schema is null) return [.. keywords.Take(max)];

        var tables = schema.Tables.Keys.Where(t => Hit(t, prefix))
            .OrderBy(t => t.Length).ThenBy(t => t, StringComparer.OrdinalIgnoreCase)
            .Select(t => Entry(schema, t))
            .ToList();

        var scope = InScope(schema, statement);
        var columns = (scope.Count > 0
                ? scope.SelectMany(t => schema.Tables[t].Select(c => (Column: c, Table: t)))
                // Nothing named yet — a SELECT list being written before its
                // FROM. Every column in the database is too many to be useful,
                // so wait until the prefix is specific enough to earn it.
                : prefix.Length >= 3
                    ? schema.Tables.SelectMany(kv => kv.Value.Select(c => (Column: c, Table: kv.Key)))
                    : [])
            .Where(x => Hit(x.Column, prefix))
            .GroupBy(x => x.Column, StringComparer.OrdinalIgnoreCase)
            // A column on several tables names them all rather than picking one.
            .Select(g => new SqlCompletion(g.Key, SqlItemKind.Column, Where(g.Select(x => x.Table))))
            .OrderBy(c => c.Text.Length).ThenBy(c => c.Text, StringComparer.OrdinalIgnoreCase)
            .ToList();

        var results = SqlContext.PrefersColumns(place)
            ? Merge(columns, keywords, tables)
            : Merge(keywords, tables, columns);

        return [.. Dedupe(results).Take(max)];
    }

    /// <summary>One table or view, labelled as whichever it is.</summary>
    private static SqlCompletion Entry(Snapshot schema, string name)
    {
        var cols = schema.Tables[name].Count + " cols";
        if (!schema.IsView(name)) return new SqlCompletion(name, SqlItemKind.Table, cols);

        // The warning is the useful half: a materialised view cannot be
        // filtered cheaply, and that is not visible from its name.
        return new SqlCompletion(name, SqlItemKind.View,
                                 schema.IsHeavy(name) ? cols + " · materialises" : cols);
    }

    private static bool Hit(string candidate, string prefix) =>
        candidate.StartsWith(prefix, StringComparison.OrdinalIgnoreCase);

    private static string Where(IEnumerable<string> tables)
    {
        var list = tables.Distinct(StringComparer.OrdinalIgnoreCase).OrderBy(t => t).ToList();
        return list.Count switch
        {
            1 => list[0],
            2 => list[0] + ", " + list[1],
            _ => list[0] + " +" + (list.Count - 1),
        };
    }

    private static IEnumerable<SqlCompletion> Merge(params List<SqlCompletion>[] groups)
    {
        foreach (var g in groups)
            foreach (var item in g)
                yield return item;
    }

    private static IEnumerable<SqlCompletion> Dedupe(IEnumerable<SqlCompletion> items)
    {
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var i in items)
            if (seen.Add(i.Kind + "\u001f" + i.Text)) yield return i;
    }

    /// <summary>The tables this statement names, that the schema knows about.</summary>
    public static List<string> InScope(Snapshot schema, string statement) =>
        [.. Aliases(statement).Values.Distinct(StringComparer.OrdinalIgnoreCase)
                             .Where(schema.Tables.ContainsKey)];
}
