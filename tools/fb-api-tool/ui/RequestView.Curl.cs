using Avalonia.Controls;
using Avalonia.Input;

namespace FbApiTool.Ui;

/// <summary>
/// Filling the form in from a cURL command.
///
/// cURL is how an API problem is actually reported: a colleague pastes the
/// command they ran, or a ticket carries the one that failed. Reading it back
/// turns that paste into a request you can edit and send, rather than
/// something you transcribe field by field and get subtly wrong.
/// </summary>
public partial class RequestView
{
    private async Task PasteCurlAsync()
    {
        if (TopLevel.GetTopLevel(this) is not TopLevel top) return;

        string? text;
        try
        {
            // Avalonia 12 reads the clipboard as a DataTransfer of typed
            // formats, the same shape a drop arrives in.
            using var held = await top.Clipboard!.TryGetDataAsync();
            text = held is null ? null : await held.TryGetTextAsync();
        }
        catch (Exception ex) { _ctx.Status("Could not read the clipboard: " + ex.Message); return; }

        if (CurlFormat.Parse(text) is not { } curl)
        {
            await Tell("The clipboard does not hold a cURL command.\n\nCopy one — from a colleague, a "
                     + "ticket, or a browser's Copy as cURL — and try again.");
            return;
        }

        // Not refused, only noted. Pasting a POST into a GET tab is usually a
        // mistake, but it is also how someone compares two shapes of the same
        // call, and the form is still worth filling in.
        if (!curl.Method.Equals(Endpoint.Method, StringComparison.OrdinalIgnoreCase))
            _ctx.Status("Note: that command is a " + curl.Method
                      + ", and this endpoint is a " + Endpoint.Method + ".");

        Uri uri;
        try { uri = new Uri(curl.Url); }
        catch { _ctx.Status("That command's URL could not be read."); return; }

        ApplyPath(uri.AbsolutePath);
        ApplyQuery(uri.Query);

        PanelHeaders.Children.Clear();
        foreach (var h in curl.Headers)
        {
            // Authorization comes from the connection, and a pasted one is a
            // placeholder or somebody else's session either way. Content-Type
            // is decided by what is being sent, not by what was sent before.
            if (h.Key.Equals("Authorization", StringComparison.OrdinalIgnoreCase)) continue;
            if (h.Key.Equals("Content-Type", StringComparison.OrdinalIgnoreCase)) continue;
            PanelHeaders.Children.Add(Row(PanelHeaders, h.Key, h.Value, null));
        }
        PanelHeaders.Children.Add(Row(PanelHeaders, "", "", null));

        if (curl.Body is not null)
        {
            if (_sqlParam is not null) TxtSql.Text = curl.Body;
            else if (Endpoint.IsImport) TxtImport.Text = curl.Body;
            else TxtBody.Text = ApiRunner.Pretty(curl.Body);
        }

        UpdateUrl();
        _ctx.Status("Filled in from the cURL command.");
    }

    /// <summary>
    /// Read the path parameters back out of a real URL, by position against
    /// the endpoint's own template: /api/parts/42 against /api/parts/{id}
    /// gives id = 42.
    /// </summary>
    private void ApplyPath(string actual)
    {
        var template = Endpoint.Path.Split('/');
        var real = actual.Split('/');
        if (template.Length != real.Length) return;

        for (var i = 0; i < template.Length; i++)
        {
            if (!template[i].StartsWith('{')) continue;

            var name = template[i].Trim('{', '}');
            var value = Uri.UnescapeDataString(real[i]);

            if (Endpoint.IsImport && name.Equals("name", StringComparison.OrdinalIgnoreCase))
            {
                CmbImportName.SelectedItem = _ctx.Catalog.ImportNames
                    .FirstOrDefault(n => n.Name.Equals(value, StringComparison.OrdinalIgnoreCase));
                continue;
            }

            foreach (var row in PanelPath.Children.OfType<DockPanel>())
                if (row.Children.OfType<TextBox>().FirstOrDefault() is { Tag: string tag } box
                    && tag == name)
                    box.Text = value;
        }
    }

    /// <summary>
    /// Put a query string back into the parameter rows.
    ///
    /// A documented parameter goes in its own row; anything else is added as a
    /// new one rather than dropped, because a parameter this catalog has not
    /// heard of is exactly the kind of thing someone pastes a command to ask
    /// about.
    /// </summary>
    private void ApplyQuery(string query)
    {
        if (string.IsNullOrWhiteSpace(query)) return;

        var sent = query.TrimStart('?')
            .Split('&', StringSplitOptions.RemoveEmptyEntries)
            .Select(p => p.Split('=', 2))
            .ToDictionary(p => Uri.UnescapeDataString(p[0]),
                          p => p.Length > 1 ? Uri.UnescapeDataString(p[1]) : "",
                          StringComparer.OrdinalIgnoreCase);

        if (_sqlParam is not null && sent.TryGetValue(_sqlParam.Name, out var sql))
        {
            TxtSql.Text = sql;
            sent.Remove(_sqlParam.Name);
        }

        foreach (var row in PanelQuery.Children.OfType<StackPanel>())
        {
            if (row.Tag is not TextBox[] { Length: 2 } pair) continue;

            var key = (pair[0].Text ?? "").Trim();
            pair[1].Text = sent.TryGetValue(key, out var v) ? v : "";
            sent.Remove(key);
        }

        foreach (var (k, v) in sent) PanelQuery.Children.Add(Row(PanelQuery, k, v, null));
    }
}
