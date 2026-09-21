using System.Text.Json.Nodes;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Layout;
using Avalonia.Media;

namespace FbApiTool.Ui;

/// <summary>
/// One open request: the form, the payload and the response it produced.
///
/// Everything is on screen at once by design. The web tool this replaces put
/// the body behind a tab, which made checking a field name against the payload
/// a click each way — so the documented fields sit beside the body, not behind
/// it.
/// </summary>
public partial class RequestView : UserControl
{
    private readonly RequestContext _ctx;
    public ApiEndpoint Endpoint { get; }

    private ApiResult? _last;

    public RequestView(RequestContext ctx, ApiEndpoint ep)
    {
        InitializeComponent();

        _ctx = ctx;
        Endpoint = ep;

        TxtMethod.Text = ep.Method.ToUpperInvariant();
        TxtMethod.Foreground = Brand.ForMethod(ep.Method);
        BadgeMethod.Background = Brand.FillForMethod(ep.Method);

        TxtEpDesc.Text = string.IsNullOrWhiteSpace(ep.Description)
            ? "(no description in the catalog)" : ep.Description;

        BuildPathParams();
        BuildQueryParams();
        BuildHeaders();
        SetUpBody();
        SetUpResponse();
        RefreshRights();

        BtnSend.Click += async (_, _) => await SendAsync();
        BtnAddQuery.Click += (_, _) => PanelQuery.Children.Add(Row(PanelQuery, "", "", null));
        BtnAddHeader.Click += (_, _) => PanelHeaders.Children.Add(Row(PanelHeaders, "", "", null));
        BtnRevertUrl.Click += (_, _) => RevertUrl();
        TxtUrl.TextChanged += (_, _) => UrlEdited();

        MnuCopyUrl.Click += (_, _) => Copy(TxtUrl.Text ?? "", "URL");
        MnuCopyCurl.Click += (_, _) => CopyCurl();
        MnuCopyBi.Click += (_, _) => CopyBi();
        BtnSaveRequest.Click += async (_, _) => await SaveRequestAsync();

        // Enter sends from any field; inside an editor it has to be Ctrl+Enter,
        // or a body could never contain a newline.
        AddHandler(KeyDownEvent, OnKey, Avalonia.Interactivity.RoutingStrategies.Tunnel);

        UpdateUrl();
    }

    private void OnKey(object? sender, KeyEventArgs e)
    {
        if (e.Key != Key.Enter) return;

        var inEditor = TopLevel.GetTopLevel(this)?.FocusManager?.GetFocusedElement()
                       is TextBox { AcceptsReturn: true };

        if (inEditor && (e.KeyModifiers & KeyModifiers.Control) == 0) return;

        e.Handled = true;
        _ = SendAsync();
    }

    // ── THE FORM ────────────────────────────────────────────────────────

    private void BuildPathParams()
    {
        if (Endpoint.PathParams.Count == 0) return;

        SecPath.IsVisible = true;
        foreach (var name in Endpoint.PathParams)
        {
            var label = new TextBlock
            {
                Text = "{" + name + "}",
                FontFamily = (FontFamily)Application.Current!.FindResource("FbMono")!,
                FontSize = 13,
                VerticalAlignment = VerticalAlignment.Center,
                Width = 150,
                Margin = new Avalonia.Thickness(0, 0, 8, 0),
            };
            var box = new TextBox { Tag = name, FontSize = 13 };
            box.TextChanged += (_, _) => UpdateUrl();

            var row = new DockPanel();
            DockPanel.SetDock(label, Dock.Left);
            row.Children.Add(label);
            row.Children.Add(box);

            PanelPath.Children.Add(row);
        }
    }

    private void BuildQueryParams()
    {
        var shown = Endpoint.QueryParams.Where(q => !SqlFormat.IsSqlParam(q)).ToList();
        foreach (var q in shown) PanelQuery.Children.Add(Row(PanelQuery, q.Name, "", q.Description));
        if (shown.Count == 0) PanelQuery.Children.Add(Row(PanelQuery, "", "", null));
    }

    private void BuildHeaders()
    {
        TxtAutoHeaders.Text = "Added for you: Authorization: Bearer …  ·  Content-Type";
        PanelHeaders.Children.Add(Row(PanelHeaders, "", "", null));
    }

