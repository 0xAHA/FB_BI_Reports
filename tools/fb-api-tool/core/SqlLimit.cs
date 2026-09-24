namespace FbApiTool;

/// <summary>
/// Appending a row limit to a statement on its way out.
///
/// /api/data-query has no page size of its own: it returns whatever the
/// statement selects, and a SELECT over a large table will happily hand back
/// hundreds of thousands of rows, serialise them all into one JSON body and
/// leave the window unresponsive while the grid builds. A limit is the guard,
/// and it belongs on the statement because that is the only place the server
/// will honour it.
///
/// The rule for whether it is safe to append is deliberately narrow. Rewriting
/// someone's SQL is the kind of help that becomes a bug report, so a statement
/// is only touched when there is no way the extra clause can change what it
/// means: one statement, starting with SELECT, with no LIMIT of its own.
/// Everything else is sent exactly as written.
/// </summary>
public static class SqlLimit
{
    /// <summary>
    /// May a row limit be appended to this statement without changing it?
    ///
    /// The checks, and why each one is there:
    ///
    ///   SELECT only — appending LIMIT to an INSERT or a CALL is either a
    ///     syntax error or, worse, silently valid and wrong.
    ///   One statement — "SELECT a; SELECT b" would take the limit on the
    ///     second only, which is not what anyone would expect from a setting
    ///     described as a row limit.
    ///   No LIMIT already — the user's own limit wins, always. Two LIMIT
    ///     clauses do not parse, and quietly replacing theirs is worse than
    ///     leaving it alone.
    ///
    /// Comments and string literals are stripped first, so a semicolon inside
    /// a literal or the word LIMIT inside a comment does not decide anything.
    /// </summary>
    public static bool Applies(string? sql)
    {
        var text = (sql ?? "").Trim();
        if (text.Length == 0) return false;

        var tokens = SqlHighlighter.Tokenize(text);

        var sawSelect = false;
        foreach (var t in tokens)
        {
            // Comments and literals carry no syntax, so they decide nothing.
            if (t.Kind is SqlTokenKind.Comment or SqlTokenKind.String) continue;

            if (t.Kind == SqlTokenKind.Keyword)
            {
                if (!sawSelect)
                {
                    // The first keyword has to be the SELECT itself. A WITH …
                    // SELECT is a perfectly good query but its shape is harder
                    // to be sure about, so it is left alone.
                    if (!t.Text.Equals("SELECT", StringComparison.OrdinalIgnoreCase)) return false;
                    sawSelect = true;
                    continue;
                }

                if (t.Text.Equals("LIMIT", StringComparison.OrdinalIgnoreCase)) return false;
                continue;
            }

            // A semicolon anywhere but trailing means more than one statement.
            if (t.Text.Contains(';') && !IsTrailing(text, t)) return false;

            // Anything before the SELECT that is not whitespace is not a plain
            // query — a leading bracket, a stray word, an assignment.
            if (!sawSelect && t.Text.Trim().Length > 0) return false;
        }

        return sawSelect;
    }

    /// <summary>
    /// Append the limit. Only call this when <see cref="Applies"/> said yes.
    ///
    /// A trailing semicolon is dropped rather than worked around, because
    /// "SELECT 1; LIMIT 10" does not parse and the semicolon carries nothing
    /// over a single-statement wire protocol.
    /// </summary>
    public static string Apply(string sql, int rows)
    {
        var text = (sql ?? "").TrimEnd();
        while (text.EndsWith(';')) text = text[..^1].TrimEnd();
        return text + " LIMIT " + rows;
    }

    /// <summary>Is this token the trailing semicolon at the very end?</summary>
    private static bool IsTrailing(string text, SqlToken token) =>
        text.TrimEnd().EndsWith(token.Text.TrimEnd(), StringComparison.Ordinal)
        && token.Text.TrimEnd().EndsWith(';');
}
