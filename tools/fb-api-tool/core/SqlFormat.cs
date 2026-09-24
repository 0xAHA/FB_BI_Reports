using System.Text;

namespace FbApiTool;

/// <summary>
/// Tidying for the <c>/api/data-query</c> editor.
///
/// Works on the lexer's tokens rather than on the raw text, which is what makes
/// it safe: a regex pass over the whole statement would happily uppercase a
/// keyword inside a string literal, or break a line inside a comment, and
/// silently change what the query matches. Here a literal or a comment is a
/// single token and is copied through untouched.
///
/// What it does is deliberately limited — uppercase the reserved words, put
/// each clause on its own line, tidy the spacing. That is the common ground
/// between sqlfluff, sql-formatter and every other linter worth copying;
/// anything further (aligning columns, deciding where a long select list should
/// wrap) needs a real parser and gets it wrong often enough to be worse than
/// doing nothing.
/// </summary>
public static class SqlFormat
{
    /// <summary>
    /// Words that start a new line. Longest match wins, so "LEFT OUTER JOIN"
    /// beats "LEFT JOIN" and "UNION ALL" beats "UNION".
    /// </summary>
    private static readonly string[][] Clauses =
    [
        ["LEFT", "OUTER", "JOIN"], ["RIGHT", "OUTER", "JOIN"], ["FULL", "OUTER", "JOIN"],
        ["INSERT", "INTO"], ["DELETE", "FROM"], ["UNION", "ALL"], ["GROUP", "BY"], ["ORDER", "BY"],
        ["LEFT", "JOIN"], ["RIGHT", "JOIN"], ["INNER", "JOIN"], ["OUTER", "JOIN"],
        ["FULL", "JOIN"], ["CROSS", "JOIN"],
        ["SELECT"], ["FROM"], ["WHERE"], ["HAVING"], ["LIMIT"], ["OFFSET"], ["UNION"],
        ["INTERSECT"], ["EXCEPT"], ["JOIN"], ["VALUES"], ["UPDATE"], ["SET"], ["WITH"],
    ];

    /// <summary>Indented under the condition they extend, rather than starting a clause.</summary>
    private static readonly HashSet<string> Continuations = new(StringComparer.OrdinalIgnoreCase)
    {
        // ON belongs to the JOIN above it rather than starting something of
        // its own, and indenting it says so: a list of joins reads as pairs
        // instead of as twice as many clauses.
        "AND", "OR", "ON", "USING",
    };

    /// <summary>
    /// Clauses whose body is a comma-separated list.
    ///
    /// These break after the keyword so that EVERY item is indented on its own
    /// line, the first included. Leaving the first one up beside SELECT makes
    /// it read as more important than the rest, and means adding a column
    /// changes two lines in a diff rather than one.
    /// </summary>
    private static readonly HashSet<string> ListClauses = new(StringComparer.OrdinalIgnoreCase)
    {
        "SELECT", "GROUP BY", "ORDER BY", "SET", "VALUES",
    };

    /// <summary>
    /// Keywords that are called rather than declared. They bind straight onto
    /// their bracket — COUNT(*), not COUNT (*) — while a clause keyword keeps
    /// the space, as in WHERE (a = 1). Every formatter draws the line here.
    /// </summary>
    private static readonly HashSet<string> Functions = new(StringComparer.OrdinalIgnoreCase)
    {
        "COUNT", "SUM", "AVG", "MIN", "MAX", "COALESCE", "ISNULL", "NULLIF", "CAST", "CONVERT",
        "UPPER", "LOWER", "TRIM", "SUBSTRING", "LEN", "LENGTH", "REPLACE", "CONCAT", "GETDATE",
        "NOW", "DATE", "YEAR", "MONTH", "DAY",
    };