    /// <summary>A key/value row with a remove button, for queries and headers.</summary>
    private Control Row(Panel owner, string key, string value, string? description)
    {
        // The gaps are the point: a key box hard against its value box reads as
        // one wide field, and a remove button hard against that reads as part
        // of it.
        var k = new TextBox
        {
            Text = key,
            FontSize = 13,
            Width = 210,
            Margin = new Avalonia.Thickness(0, 0, 8, 0),
        };
        var v = new TextBox { Text = value, FontSize = 13 };

        var x = new Button
        {
            Content = "×",
            Margin = new Avalonia.Thickness(8, 0, 0, 0),
            VerticalAlignment = VerticalAlignment.Center,
            [ToolTip.TipProperty] = "Remove",
        };
        x.Classes.Add("rowkill");

        k.TextChanged += (_, _) => UpdateUrl();
        v.TextChanged += (_, _) => UpdateUrl();

        var grid = new DockPanel { Margin = new Avalonia.Thickness(0, 0, 0, 2) };
        DockPanel.SetDock(k, Dock.Left);
        DockPanel.SetDock(x, Dock.Right);
        grid.Children.Add(k);
        grid.Children.Add(x);
        grid.Children.Add(v);

        var outer = new StackPanel { Tag = new[] { k, v } };
        outer.Children.Add(grid);

        if (!string.IsNullOrWhiteSpace(description))
        {
            k.SetValue(ToolTip.TipProperty, description);
            v.SetValue(ToolTip.TipProperty, description);
            outer.Children.Add(new TextBlock
            {
                Text = description,
                FontSize = 11.5,
                TextWrapping = TextWrapping.Wrap,
                Foreground = (IBrush)Application.Current!.FindResource("FbTextMuted")!,
                Margin = new Avalonia.Thickness(2, 1, 0, 0),
            });
        }

        x.Click += (_, _) => { owner.Children.Remove(outer); UpdateUrl(); };
        return outer;
    }

    private void SetUpBody()
    {
        var takesBody = Endpoint.BodySample is not null
                        || Endpoint.Method is "POST" or "PUT" or "PATCH";

        SecBody.IsVisible = true;
        TxtBody.Text = Endpoint.BodySample ?? "";
        TxtBody.IsVisible = takesBody;
        TxtBodyLabel.Text = takesBody ? "REQUEST BODY" : "RESPONSE FIELDS";
        TxtContentType.Text = takesBody ? "application/json" : "";

        BtnFormatBody.IsVisible = takesBody;
        BtnResetBody.IsVisible = takesBody;
        BtnCopyBody.IsVisible = takesBody;

        var fields = Endpoint.Attributes.Select(a => new FieldRow(a)).ToList();
        GridFields.ItemsSource = fields;
        GridFields.IsVisible = fields.Count > 0;

        TxtFieldCount.Text = fields.Count > 0
            ? fields.Count + (takesBody ? " DOCUMENTED FIELD" : " RESPONSE FIELD") + (fields.Count == 1 ? "" : "S")
            : (takesBody ? "REQUEST FIELDS" : "RESPONSE FIELDS");

        // There are two reasons this table is empty and they mean different
        // things: a GET with no body has nothing to document, whereas a POST
        // with nothing documented means the server published no field list for
        // it. A blank panel says neither, and reads as a broken control.
        TogFields.IsVisible = fields.Count > 0;
        TxtNoFields.IsVisible = fields.Count == 0;
        TxtNoFields.Text = fields.Count > 0 ? "" : NoFieldsReason(takesBody);

        TogFields.IsCheckedChanged += (_, _) => FoldFields(TogFields.IsChecked == true);

        BtnFormatBody.Click += (_, _) => FormatBody();
        BtnResetBody.Click += (_, _) => TxtBody.Text = Endpoint.BodySample ?? "";
        BtnCopyBody.Click += (_, _) => Copy(TxtBody.Text ?? "", "Body");
    }

