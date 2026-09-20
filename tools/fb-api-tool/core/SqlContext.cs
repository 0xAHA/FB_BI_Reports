using System.Text.RegularExpressions;

namespace FbApiTool;

/// <summary>Where in a statement the caret is, which decides what belongs next.</summary>
public enum SqlPlace
{
    /// <summary>Nothing typed yet, or just after a semicolon.</summary>
    Start,
    /// <summary>Between SELECT and FROM — a list of columns.</summary>
    SelectList,
    /// <summary>Straight after FROM or JOIN — only a table is legal.</summary>
    TableName,
    /// <summary>A condition or an expression: WHERE, ON, HAVING, SET.</summary>
    Condition,
    /// <summary>ORDER BY or GROUP BY — columns again.</summary>
    ColumnList,
    /// <summary>Anywhere else.</summary>
    Unknown,
}

/// <summary>What a completion is, so the list can say so.</summary>
public enum SqlItemKind { Keyword, Table, View, Column, Variable }

/// <summary>One offer in the completion list.</summary>
public sealed partial record SqlCompletion(string Text, SqlItemKind Kind, string Detail)
{
    /// <summary>The short label on the left of the row.</summary>
    public string KindLabel => Kind switch
    {
        SqlItemKind.Keyword => "kw",
        SqlItemKind.Table => "tbl",
        SqlItemKind.View => "view",
        SqlItemKind.Variable => "var",
        _ => "col",
    };
}

/// <summary>
/// Works out what the caret is in the middle of writing.
///
/// Position is most of what decides whether a keyword or a column is wanted:
/// straight after FROM only a table can be legal, and in the middle of a WHERE
/// clause a column is far more likely than the word EXCEPT. Offering the same
/// mixed list everywhere makes the caller read every entry, which is most of
/// the reason plain keyword completion feels useless.
/// </summary>
public static partial class SqlContext
{
    // The last clause keyword before the caret, ignoring what is being typed.
    [GeneratedRegex(@"\b(SELECT|FROM|WHERE|JOIN|ON|GROUP\s+BY|ORDER\s+BY|HAVING|SET|INTO|UPDATE|VALUES)\b",
                    RegexOptions.IgnoreCase)]
    private static partial Regex ClauseRx();

    // Directly after FROM/JOIN, with at most a partial word typed.
    [GeneratedRegex(@"\b(?:FROM|JOIN|INTO|UPDATE)\s+[A-Za-z0-9_]*$", RegexOptions.IgnoreCase)]
    private static partial Regex ExpectsTableRx();

    /// <summary>Where the caret is, given everything before it.</summary>
    public static SqlPlace Place(string? before)
    {
        // Deliberately NOT trimmed: the space after FROM is what says the
        // table name has not been typed yet, and trimming it would make
        // "FROM " and "FROM soitem" look the same.
        var text = before ?? "";
        if (text.Trim().Length == 0) return SqlPlace.Start;

        // A statement boundary resets everything.
        var semi = text.LastIndexOf(';');
        if (semi >= 0) text = text[(semi + 1)..];
        if (text.Trim().Length == 0) return SqlPlace.Start;

        if (ExpectsTableRx().IsMatch(text)) return SqlPlace.TableName;

        var matches = ClauseRx().Matches(text);
        if (matches.Count == 0) return SqlPlace.Start;

        var last = matches[^1].Value.ToUpperInvariant();
        last = WhitespaceRx().Replace(last, " ");

        return last switch
        {
            "SELECT" => SqlPlace.SelectList,
            "FROM" or "JOIN" or "INTO" or "UPDATE" => SqlPlace.Unknown,   // past the table name
            "WHERE" or "ON" or "HAVING" or "SET" => SqlPlace.Condition,
            "GROUP BY" or "ORDER BY" => SqlPlace.ColumnList,
            _ => SqlPlace.Unknown,
        };
    }

    [GeneratedRegex(@"\s+")]
    private static partial Regex WhitespaceRx();

    /// <summary>
    /// Does a column belong here more than a keyword does?
    ///
    /// Used only for ORDER, not to exclude anything: a keyword is legal almost
    /// everywhere, and hiding one because the guess said "column" would be
    /// worse than showing it second.
    /// </summary>
    public static bool PrefersColumns(SqlPlace place) =>
        place is SqlPlace.SelectList or SqlPlace.Condition or SqlPlace.ColumnList;
}