    /// <summary>
    /// Uppercase the reserved words, break the clauses onto their own lines and
    /// normalise the spacing.
    /// </summary>
    public static string Pretty(string sql)
    {
        if (string.IsNullOrWhiteSpace(sql)) return "";

        // Significant tokens only; the lexer's whitespace runs are rebuilt.
        var tokens = SqlHighlighter.Tokenize(sql)
            .SelectMany(Split)
            .Where(t => t.Text.Trim().Length > 0)
            .ToList();
        if (tokens.Count == 0) return "";

        var sb = new StringBuilder();
        var atLineStart = true;
        SqlToken? prev = null;

        // How deep in brackets the cursor is, so a comma can be told apart from
        // a comma. One separating select columns starts a new line; one inside
        // COALESCE(a, b) is part of a single expression and must not.
        var depth = 0;

        for (var i = 0; i < tokens.Count; i++)
        {
            var t = tokens[i];
            var text = t.Kind == SqlTokenKind.Keyword ? t.Text.ToUpperInvariant() : t.Text;

            // A comment keeps its own line. Appending it to one would swallow
            // everything after it the next time the statement is read.
            if (t.Kind == SqlTokenKind.Comment)
            {
                if (!atLineStart) sb.Append('\n');
                sb.Append(text).Append('\n');
                atLineStart = true;
                prev = t;
                continue;
            }

            if (t.Kind == SqlTokenKind.Keyword)
            {
                var run = ClauseAt(tokens, i);
                if (run > 0)
                {
                    if (!atLineStart) sb.Append('\n');
                    for (var k = 0; k < run; k++)
                    {
                        if (k > 0) sb.Append(' ');
                        sb.Append(tokens[i + k].Text.ToUpperInvariant());
                    }
                    var head = string.Join(' ', Enumerable.Range(0, run)
                                                     .Select(k => tokens[i + k].Text.ToUpperInvariant()));

                    prev = tokens[i + run - 1];
                    i += run - 1;
                    atLineStart = false;

                    // Only when there really is a list. "SELECT *" and
                    // "SELECT COUNT(*)" are one item, and pushing those onto a
                    // second line is ceremony with nothing to line up.
                    if (ListClauses.Contains(head) && HasListComma(tokens, i + 1))
                    {
                        sb.Append("\n  ");
                        atLineStart = true;
                    }
                    continue;
                }

                if (Continuations.Contains(t.Text))
                {
                    if (!atLineStart) sb.Append('\n');
                    sb.Append("  ").Append(text);
                    atLineStart = false;
                    prev = t;
                    continue;
                }
            }

            if (text == "(") depth++;
            else if (text == ")") depth = Math.Max(0, depth - 1);

            if (!atLineStart && NeedsSpace(sb, prev, text)) sb.Append(' ');
            sb.Append(text);
            prev = t;

            // One item per line for a comma-separated list. A twelve-column
            // SELECT on one line is a line nobody reads to the end, and this is
            // the single change that makes a wide query diffable.
            if (text == "," && depth == 0)
            {
                sb.Append("\n  ");
                atLineStart = true;
                continue;
            }

            atLineStart = false;
        }

        return string.Join('\n', sb.ToString().Split('\n').Select(l => l.TrimEnd()))
                     .Trim('\n', ' ');
    }

    /// <summary>
    /// Does the clause starting here hold more than one item?
    ///
    /// Looks for a comma before the next clause keyword, ignoring any inside
    /// brackets — a comma in COUNT(a, b) separates arguments, not columns, and
    /// treating it as a list would expand a single-column SELECT.
    /// </summary>
    private static bool HasListComma(List<SqlToken> tokens, int from)
    {
        var depth = 0;

        for (var i = from; i < tokens.Count; i++)
        {
            var text = tokens[i].Text;

            if (text == "(") { depth++; continue; }
            if (text == ")") { depth = Math.Max(0, depth - 1); continue; }
            if (depth > 0) continue;

            if (text == ",") return true;
            if (tokens[i].Kind == SqlTokenKind.Keyword && ClauseAt(tokens, i) > 0) return false;
        }
        return false;
    }

    /// <summary>
    /// How many tokens from <paramref name="i"/> form a clause, or 0 if none do.
    /// </summary>
    private static int ClauseAt(List<SqlToken> tokens, int i)
    {
        var best = 0;
        foreach (var clause in Clauses)
        {
            if (clause.Length <= best) continue;
            if (i + clause.Length > tokens.Count) continue;

            var match = true;
            for (var k = 0; k < clause.Length; k++)
            {
                if (tokens[i + k].Kind != SqlTokenKind.Keyword ||
                    !tokens[i + k].Text.Equals(clause[k], StringComparison.OrdinalIgnoreCase))
                { match = false; break; }
            }
            if (match) best = clause.Length;
        }
        return best;
    }