    /// <summary>
    /// Fold the field reference away.
    ///
    /// The two share the right-hand column, so hiding one is only useful if
    /// the other takes the room: the body grows into it rather than leaving a
    /// gap where the table was.
    /// </summary>
    private void FoldFields(bool show)
    {
        GridFields.IsVisible = show;
        var rows = ((Grid)SecBody.Child!).RowDefinitions;
        rows[1].Height = new GridLength(show ? 2 : 1, GridUnitType.Star);
        rows[3].Height = new GridLength(show ? 3 : 0, GridUnitType.Star);
    }

    /// <summary>Why the field table has nothing in it.</summary>
    private string NoFieldsReason(bool takesBody)
    {
        if (!takesBody)
            return Endpoint.Method.ToUpperInvariant() + " sends no body, and this server's documentation "
                 + "does not list the fields it returns — send it once and the response itself is the "
                 + "reference.";

        return "This server's documentation lists no fields for this endpoint. The body above is whatever "
             + "the catalog carries; check the Documentation tab, or send it and read the error.";
    }

    private void FormatBody()
    {
        var text = TxtBody.Text ?? "";
        if (text.Trim().Length == 0) return;
        try { TxtBody.Text = ApiRunner.Pretty(text); }
        catch { _ctx.Status("That payload is not valid JSON, so it was left alone."); }
    }

    private void SetUpResponse()
    {
        foreach (var name in new[] { "Auto", "Pretty", "Table", "Raw" }) CmbView.Items.Add(name);
        CmbView.SelectedItem = _ctx.Setting(Prefs.DefaultView) ?? "Auto";
        CmbView.SelectionChanged += (_, _) =>
        {
            if (CmbView.SelectedItem is string v) _ctx.SetSetting(Prefs.DefaultView, v);
        };

        BtnCopyResp.Click += (_, _) => Copy(_last?.Body ?? "", "Response");
    }

    // ── FILLING IT IN ───────────────────────────────────────────────────

    /// <summary>
    /// Put a saved request back in the form.
    ///
    /// Restored with its {{placeholders}} intact rather than with what they
    /// resolved to when it was saved, so one saved request works against every
    /// server instead of being welded to the one it was recorded on.
    /// </summary>
    public void LoadFrom(SavedRequest saved)
    {
        Replace(PanelQuery, saved.Query.Select(p => (p.Name, p.Value)));
        Replace(PanelHeaders, saved.Headers.Select(p => (p.Name, p.Value)));

        if (saved.Body is not null && TxtBody.IsVisible) TxtBody.Text = saved.Body;

        UpdateUrl();
    }

    /// <summary>
    /// Put a past call back in the form.
    ///
    /// The path arrives with its parameters already substituted, so they are
    /// read back out of it by position against the endpoint's own template —
    /// /api/parts/42 against /api/parts/{id} gives id = 42.
    /// </summary>
    public void LoadFrom(ApiEndpoint ep, string path, List<KeyValuePair<string, string>> query, string? body)
    {
        var template = ep.Path.Split('/', StringSplitOptions.RemoveEmptyEntries);
        var actual = path.Split('/', StringSplitOptions.RemoveEmptyEntries);

        if (template.Length == actual.Length)
        {
            var values = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            for (var i = 0; i < template.Length; i++)
                if (template[i].StartsWith('{') && template[i].EndsWith('}'))
                    values[template[i][1..^1]] = Uri.UnescapeDataString(actual[i]);

            foreach (var row in PanelPath.Children.OfType<DockPanel>())
                if (row.Children.OfType<TextBox>().FirstOrDefault() is { Tag: string name } box
                    && values.TryGetValue(name, out var v))
                    box.Text = v;
        }

        Replace(PanelQuery, query.Select(p => (p.Key, p.Value)));
        if (body is not null && TxtBody.IsVisible) TxtBody.Text = body;

        UpdateUrl();
    }

    /// <summary>Swap a panel's rows for a given set, leaving one blank row to type in.</summary>
    private void Replace(Panel panel, IEnumerable<(string Key, string Value)> pairs)
    {
        panel.Children.Clear();
        foreach (var (k, v) in pairs) panel.Children.Add(Row(panel, k, v, null));
        panel.Children.Add(Row(panel, "", "", null));
    }

    // ── THE URL ─────────────────────────────────────────────────────────

    private bool _urlEdited;
    private bool _writingUrl;

