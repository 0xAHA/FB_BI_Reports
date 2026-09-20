using System.Collections.ObjectModel;
using System.ComponentModel;

namespace FbApiTool;

/// <summary>A column in the schema browser.</summary>
public sealed class ColumnNode(string table, string name)
{
    public string Table { get; } = table;
    public string Name { get; } = name;

    /// <summary>What gets inserted: qualified, because that is what a join needs.</summary>
    public string Insert => Table + "." + Name;
}

/// <summary>A table or a view, and the columns under it.</summary>
public sealed partial class TableNode(string name, IEnumerable<string> columns,
                                      bool isView = false, bool isHeavy = false) : INotifyPropertyChanged
{
    public string Name { get; } = name;

    public bool IsView { get; } = isView;

    /// <summary>A view MySQL has to build in full before it can filter it.</summary>
    public bool IsHeavy { get; } = isHeavy;

    public ObservableCollection<ColumnNode> Columns { get; } =
        [.. columns.Select(c => new ColumnNode(name, c))];

    public string CountLabel => "(" + Columns.Count + ")";

    public string KindLabel => IsView ? "view" : "tbl";

    /// <summary>What gets inserted for the table itself.</summary>
    public string Insert => Name;

    public string Hint => IsView
        ? IsHeavy
            ? "A view built with GROUP BY, UNION or DISTINCT. MySQL assembles the whole thing " +
              "before applying your WHERE, so filtering it is not cheap — filter the underlying " +
              "tables instead when it matters."
            : "A view. This one filters normally."
        : "A table.";

    private bool _expanded;
    public bool IsExpanded
    {
        get => _expanded;
        set { _expanded = value; PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(IsExpanded))); }
    }

    public event PropertyChangedEventHandler? PropertyChanged;
}

/// <summary>Tables and views, kept apart.</summary>
public sealed partial class SchemaGroup(string name, List<TableNode> items) : INotifyPropertyChanged
{
    public string Name { get; } = name;
    public ObservableCollection<TableNode> Items { get; } = [.. items];
    public string CountLabel => "(" + Items.Count + ")";

    private bool _expanded = true;
    public bool IsExpanded
    {
        get => _expanded;
        set { _expanded = value; PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(IsExpanded))); }
    }

    public event PropertyChangedEventHandler? PropertyChanged;
}

/// <summary>
/// Filters the schema for the browser.
///
/// A Fishbowl database has several hundred tables and tens of thousands of
/// columns, so the browser is only useful with a filter in front of it. A term
/// matches a table by name, and also matches a table whose COLUMNS match — with
/// those columns pre-expanded, since finding which table holds
/// <c>qtyCommitted</c> is most of what anyone opens this for.
///
/// Views are listed separately from tables. They were always in the schema —
/// information_schema.COLUMNS covers both — but mixed in they are easy to query
/// by accident, and some of them are far more expensive than they look.
/// </summary>
public static class SchemaBrowser
{
    public static List<SchemaGroup> Build(DbSchema.Snapshot? schema, string? filter, int maxEach = 400)
    {
        if (schema is null) return [];

        var term = (filter ?? "").Trim();
        var tables = new List<TableNode>();
        var views = new List<TableNode>();

        foreach (var (name, columns) in schema.Tables.OrderBy(t => t.Key, StringComparer.OrdinalIgnoreCase))
        {
            var isView = schema.IsView(name);
            var into = isView ? views : tables;
            if (into.Count >= maxEach) continue;

            if (term.Length == 0)
            {
                into.Add(new TableNode(name, columns, isView, schema.IsHeavy(name)));
                continue;
            }

            var nameHit = name.Contains(term, StringComparison.OrdinalIgnoreCase);
            var columnHits = columns.Where(c => c.Contains(term, StringComparison.OrdinalIgnoreCase)).ToList();
            if (!nameHit && columnHits.Count == 0) continue;

            // Matched by name: keep every column, collapsed. Matched only
            // through a column: show just the ones that matched, expanded, so
            // the reason it is in the list is visible without a click.
            var node = new TableNode(name, nameHit ? columns : columnHits, isView, schema.IsHeavy(name))
            {
                IsExpanded = !nameHit,
            };
            into.Add(node);
        }

        var groups = new List<SchemaGroup>();
        if (tables.Count > 0) groups.Add(new SchemaGroup("Tables", tables));
        if (views.Count > 0) groups.Add(new SchemaGroup("Views", views));
        return groups;
    }

    /// <summary>How many tables and views a build produced.</summary>
    public static (int Tables, int Views) Counts(List<SchemaGroup> groups) =>
        (groups.FirstOrDefault(g => g.Name == "Tables")?.Items.Count ?? 0,
         groups.FirstOrDefault(g => g.Name == "Views")?.Items.Count ?? 0);

    /// <summary>A one-line summary for the header.</summary>
    public static string Describe(DbSchema.Snapshot? schema, List<SchemaGroup> shown)
    {
        if (schema is null) return "Not loaded — connect, then Refresh.";

        var (t, v) = Counts(shown);
        var totalTables = schema.Tables.Count - schema.ViewCount;

        return t + " of " + totalTables + " tables  ·  " + v + " of " + schema.ViewCount + " views  ·  " +
               schema.ColumnCount.ToString("N0") + " columns  ·  read " +
               schema.LoadedAt.ToString("d MMM HH:mm");
    }
}
