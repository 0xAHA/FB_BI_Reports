namespace FbApiTool;

public enum JsonTokenKind
{
    /// <summary>Braces, brackets, commas, colons and whitespace.</summary>
    Punctuation,
    /// <summary>A quoted name on the left of a colon.</summary>
    Key,
    Text,
    Number,
    /// <summary>true — and any string value that reads as good news.</summary>
    True,
    /// <summary>false — and any string value that reads as bad news.</summary>
    False,
    Null,
}

public readonly record struct JsonToken(string Text, JsonTokenKind Kind);

/// <summary>
/// Splits pretty-printed JSON into coloured runs.
///
/// Works on the text rather than on a parsed document so that a truncated or
/// malformed response still colours — which is exactly when someone is staring
/// at it. A key is told from a string value by the colon that follows it.
///
/// String VALUES are also passed through <see cref="Tone"/>, so a status of
/// "Fulfilled" or "Voided" is coloured in the JSON view the same way it is in
/// the table. That is the point of doing this at all: the interesting field in
/// a 40-line order is almost always a status.
/// </summary>
public static class JsonHighlighter
{
    public static List<JsonToken> Tokenize(string json)
    {
        var tokens = new List<JsonToken>();
        if (string.IsNullOrEmpty(json)) return tokens;

        var i = 0;
        while (i < json.Length)
        {
            var c = json[i];

            if (c == '"')
            {
                var j = i + 1;
                while (j < json.Length)
                {
                    if (json[j] == '\\') { j += 2; continue; }
                    if (json[j] == '"') { j++; break; }
                    j++;
                }
                var text = json[i..Math.Min(j, json.Length)];

                // A colon after it (any spacing) makes it a key.
                var k = j;
                while (k < json.Length && char.IsWhiteSpace(json[k])) k++;
                var isKey = k < json.Length && json[k] == ':';

                tokens.Add(new(text, isKey ? JsonTokenKind.Key : ToneOf(text)));
                i = j;
                continue;
            }

            if (c == '-' || char.IsDigit(c))
            {
                var j = i;
                if (json[j] == '-') j++;
                while (j < json.Length && (char.IsDigit(json[j]) || json[j] is '.' or 'e' or 'E' or '+' or '-')) j++;
                tokens.Add(new(json[i..j], JsonTokenKind.Number));
                i = j;
                continue;
            }

            if (Word(json, i, "true")) { tokens.Add(new("true", JsonTokenKind.True)); i += 4; continue; }
            if (Word(json, i, "false")) { tokens.Add(new("false", JsonTokenKind.False)); i += 5; continue; }
            if (Word(json, i, "null")) { tokens.Add(new("null", JsonTokenKind.Null)); i += 4; continue; }

            // Everything else, gathered so the run count stays low.
            var p = i;
            while (p < json.Length && json[p] != '"' && json[p] != '-' && !char.IsDigit(json[p])
                   && !Word(json, p, "true") && !Word(json, p, "false") && !Word(json, p, "null")) p++;
            if (p == i) p++;                       // never stall
            tokens.Add(new(json[i..p], JsonTokenKind.Punctuation));
            i = p;
        }

        return tokens;
    }

    /// <summary>A recognised status string is coloured by meaning, not as plain text.</summary>
    private static JsonTokenKind ToneOf(string quoted)
    {
        var inner = quoted.Length >= 2 ? quoted[1..^1] : quoted;
        return Tone.Classify(inner) switch
        {
            ValueTone.Positive => JsonTokenKind.True,
            ValueTone.Negative => JsonTokenKind.False,
            _ => JsonTokenKind.Text,
        };
    }

    /// <summary>A literal at this position, not part of a longer word.</summary>
    private static bool Word(string s, int at, string word)
    {
        if (at + word.Length > s.Length) return false;
        if (string.CompareOrdinal(s, at, word, 0, word.Length) != 0) return false;
        var after = at + word.Length;
        return after >= s.Length || !char.IsLetterOrDigit(s[after]);
    }
}
