namespace FbApiTool;

/// <summary>The outcome of comparing two result sets.</summary>
public sealed record QueryDiffResult(
    string Summary,
    List<string> Columns,
    List<Dictionary<string, string>> Rows)
{
    /// <summary>The column the row markers go in. Named so it sorts to the front.</summary>
    public const string MarkerColumn = "±";

    public bool Any => Rows.Count > 0;
}

/// <summary>
/// Compares two saved result sets and says what moved.
///
/// Rows are matched on a key column when one can be found, so an edited row
/// reads as one change rather than as a deletion and an insertion. Without a
/// key the only honest comparison is whole-row equality, and that is what it
/// falls back to.
///
/// The key is chosen by evidence, not by name: the first column whose values
/// are unique and complete on BOTH sides. A column called "id" that repeats —
/// a join will do that — is not a key, and using it would pair unrelated rows
/// and report nonsense.
/// </summary>
public static class QueryDiff
{
    public static QueryDiffResult Compare(
        List<string> columnsA, List<Dictionary<string, string>> rowsA,
        List<string> columnsB, List<Dictionary<string, string>> rowsB,
        string labelA = "saved", string labelB = "current")
    {
        var columns = columnsA.Concat(columnsB).Distinct().ToList();
        var key = FindKey(columns, rowsA, rowsB);

        var outRows = new List<Dictionary<string, string>>();
        int added = 0, removed = 0, changed = 0;

        if (key is null)
        {
            // No key: compare as bags of identical rows. Anything present a
            // different number of times shows up, and nothing is paired.
            var bagA = Bag(rowsA, columns);
            var bagB = Bag(rowsB, columns);

            foreach (var (sig, rows) in bagA)
            {
                var extra = rows.Count - (bagB.TryGetValue(sig, out var other) ? other.Count : 0);
                for (var i = 0; i < extra; i++) { outRows.Add(Mark(rows[0], columns, "−")); removed++; }
            }
            foreach (var (sig, rows) in bagB)
            {
                var extra = rows.Count - (bagA.TryGetValue(sig, out var other) ? other.Count : 0);
                for (var i = 0; i < extra; i++) { outRows.Add(Mark(rows[0], columns, "+")); added++; }
            }
        }
        else
        {
            var byKeyA = rowsA.ToDictionary(r => r[key], r => r, StringComparer.Ordinal);
            var byKeyB = rowsB.ToDictionary(r => r[key], r => r, StringComparer.Ordinal);

            foreach (var (k, a) in byKeyA)
            {
                if (!byKeyB.TryGetValue(k, out var b)) { outRows.Add(Mark(a, columns, "−")); removed++; continue; }

                var diffs = columns.Where(c => Cell(a, c) != Cell(b, c)).ToList();
                if (diffs.Count == 0) continue;

                // Only the fields that moved carry "old → new"; the rest stay
                // as they are, so the row is still recognisable.
                var row = Mark(b, columns, "~");
                foreach (var c in diffs) row[c] = Cell(a, c) + "  →  " + Cell(b, c);
                outRows.Add(row);
                changed++;
            }

            foreach (var (k, b) in byKeyB)
                if (!byKeyA.ContainsKey(k)) { outRows.Add(Mark(b, columns, "+")); added++; }
        }

        var summary =
            $"{labelA}: {rowsA.Count} row(s)   {labelB}: {rowsB.Count} row(s)" +
            (key is null
                ? "   ·   matched on the whole row — no unique key column found"
                : $"   ·   matched on \"{key}\"") +
            $"\n{added} added   {removed} removed   {changed} changed" +
            (added + removed + changed == 0 ? "\n\nThe two results are identical." : "");

        var ordered = new List<string> { QueryDiffResult.MarkerColumn };
        ordered.AddRange(columns);
        return new QueryDiffResult(summary, ordered, outRows);
    }

    /// <summary>
    /// The first column that could actually identify a row: present and unique
    /// on both sides.
    /// </summary>
    private static string? FindKey(List<string> columns,
                                   List<Dictionary<string, string>> a,
                                   List<Dictionary<string, string>> b)
    {
        foreach (var c in columns)
        {
            if (!Usable(a, c) || !Usable(b, c)) continue;
            return c;
        }
        return null;

        static bool Usable(List<Dictionary<string, string>> rows, string c)
        {
            if (rows.Count == 0) return true;          // an empty side cannot disagree
            var seen = new HashSet<string>(StringComparer.Ordinal);
            foreach (var r in rows)
            {
                if (!r.TryGetValue(c, out var v) || string.IsNullOrEmpty(v)) return false;
                if (!seen.Add(v)) return false;
            }
            return true;
        }
    }

    private static Dictionary<string, List<Dictionary<string, string>>> Bag(
        List<Dictionary<string, string>> rows, List<string> columns)
    {
        var bag = new Dictionary<string, List<Dictionary<string, string>>>(StringComparer.Ordinal);
        foreach (var r in rows)
        {
            var sig = string.Join("\u001f", columns.Select(c => Cell(r, c)));
            if (!bag.TryGetValue(sig, out var list)) bag[sig] = list = [];
            list.Add(r);
        }
        return bag;
    }

    private static Dictionary<string, string> Mark(
        Dictionary<string, string> source, List<string> columns, string marker)
    {
        var row = new Dictionary<string, string> { [QueryDiffResult.MarkerColumn] = marker };
        foreach (var c in columns) row[c] = Cell(source, c);
        return row;
    }

    private static string Cell(Dictionary<string, string> row, string column) =>
        row.TryGetValue(column, out var v) ? v ?? "" : "";
}