    /// <summary>
    /// The spacing rules every formatter agrees on: nothing before a comma or a
    /// closing bracket, nothing after an opening one, no space around a dot in
    /// a qualified name, and a call bound to its bracket.
    /// </summary>
    private static bool NeedsSpace(StringBuilder sb, SqlToken? prev, string next)
    {
        if (sb.Length == 0) return false;

        var last = sb[^1];
        if (last is '(' or '.' or '\n') return false;

        var c = next[0];
        if (c is ',' or ')' or '.' or ';') return false;

        if (c == '(' && prev is { } p &&
            (p.Kind == SqlTokenKind.Plain ||
             (p.Kind == SqlTokenKind.Keyword && Functions.Contains(p.Text))))
            return false;

        return true;
    }

    /// <summary>
    /// The lexer gathers runs of punctuation; the formatter needs them one at a
    /// time so spacing can be decided per character.
    /// </summary>
    private static IEnumerable<SqlToken> Split(SqlToken t)
    {
        if (t.Kind != SqlTokenKind.Plain) { yield return t; yield break; }

        var buf = new StringBuilder();
        foreach (var c in t.Text)
        {
            if (char.IsWhiteSpace(c))
            {
                if (buf.Length > 0) { yield return new(buf.ToString(), SqlTokenKind.Plain); buf.Clear(); }
                continue;
            }
            if (c is ',' or '(' or ')' or ';' or '.')
            {
                if (buf.Length > 0) { yield return new(buf.ToString(), SqlTokenKind.Plain); buf.Clear(); }
                yield return new(c.ToString(), SqlTokenKind.Plain);
                continue;
            }
            buf.Append(c);
        }
        if (buf.Length > 0) yield return new(buf.ToString(), SqlTokenKind.Plain);
    }

    /// <summary>
    /// Drop "--" comments and collapse runs of whitespace, leaving quoted
    /// strings exactly as they were.
    ///
    /// The string handling is the point: a comment marker or a run of spaces
    /// inside a literal is data, and squeezing it would change what the query
    /// actually matches.
    /// </summary>
    public static string StripComments(string sql)
    {
        var outp = new StringBuilder();
        // Which delimiter opened the run we are inside, or nothing. A flag was
        // not enough: it only tracked the apostrophe, so a comment marker
        // inside a "…" literal read as a real comment and the rest of the line
        // was thrown away.
        var quote = '\0';
        var pendingSpace = false;
        var i = 0;

        while (i < sql.Length)
        {
            var c = sql[i];

            if (quote != '\0')
            {
                outp.Append(c);
                if (c == quote)
                {
                    if (i + 1 < sql.Length && sql[i + 1] == quote) { outp.Append(quote); i++; }  // doubled = escape
                    else quote = '\0';
                }
                i++;
            }
            else if (c is '\'' or '"' or '`')
            {
                if (pendingSpace) { outp.Append(' '); pendingSpace = false; }
                quote = c;
                outp.Append(c);
                i++;
            }
            else if (c == '-' && i + 1 < sql.Length && sql[i + 1] == '-')
            {
                while (i < sql.Length && sql[i] != '\n') i++;      // to end of line
            }
            else if (char.IsWhiteSpace(c))
            {
                pendingSpace = true;
                i++;
            }
            else
            {
                if (pendingSpace) { outp.Append(' '); pendingSpace = false; }
                outp.Append(c);
                i++;
            }
        }
        return outp.ToString().Trim();
    }

    /// <summary>
    /// Is this the parameter that carries a SQL statement?
    ///
    /// Decided from the documentation rather than from a hard-coded path, so a
    /// catalog updated from a newer server still gets the editor: /apidocs.json
    /// describes the parameter as "query" of type string, "SQL to be run."
    /// </summary>
    public static bool IsSqlParam(ApiParam p) =>
        p.Name.Equals("query", StringComparison.OrdinalIgnoreCase) &&
        p.Description.Contains("SQL", StringComparison.OrdinalIgnoreCase);
}