    public void UpdateUrl()
    {
        if (_urlEdited) return;
        _writingUrl = true;
        TxtUrl.Text = ApiRunner.BuildUrl(_ctx.BaseUrl(), ResolvedPath(), CollectQuery());
        _writingUrl = false;
    }

    private void UrlEdited()
    {
        if (_writingUrl) return;
        _urlEdited = true;
        BtnRevertUrl.IsVisible = true;
    }

    private void RevertUrl()
    {
        _urlEdited = false;
        BtnRevertUrl.IsVisible = false;
        UpdateUrl();
        _ctx.Status("URL back to what the fields build.");
    }

    /// <summary>What to actually send: the form's pieces, or the typed URL.</summary>
    private (string BaseUrl, string Path, List<KeyValuePair<string, string>> Query) Target() =>
        _urlEdited
            ? ApiRunner.SplitUrl(Fill(TxtUrl.Text), _ctx.BaseUrl())
            : (_ctx.BaseUrl(), ResolvedPath(), CollectQuery());

    private string ResolvedPath()
    {
        var path = Endpoint.Path;

        // Expanded first, then escaped: a variable holding "A B" has to reach
        // the URL as A%20B, and escaping the placeholder itself would send
        // %7B%7BpartId%7D%7D.
        foreach (var row in PanelPath.Children.OfType<DockPanel>())
        {
            if (row.Children.OfType<TextBox>().FirstOrDefault() is not { Tag: string name } box) continue;
            var value = Fill(box.Text);
            if (value.Length > 0)
                path = path.Replace("{" + name + "}", Uri.EscapeDataString(value), StringComparison.Ordinal);
        }
        return path;
    }

    private List<KeyValuePair<string, string>> RawPairs(Panel panel)
    {
        var list = new List<KeyValuePair<string, string>>();
        foreach (var row in panel.Children.OfType<StackPanel>())
        {
            if (row.Tag is not TextBox[] { Length: 2 } pair) continue;
            var k = (pair[0].Text ?? "").Trim();
            if (k.Length > 0 && !string.IsNullOrEmpty(pair[1].Text))
                list.Add(new KeyValuePair<string, string>(k, pair[1].Text!));
        }
        return list;
    }

    private List<KeyValuePair<string, string>> CollectQuery() => Filled(RawPairs(PanelQuery));
    private List<KeyValuePair<string, string>> CollectHeaders() => Filled(RawPairs(PanelHeaders));

    private List<KeyValuePair<string, string>> Filled(List<KeyValuePair<string, string>> raw) =>
        [.. raw.Select(p => new KeyValuePair<string, string>(Fill(p.Key), Fill(p.Value)))];

    private Dictionary<string, string> Vars => Variables.ToMap(_ctx.Variables);
    private string Fill(string? text) => Variables.Expand(text, Vars);

    // ── SENDING ─────────────────────────────────────────────────────────

    private async Task SendAsync()
    {
        var (baseUrl, path, query) = Target();

        if (path.Contains('{'))
        {
            var missing = System.Text.RegularExpressions.Regex
                .Matches(path, @"\{([A-Za-z0-9_]+)\}").Select(m => m.Groups[1].Value);
            await Tell("Fill in: " + string.Join(", ", missing));
            return;
        }

        // An unresolved {{name}} would travel to the server as literal braces
        // and come back as a puzzling 400 or an empty result.
        if (MissingVariables() is { Count: > 0 } unset)
        {
            await Tell("These variables have no value yet:\n\n  " +
                       string.Join("\n  ", unset.Select(m => "{{" + m + "}}")) +
                       "\n\nSet them in the Variables panel, or capture them from a response.");
            return;
        }

        if (Endpoint.RequiresAuth && string.IsNullOrEmpty(_ctx.Token()))
        {
            await Tell("This endpoint needs a token. Connect first.");
            return;
        }

        var payload = TxtBody.IsVisible ? (TxtBody.Text ?? "") : "";
        var body = payload.Trim().Length > 0 ? Fill(payload) : null;

        // Invalid JSON comes back as a generic 400 that says nothing useful, so
        // say what is actually wrong before spending the round trip.
        if (body is not null)
        {
            try { JsonNode.Parse(body); }
            catch (System.Text.Json.JsonException jx)
            {
                await Tell("The payload is not valid JSON:\n\n" + jx.Message);
                return;
            }
        }

        if (!await _ctx.ConfirmSend(Endpoint.Method, ApiRunner.BuildUrl(baseUrl, path, query))) return;

        BtnSend.IsEnabled = false;
        BtnSend.Content = "Sending…";
        _ctx.Status(Endpoint.Method + " " + path + " …");

        try
        {
            var r = await _ctx.Runner.SendAsync(baseUrl, Endpoint.Method, path, query,
                                                CollectHeaders(), body, "application/json", _ctx.Token());
            Show(r);
            _ctx.Record(new HistoryEntry
            {
                Method = Endpoint.Method,
                Url = ApiRunner.BuildUrl(baseUrl, path, query),
                Body = body,
                Status = r.Status,
            });
        }
        catch (Exception ex)
        {
            _ctx.Status("Send failed: " + ex.Message);
            await Tell("The request could not be sent.\n\n" + ex.Message);
        }
        finally
        {
            BtnSend.IsEnabled = true;
            BtnSend.Content = "Send";
        }
    }

