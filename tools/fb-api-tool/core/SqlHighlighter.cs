namespace FbApiTool;

public enum SqlTokenKind
{
    Plain,
    Keyword,
    String,
    Number,
    Comment,
}

/// <summary>A run of characters that should be coloured together.</summary>
public readonly record struct SqlToken(string Text, SqlTokenKind Kind);

/// <summary>
/// Splits a statement into coloured runs.
///
/// A lexer, not a parser: it recognises comments, quoted literals, keywords and
/// numbers, and leaves everything else alone. That is all syntax colouring
/// needs, and it means an unfinished statement — which is what an editor holds
/// most of the time — still colours sensibly instead of failing to parse.
/// </summary>
public static class SqlHighlighter
{
    /// <summary>
    /// The keyword set from the tool this was ported from, so the same words
    /// light up in both. Matched case-insensitively.
    /// </summary>
    public static readonly HashSet<string> Keywords = new(StringComparer.OrdinalIgnoreCase)
    {
        "SELECT","FROM","WHERE","AND","OR","NOT","IN","IS","NULL","LIKE","BETWEEN","EXISTS",
        "CASE","WHEN","THEN","ELSE","END","IF","GROUP","BY","ORDER","HAVING","LIMIT","OFFSET",
        "DISTINCT","UNION","ALL","INTERSECT","EXCEPT","JOIN","LEFT","RIGHT","INNER","OUTER",
        "FULL","CROSS","ON","USING","INSERT","UPDATE","DELETE","INTO","VALUES","SET","CREATE",
        "DROP","ALTER","TABLE","VIEW","INDEX","DATABASE","SCHEMA","AS","WITH","TOP","FETCH",
        "NEXT","ROWS","ONLY","FOR","OVER","PARTITION","WINDOW","RECURSIVE","COUNT","SUM","AVG",
        "MIN","MAX","COALESCE","ISNULL","NULLIF","CAST","CONVERT","UPPER","LOWER","TRIM",
        "SUBSTRING","LEN","LENGTH","REPLACE","CONCAT","GETDATE","NOW","DATE","YEAR","MONTH",
        "DAY","PRIMARY","KEY","FOREIGN","REFERENCES","CONSTRAINT","DEFAULT","UNIQUE","TRUE",
        "FALSE","ASC","DESC",
    };

    public static List<SqlToken> Tokenize(string sql)
    {
        var tokens = new List<SqlToken>();
        if (string.IsNullOrEmpty(sql)) return tokens;

        var i = 0;
        while (i < sql.Length)
        {
            var c = sql[i];

            // -- to end of line
            if (c == '-' && i + 1 < sql.Length && sql[i + 1] == '-')
            {
                var end = sql.IndexOf('\n', i);
                var text = end < 0 ? sql[i..] : sql[i..end];
                tokens.Add(new(text, SqlTokenKind.Comment));
                i += text.Length;
                continue;
            }

            // /* … */, possibly unterminated while it is being typed
            if (c == '/' && i + 1 < sql.Length && sql[i + 1] == '*')
            {
                var end = sql.IndexOf("*/", i + 2, StringComparison.Ordinal);
                var text = end < 0 ? sql[i..] : sql[i..(end + 2)];
                tokens.Add(new(text, SqlTokenKind.Comment));
                i += text.Length;
                continue;
            }

            // '…', with '' as the escape
            if (c == '\'')
            {
                var j = i + 1;
                while (j < sql.Length)
                {
                    if (sql[j] == '\'')
                    {
                        if (j + 1 < sql.Length && sql[j + 1] == '\'') { j += 2; continue; }
                        j++;
                        break;
                    }
                    j++;
                }
                tokens.Add(new(sql[i..Math.Min(j, sql.Length)], SqlTokenKind.String));
                i = j;
                continue;
            }

            if (char.IsLetter(c) || c == '_')
            {
                var j = i;
                while (j < sql.Length && (char.IsLetterOrDigit(sql[j]) || sql[j] == '_')) j++;
                var word = sql[i..j];
                tokens.Add(new(word, Keywords.Contains(word) ? SqlTokenKind.Keyword : SqlTokenKind.Plain));
                i = j;
                continue;
            }

            if (char.IsDigit(c))
            {
                var j = i;
                while (j < sql.Length && (char.IsDigit(sql[j]) || sql[j] == '.')) j++;
                tokens.Add(new(sql[i..j], SqlTokenKind.Number));
                i = j;
                continue;
            }

            // Whitespace and punctuation, gathered so the run count stays low.
            var k = i;
            while (k < sql.Length && !char.IsLetterOrDigit(sql[k]) && sql[k] != '_' && sql[k] != '\''
                   && !(sql[k] == '-' && k + 1 < sql.Length && sql[k + 1] == '-')
                   && !(sql[k] == '/' && k + 1 < sql.Length && sql[k + 1] == '*')) k++;
            if (k == i) k++;                       // never stall
            tokens.Add(new(sql[i..k], SqlTokenKind.Plain));
            i = k;
        }

        return tokens;
    }
}
