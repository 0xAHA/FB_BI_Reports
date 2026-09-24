namespace FbApiTool;

/// <summary>
/// Which result cells read better as a coloured pill than as text.
///
/// What a WORD means is not decided here — <see cref="Tone"/> owns that, and
/// the JSON view and the WPF table read the same answer. This file adds the
/// part that is specific to a table of query results: whether a column should
/// be drawn as pills at all.
///
/// That question is separate because a data query comes back as strings with
/// no types attached, so a status and a description are the same shape. Two
/// things make a column worth colouring: every value in it is one of a small
/// set of known words, and the column says it holds a state. Anything else
/// stays text — a pill round a part number would be decoration, and decoration
/// on the wrong column makes the right one stop registering.
/// </summary>
public static class CellStyle
{
    /// <summary>
    /// The tone for one value, or None when it is ordinary data.
    ///
    /// A boolean is coloured wherever it appears, because true and false read
    /// the same way in every column. A status word is only coloured in a column
    /// that says it holds a status: "Open" is a state on an order and a
    /// perfectly ordinary word in a description.
    /// </summary>
    public static ValueTone For(string? column, string? value)
    {
        var v = (value ?? "").Trim();
        if (v.Length == 0) return ValueTone.None;

        var col = (column ?? "").ToLowerInvariant();

        // A boolean means the same thing everywhere, so it needs no column to
        // vouch for it.
        if (IsBoolean(v)) return Tone.Classify(v);

        // A bit(1) that came back as a digit. Gated on the column name,
        // because a bare 1 or 0 anywhere else is a number, not a state.
        if (col.EndsWith("flag"))
        {
            if (v == "1") return ValueTone.Positive;
            if (v == "0") return ValueTone.Negative;
        }

        if (!col.Contains("status") && !col.Contains("state")) return ValueTone.None;

        // A status id is a number. Leave it as one: colouring 20 tells nobody
        // anything, and it would drag the whole column into pill mode.
        if (double.TryParse(v, out _)) return ValueTone.None;

        // A word this vocabulary does not know, in a column that says it holds
        // a state, still gets a pill — just a neutral one. The column reads as
        // a set of states either way, and leaving one value as bare text in the
        // middle of them looks like a fault.
        var tone = Tone.Classify(v);
        return tone is ValueTone.None or ValueTone.Empty ? ValueTone.Active : tone;
    }

    /// <summary>
    /// Should this whole column be drawn as pills?
    ///
    /// All or nothing, per column. A column where only some rows are coloured
    /// reads as a rendering fault rather than as a distinction, so a single
    /// value that is not a known state keeps the whole column as text.
    ///
    /// The distinct-value cap is the second guard: a column of a hundred
    /// different words is prose, whatever the words happen to be.
    /// </summary>
    public static bool IsPillColumn(string column, IEnumerable<string?> values, int maxDistinct = 12)
    {
        var distinct = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var any = false;

        foreach (var value in values)
        {
            var v = (value ?? "").Trim();
            if (v.Length == 0) continue;               // a blank cell is just blank

            if (For(column, v) == ValueTone.None) return false;

            any = true;
            distinct.Add(v);
            if (distinct.Count > maxDistinct) return false;
        }

        return any;
    }

    private static bool IsBoolean(string v) =>
        v.Equals("true", StringComparison.OrdinalIgnoreCase) ||
        v.Equals("false", StringComparison.OrdinalIgnoreCase) ||
        v.Equals("yes", StringComparison.OrdinalIgnoreCase) ||
        v.Equals("no", StringComparison.OrdinalIgnoreCase);
}