    private List<string> MissingVariables()
    {
        var values = Vars;
        var names = new List<string>();

        void Scan(string? t)
        {
            foreach (var n in Variables.Unresolved(t, values))
                if (!names.Contains(n, StringComparer.OrdinalIgnoreCase)) names.Add(n);
        }

        foreach (var p in RawPairs(PanelQuery)) { Scan(p.Key); Scan(p.Value); }
        foreach (var h in RawPairs(PanelHeaders)) { Scan(h.Key); Scan(h.Value); }
        Scan(TxtBody.Text);
        return names;
    }

    // ── THE RESPONSE ────────────────────────────────────────────────────

    private void Show(ApiResult r)
    {
        _last = r;

        ChipStatus.IsVisible = true;
        TxtStatusCode.Text = r.Status + " " + r.Reason;
        ChipStatus.Background = r.Ok ? Brand.Sage : Brand.Maroon;
        TxtStatusCode.Foreground = r.Ok ? Brand.Success : Brand.Negative;

        TxtTiming.Text = r.Millis + " ms  ·  " + Size(r.Body) +
                         (r.IsJson ? "  ·  JSON" : "");

        TxtRaw.Text = r.Body;
        TxtPretty.Text = r.IsJson ? ApiRunner.Pretty(r.Body) : r.Body;

        GridHeaders.ItemsSource = r.ResponseHeaders
            .Select(h => new HeaderRow(h.Key, h.Value)).ToList();

        ShowTable(r);

        Views.SelectedIndex = OpenOn(r);
        _ctx.Status(Endpoint.Method + " " + Endpoint.Path + " — " + r.Status + " in " + r.Millis + " ms");
    }

    /// <summary>
    /// Which view a response opens on. Auto means the table when there are
    /// rows to put in it, because that is the shape a data query has.
    /// </summary>
    private int OpenOn(ApiResult r)
    {
        var pref = CmbView.SelectedItem as string ?? "Auto";
        if (pref == "Pretty") return 0;
        if (pref == "Raw") return 1;
        if (pref == "Table") return 2;
        return GridRows.ItemsSource is not null && GridRows.Columns.Count > 0 ? 2 : 0;
    }

    private void ShowTable(ApiResult r)
    {
        GridRows.Columns.Clear();
        GridRows.ItemsSource = null;
        if (!r.IsJson) return;

        var table = ApiRunner.Tabulate(r.Body);
        if (table.Columns.Count == 0) return;

        foreach (var name in table.Columns)
        {
            GridRows.Columns.Add(new DataGridTextColumn
            {
                Header = name,
                // Indexed into the row dictionary by column name: the rows are
                // shaped by whatever the response had, so there is nothing to
                // bind a property path to.
                Binding = new Avalonia.Data.Binding("[" + name + "]"),
            });
        }
        GridRows.ItemsSource = table.Rows;
    }

    private static string Size(string body)
    {
        var bytes = System.Text.Encoding.UTF8.GetByteCount(body ?? "");
        return bytes < 1024 ? bytes + " B" : (bytes / 1024.0).ToString("0.#") + " KB";
    }

