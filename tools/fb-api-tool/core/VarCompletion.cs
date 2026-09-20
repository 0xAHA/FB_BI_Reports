namespace FbApiTool;

/// <summary>One variable as the completion list shows it.</summary>
public sealed record VarSuggestion(string Name, string Preview)
{
    /// <summary>What actually goes into the field.</summary>
    public string Text => "{{" + Name + "}}";
}

/// <summary>
/// Working out what a half-typed <c>{{name}}</c> means, with no UI attached.
///
/// Separate from the popup that shows it so it can be tested: caret arithmetic
/// is exactly the kind of code that is fine in every case you thought of.
/// </summary>
public static class VarCompletion
{
    /// <summary>
    /// The placeholder the caret sits in, as (start, prefix), where start is
    /// the index of its opening brace. Null when the caret is not in one.
    /// </summary>
    public static (int Start, string Prefix)? TokenAt(string? text, int caret)
    {
        if (string.IsNullOrEmpty(text) || caret < 0 || caret > text.Length) return null;
        if (caret < 2) return null;

        var open = text.LastIndexOf("{{", caret - 1, StringComparison.Ordinal);
        if (open < 0 || open + 2 > caret) return null;

        var between = text[(open + 2)..caret];

        // A brace in between means the placeholder already ended, or another
        // one started; either way this is not an open one.
        if (between.Contains('}') || between.Contains('{')) return null;

        return (open, between);
    }

    /// <summary>
    /// Put <paramref name="name"/> into the placeholder the caret is in, and
    /// say where the caret should end up — after the closing braces, which is
    /// where the next thing gets typed.
    /// </summary>
    public static (string Text, int Caret) Insert(string text, int caret, string name)
    {
        if (TokenAt(text, caret) is not { } token) return (text, caret);

        // Whatever already follows the caret, closed or not, becomes one clean
        // pair — so accepting twice cannot leave "{{soId}}}}".
        var after = caret;
        while (after < text.Length && text[after] == '}') after++;

        var built = text[..token.Start] + "{{" + name + "}}" + text[after..];
        return (built, token.Start + name.Length + 4);
    }

    /// <summary>
    /// The variables worth offering for a prefix, in name order. A prefix that
    /// is already the one and only match is not offered back: the list would
    /// just be repeating what was typed.
    /// </summary>
    public static List<VarSuggestion> Matches(string prefix, IEnumerable<Variable> vars)
    {
        var all = vars.Where(v => v.Name.Trim().Length > 0)
                      .Select(v => new VarSuggestion(v.Name.Trim(), Variables.Preview(v.Value, 34)))
                      .Where(v => v.Name.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
                      .OrderBy(v => v.Name, StringComparer.OrdinalIgnoreCase)
                      .ToList();

        if (all.Count == 1 && all[0].Name.Equals(prefix, StringComparison.OrdinalIgnoreCase)) return [];
        return all;
    }
}