    // ── ACCESS RIGHT ────────────────────────────────────────────────────

    /// <summary>
    /// Recheck the right this endpoint documents.
    ///
    /// Called whenever the connection changes, because it answers a question
    /// about whoever is signed in NOW — a chip worked out once at construction
    /// went on answering about nobody.
    /// </summary>
    public void RefreshRights()
    {
        var check = AccessRights.For(Endpoint, _ctx.Rights());
        if (check is null) { ChipRight.IsVisible = false; return; }

        ChipRight.IsVisible = true;
        TxtRight.Text = check.Label;
        ChipRight.Background = check.Held switch
        {
            true => Brand.Sage,
            false => Brand.Maroon,
            _ => (IBrush)Application.Current!.FindResource("FbBg2")!,
        };
        TxtRight.Foreground = check.Held switch
        {
            true => Brand.Success,
            false => Brand.Negative,
            _ => (IBrush)Application.Current!.FindResource("FbTextSub")!,
        };
    }

    // ── SMALL THINGS ────────────────────────────────────────────────────

    private async void CopyCurl()
    {
        var (baseUrl, path, query) = Target();
        // The token is ALWAYS replaced: a cURL command goes into a ticket.
        await CopyText(CurlFormat.ToCurl(Endpoint.Method, ApiRunner.BuildUrl(baseUrl, path, query),
                                         CollectHeaders(), TxtBody.IsVisible ? Fill(TxtBody.Text) : null,
                                         "application/json",
                                         authenticated: !string.IsNullOrEmpty(_ctx.Token())),
                       "cURL");
    }

    private async void CopyBi()
    {
        var (_, path, query) = Target();
        await CopyText(CurlFormat.ToRunRestApiAsync(Endpoint.Method, path, query,
                                                    TxtBody.IsVisible ? Fill(TxtBody.Text) : null,
                                                    "application/json"),
                       "runRestApiAsync call");
    }

    private async void Copy(string text, string what) => await CopyText(text, what);

    private async Task CopyText(string text, string what)
    {
        var clip = TopLevel.GetTopLevel(this)?.Clipboard;
        if (clip is null) return;

        // Avalonia 12 replaced DataObject/SetDataObjectAsync with DataTransfer.
        using var transfer = new DataTransfer();
        transfer.Add(DataTransferItem.CreateText(text));
        await clip.SetDataAsync(transfer);

        _ctx.Status(what + " copied.");
    }

    private async Task SaveRequestAsync()
    {
        var name = await _ctx.Ask("Save request", "A name for this request:", Endpoint.Name);
        if (string.IsNullOrWhiteSpace(name)) return;

        _ctx.Store(new SavedRequest
        {
            Id = Guid.NewGuid().ToString("N")[..8],
            Name = name.Trim(),
            EndpointId = Endpoint.Id,
            Method = Endpoint.Method,
            Path = Endpoint.Path,
            ContentType = "application/json",
            Body = TxtBody.IsVisible ? TxtBody.Text : null,
            Query = [.. RawPairs(PanelQuery).Select(ToNameValue)],
            Headers = [.. RawPairs(PanelHeaders).Select(ToNameValue)],
        });
        _ctx.Status("Saved “" + name.Trim() + "”.");
    }

    private static NameValue ToNameValue(KeyValuePair<string, string> p) =>
        new() { Name = p.Key, Value = p.Value };

    private async Task Tell(string message)
    {
        if (TopLevel.GetTopLevel(this) is Window w)
            await Dialogs.TellAsync(w, "Fishbowl API Tool", message);
    }
}

/// <summary>
/// One response header. A named pair rather than a KeyValuePair, because XAML
/// cannot name a generic type without ceremony and the grid has to be told
/// what it is binding against.
/// </summary>
public sealed record HeaderRow(string Key, string Value);

/// <summary>One documented field, as the reference table shows it.</summary>
public sealed class FieldRow(ApiAttr a)
{
    public string Name { get; } = a.Name;
    public string Type { get; } = a.Type;
    public string Description { get; } = a.Description;
    public string RequiredLabel { get; } = a.Optional ? "" : "required";
}
