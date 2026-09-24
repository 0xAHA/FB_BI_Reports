using System.IO;
using System.Text.Json.Nodes;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.Templates;
using Avalonia.Input;
using Avalonia.Layout;
using Avalonia.Media;
using Avalonia.VisualTree;

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

    /// <summary>
    /// The parameter that carries a whole SQL statement, when there is one.
    ///
    /// /api/data-query documents its statement as an ordinary query parameter
    /// named "query". Rendered as one it is a single-line box, which is no way
    /// to write a join — so when it is present the right-hand column becomes
    /// an editor and this parameter stops appearing in the parameter list.
    /// </summary>
    private ApiParam? _sqlParam;

    public RequestView(RequestContext ctx, ApiEndpoint ep)
    {
        InitializeComponent();

        _ctx = ctx;
        Endpoint = ep;

        TxtMethod.Text = ep.Method.ToUpperInvariant();
        TxtMethod.Bind(TextBlock.ForegroundProperty, App.Token(Brand.InkKeyForMethod(ep.Method)));
        BadgeMethod.Bind(Border.BackgroundProperty, App.Token(Brand.FillKeyForMethod(ep.Method)));

        TxtEpDesc.Text = string.IsNullOrWhiteSpace(ep.Description)
            ? "(no description in the catalog)" : ep.Description;

        _sqlParam = ep.QueryParams.FirstOrDefault(SqlFormat.IsSqlParam);

        BuildPathParams();
        BuildQueryParams();
        BuildHeaders();
        if (ep.IsImport) SetUpImport();
        else if (_sqlParam is not null) SetUpSql();
        else SetUpBody();
        SetUpResponse();
        RefreshRights();

        BtnSend.Click += async (_, _) => await SendAsync();
        BtnAddQuery.Click += (_, _) => PanelQuery.Children.Add(Row(PanelQuery, "", "", null));
        BtnAddHeader.Click += (_, _) => PanelHeaders.Children.Add(Row(PanelHeaders, "", "", null));
        BtnRevertUrl.Click += (_, _) => RevertUrl();
        WhenTyped(TxtUrl, UrlEdited);

        MnuCopyUrl.Click += (_, _) => Copy(TxtUrl.Text ?? "", "URL");
        MnuCopyCurl.Click += (_, _) => CopyCurl();
        MnuCopyBi.Click += (_, _) => CopyBi();
        MnuPasteCurl.Click += async (_, _) => await PasteCurlAsync();
        BtnSaveRequest.Click += async (_, _) => await SaveRequestAsync();

        // Enter sends from any field; inside an editor it has to be Ctrl+Enter,
        // or a body could never contain a newline.
        AddHandler(KeyDownEvent, OnKey, Avalonia.Interactivity.RoutingStrategies.Tunnel);

        UpdateUrl();
    }

    private void OnKey(object? sender, KeyEventArgs e)
    {
        if (e.Key != Key.Enter) return;

        var focused = TopLevel.GetTopLevel(this)?.FocusManager?.GetFocusedElement();

        // AvaloniaEdit puts focus on its TextArea, which is not a TextBox, so
        // the editor has to be recognised by where the focus sits rather than
        // by what kind of control holds it. Without this, Enter in the SQL
        // editor sends the request instead of making a new line.
        var inEditor = focused is TextBox { AcceptsReturn: true }
                       || (focused as Visual)?.FindAncestorOfType<SqlEditor>() is not null;

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
                FontFamily = Brand.Mono,
                FontSize = 13,
                VerticalAlignment = VerticalAlignment.Center,
                Width = 150,
                Margin = new Avalonia.Thickness(0, 0, 8, 0),
            };
            var box = new TextBox { Tag = name, FontSize = 13 };
            WhenTyped(box, UpdateUrl);
            VarComplete.Attach(box, () => _ctx.Variables);

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

        WhenTyped(k, UpdateUrl);
        WhenTyped(v, UpdateUrl);
        VarComplete.Attach(v, () => _ctx.Variables);

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
                Foreground = Brand.Muted,
                Margin = new Avalonia.Thickness(2, 1, 0, 0),
            });
        }

        x.Click += (_, _) => { owner.Children.Remove(outer); UpdateUrl(); };
        return outer;
    }

    /// <summary>
    /// Hand the right-hand column to the SQL editor.
    ///
    /// The body pane is not just hidden but taken out of play: everything that
    /// reads a payload keys off TxtBody.IsVisible, so leaving it visible here
    /// would send an empty JSON body alongside the statement.
    /// </summary>
    private void SetUpSql()
    {
        SecBody.IsVisible = false;
        TxtBody.IsVisible = false;
        SecSql.IsVisible = true;

        TxtSql.SchemaSource = () => _ctx.Schema();
        TxtSql.VariableSource = () => _ctx.Variables;
        TxtSql.TextChanged += (_, _) => UpdateUrl();

        ChkLimit.IsChecked = Prefs.RowLimitOnOr(_ctx.Setting);
        TxtLimit.Text = Prefs.RowLimit(_ctx.Setting).ToString();
        TxtLimit.IsEnabled = ChkLimit.IsChecked == true;

        ChkLimit.IsCheckedChanged += (_, _) =>
        {
            TxtLimit.IsEnabled = ChkLimit.IsChecked == true;
            _ctx.SetSetting(Prefs.RowLimitOn, ChkLimit.IsChecked == true ? "1" : "0");
            UpdateUrl();
        };

        // Written back on every keystroke, and read back through the clamped
        // reader — so a half-typed "5" is stored but never sent as LIMIT 5
        // once it has become "500".
        WhenTyped(TxtLimit, () =>
        {
            if (int.TryParse((TxtLimit.Text ?? "").Trim(), out var n) && n >= 1)
                _ctx.SetSetting(Prefs.RowLimit_, n.ToString());
            UpdateUrl();
        });

        BtnFormatSql.Click += (_, _) => FormatSql();
        BtnCopySql.Click += (_, _) => Copy(TxtSql.Text, "Query");
        BtnClearSql.Click += (_, _) => TxtSql.Clear();

        // Completion is only worth having once the schema is known, and the
        // schema is a round trip. Asking for it now means it is there before
        // the first statement is typed rather than after it.
        _ = _ctx.LoadSchema(false);

        SetUpSaved();
    }

    private void FormatSql()
    {
        if (TxtSql.Text.Trim().Length == 0) return;
        TxtSql.Text = SqlFormat.Pretty(TxtSql.Text);
    }

    /// <summary>Put a name from the schema browser into the statement, at the caret.</summary>
    public void InsertSql(string text)
    {
        if (_sqlParam is null) return;
        TxtSql.InsertAtCaret(text);
    }

    /// <summary>Is this the parameter the editor owns?</summary>
    private bool IsSqlNamed(string? name) =>
        _sqlParam is not null && string.Equals(name, _sqlParam.Name, StringComparison.OrdinalIgnoreCase);

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

        VarComplete.Attach(TxtBody, () => _ctx.Variables);
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
        BtnCapture.Click += async (_, _) => await CaptureAsync();
        BtnSaveResp.Click += async (_, _) => await SaveResponseAsync();
    }

    // ── CAPTURE ────────────────────────────────────────────

    /// <summary>
    /// Put a value from this response into a variable.
    ///
    /// The step that turns a list of endpoints into a sequence: create an
    /// order, capture its id, address it in the next request. Copying the id
    /// across by hand works once and is wrong against any other server.
    /// </summary>
    private async Task CaptureAsync()
    {
        if (_last is null) { _ctx.Status("Run the request first — there is nothing to capture."); return; }

        var paths = Variables.Paths(_last.Body);
        if (paths.Count == 0) { _ctx.Status("Nothing in that response looks capturable."); return; }

        if (TopLevel.GetTopLevel(this) is not Window owner) return;

        var pick = await CaptureDialog.ShowAsync(owner, paths, _last.Body);
        if (pick is null) return;

        var value = Variables.Capture(_last.Body, pick.Path);
        if (value is null) { _ctx.Status("No value at " + pick.Path + "."); return; }

        _ctx.SetVariable(pick.Name, value, "captured from " + Endpoint.Name);
        _ctx.Status("{{" + pick.Name + "}} = " + Variables.Preview(value));

        if (!pick.Remember) return;

        // Re-run on every success from now on, so a sequence keeps itself up
        // to date without anyone remembering to press this again.
        _captures.RemoveAll(c => c.Variable.Equals(pick.Name, StringComparison.OrdinalIgnoreCase));
        _captures.Add(new CaptureRule { Path = pick.Path, Variable = pick.Name });
    }

    private readonly List<CaptureRule> _captures = [];

    /// <summary>Apply the standing capture rules to a fresh response.</summary>
    private void RunCaptures(ApiResult r)
    {
        if (_captures.Count == 0 || !r.Ok) return;

        var done = new List<string>();
        foreach (var rule in _captures)
        {
            var value = Variables.Capture(r.Body, rule.Path);
            if (value is null) continue;

            _ctx.SetVariable(rule.Variable, value, "captured from " + Endpoint.Name);
            done.Add("{{" + rule.Variable + "}} = " + Variables.Preview(value));
        }

        if (done.Count > 0) _ctx.Status(string.Join("  ·  ", done));
    }

    // ── SAVING THE RESPONSE ─────────────────────────────────

    /// <summary>
    /// Write the response out.
    ///
    /// Rows first when there are rows: what someone asked for when they ran a
    /// query is usually a spreadsheet, not a JSON document. The response
    /// verbatim is still one pick away.
    /// </summary>
    private async Task SaveResponseAsync()
    {
        if (_last is null || string.IsNullOrEmpty(_last.Body)) { _ctx.Status("Nothing to save."); return; }
        if (TopLevel.GetTopLevel(this) is not TopLevel top) return;

        var json = _last.IsJson;
        var (columns, rows) = json ? ApiRunner.Tabulate(_last.Body) : ([], []);
        var tabular = rows.Count > 0 && columns.Count > 0;

        var types = new List<Avalonia.Platform.Storage.FilePickerFileType>();
        if (tabular)
            types.Add(new("CSV for a spreadsheet") { Patterns = ["*.csv"] });
        if (json)
            types.Add(new("JSON") { Patterns = ["*.json"] });
        types.Add(new("Text") { Patterns = ["*.txt"] });
        types.Add(new("All files") { Patterns = ["*"] });

        var file = await top.StorageProvider.SaveFilePickerAsync(new()
        {
            Title = "Save response",
            SuggestedFileName = ResultExport.SuggestName(Endpoint.Name, tabular ? "csv" : json ? "json" : "txt"),
            DefaultExtension = tabular ? "csv" : json ? "json" : "txt",
            FileTypeChoices = types,
        });
        if (file is null) return;

        var path = file.Path.LocalPath;
        var asCsv = tabular && path.EndsWith(".csv", StringComparison.OrdinalIgnoreCase);

        try
        {
            if (asCsv)
            {
                // With a BOM: Excel reads a CSV without one as the system code
                // page and mangles every non-ASCII name in it.
                await File.WriteAllTextAsync(path, ResultExport.ToCsv(columns, rows),
                                             new System.Text.UTF8Encoding(true));
                _ctx.Status("Saved " + rows.Count + " row(s) as CSV — " + path);
            }
            else
            {
                await File.WriteAllTextAsync(path, _last.Body);
                _ctx.Status("Saved " + path);
            }
        }
        catch (Exception ex) { _ctx.Status("Could not save: " + ex.Message); }
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
        Replace(PanelQuery, saved.Query.Where(p => !IsSqlNamed(p.Name)).Select(p => (p.Name, p.Value)));
        Replace(PanelHeaders, saved.Headers.Select(p => (p.Name, p.Value)));

        if (saved.Query.FirstOrDefault(p => IsSqlNamed(p.Name)) is { } sql) TxtSql.Text = sql.Value;

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

        Replace(PanelQuery, query.Where(p => !IsSqlNamed(p.Key)).Select(p => (p.Key, p.Value)));
        if (_sqlParam is not null && query.FirstOrDefault(p => IsSqlNamed(p.Key)) is { Key: not null } sql)
            TxtSql.Text = sql.Value;
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

    /// <summary>
    /// The last URL this pane wrote into the box.
    ///
    /// Telling our own write apart from the user's used to be a flag raised
    /// around the assignment, which only works if TextChanged is raised inside
    /// it. It is not always: one write that arrived after the flag had been
    /// lowered marked the box as hand-edited, and from then on the fields
    /// silently stopped driving the URL — a path parameter typed in did
    /// nothing at all. Comparing the value cannot be beaten by event timing.
    /// </summary>
    private string _builtUrl = "";

    public void UpdateUrl()
    {
        if (_urlEdited) return;

        _builtUrl = ApiRunner.BuildUrl(_ctx.BaseUrl(), ResolvedPath(), CollectQuery());
        if (TxtUrl.Text != _builtUrl) TxtUrl.Text = _builtUrl;
    }

    private void UrlEdited()
    {
        // Our own write, arriving whenever it arrives.
        if (TxtUrl.Text == _builtUrl) return;

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
    private (string BaseUrl, string Path, List<KeyValuePair<string, string>> Query) Target()
    {
        // A hand-edited URL is sent verbatim, limit and all: whatever the box
        // says is what goes. _limitApplied is cleared so the pill does not
        // report a limit this path never appended.
        if (!_urlEdited) return (_ctx.BaseUrl(), ResolvedPath(), CollectQuery());

        _limitApplied = 0;
        var (b, p, q) = ApiRunner.SplitUrl(Fill(TxtUrl.Text), _ctx.BaseUrl());
        return (b, p, q);
    }

    /// <summary>
    /// Run something whenever a box's text actually changes.
    ///
    /// Not the TextChanged event: Avalonia can raise that before the Text
    /// property has settled, so a handler reading Text back gets the value
    /// from BEFORE the keystroke and the URL trails a character behind. The
    /// property's own observable carries the committed value, so it cannot.
    /// </summary>
    private static void WhenTyped(TextBox box, Action then) =>
        box.GetObservable(TextBox.TextProperty).Subscribe(new Sink(then));

    /// <summary>
    /// A minimal observer. Avalonia's GetObservable wants an IObserver and the
    /// Rx package is not worth taking on for three subscriptions.
    /// </summary>
    private sealed class Sink(Action then) : IObserver<string?>
    {
        public void OnNext(string? value) => then();
        public void OnCompleted() { }
        public void OnError(Exception error) { }
    }

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
        // /api/import/{name} takes its name from the picker rather than from a
        // parameter row, so it is substituted here like any other.
        if (Endpoint.IsImport && SelectedImportName() is { Length: > 0 } importName)
            path = path.Replace("{name}", Uri.EscapeDataString(importName), StringComparison.Ordinal);

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

        // The statement is a query parameter too — just an enormous one. Adding
        // it here rather than at each call site means the URL bar, the cURL
        // line, the history entry and a saved request all carry it for free.
        if (ReferenceEquals(panel, PanelQuery) && _sqlParam is not null
            && TxtSql.Text.Trim().Length > 0)
            list.Add(new KeyValuePair<string, string>(_sqlParam.Name, TxtSql.Text.Trim()));

        return list;
    }

    private List<KeyValuePair<string, string>> CollectQuery() => Filled(WithRowLimit(RawPairs(PanelQuery)));

    /// <summary>
    /// Append the row limit to the statement, when it can be appended safely.
    ///
    /// Done here rather than at send time so the URL bar, the cURL line and the
    /// history entry all show the statement that actually went to the server.
    /// A saved request is built from the raw rows instead, so it keeps the
    /// statement as it was written.
    /// </summary>
    private List<KeyValuePair<string, string>> WithRowLimit(List<KeyValuePair<string, string>> raw)
    {
        _limitApplied = 0;
        if (_sqlParam is null || ChkLimit.IsChecked != true) return raw;

        var rows = Prefs.RowLimit(_ctx.Setting);

        for (var i = 0; i < raw.Count; i++)
        {
            if (!IsSqlNamed(raw[i].Key)) continue;
            if (!SqlLimit.Applies(raw[i].Value)) break;

            _limitApplied = rows;
            raw[i] = new KeyValuePair<string, string>(raw[i].Key, SqlLimit.Apply(raw[i].Value, rows));
            break;
        }
        return raw;
    }

    /// <summary>The limit that went out with the last collection, or 0.</summary>
    private int _limitApplied;
    private List<KeyValuePair<string, string>> CollectHeaders() => Filled(RawPairs(PanelHeaders));

    private List<KeyValuePair<string, string>> Filled(List<KeyValuePair<string, string>> raw) =>
        [.. raw.Select(p => new KeyValuePair<string, string>(Fill(p.Key), Fill(p.Value)))];

    /// <summary>
    /// What the payload is sent as. An import carries rows, not an object, and
    /// the server decides how to read them from this header alone — sending
    /// CSV as application/json is accepted and then silently misparsed.
    /// </summary>
    private string ContentType => Endpoint.IsImport
        ? (JsonMode ? ImportPayload.JsonContentType : ImportPayload.CsvContentType)
        : "application/json";

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

        var payload = Endpoint.IsImport ? (TxtImport.Text ?? "")
                    : TxtBody.IsVisible ? (TxtBody.Text ?? "")
                    : "";
        var body = payload.Trim().Length > 0 ? Fill(payload) : null;

        if (Endpoint.IsImport && SelectedImportName().Length == 0)
        {
            await Tell("Choose an import type first — the server only accepts the names in that list.");
            return;
        }

        // A CSV payload is not JSON and must not be checked as though it were.
        // Invalid JSON otherwise comes back as a generic 400 that says nothing
        // useful, so say what is actually wrong before spending the round trip.
        if (body is not null && ContentType == "application/json")
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
                                                CollectHeaders(), body, ContentType, _ctx.Token());
            Log.Info(Endpoint.Method + " " + path + " -> " + r.Status + " in " + r.Millis + " ms");

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
            Log.Error("send failed: " + Endpoint.Method + " " + path, ex);
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
        ChipStatus.Bind(Border.BackgroundProperty, App.Token(r.Ok ? "AccSage" : "AccMaroonBg"));
        TxtStatusCode.Bind(TextBlock.ForegroundProperty, App.Token(r.Ok ? "FbSuccess" : "FbNegative"));

        TxtTiming.Text = r.Millis + " ms  ·  " + Size(r.Body) +
                         (r.IsJson ? "  ·  JSON" : "");

        TxtRaw.Text = r.Body;
        TxtPretty.Text = r.IsJson ? ApiRunner.Pretty(r.Body) : r.Body;

        GridHeaders.ItemsSource = r.ResponseHeaders
            .Select(h => new HeaderRow(h.Key, h.Value)).ToList();

        ShowTable(r);
        ShowLimitNote(r);
        RunCaptures(r);
        KeepRun(r);

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

    /// <summary>
    /// Say whether the limit bit.
    ///
    /// A result that stopped exactly at the limit is the one case that matters:
    /// it looks like a complete answer and is not. Below the limit the query
    /// simply finished, and saying so in amber would train people to ignore the
    /// pill on the occasion it means something.
    /// </summary>
    private void ShowLimitNote(ApiResult r)
    {
        if (_limitApplied <= 0 || !r.Ok) { ChipLimit.IsVisible = false; return; }

        var rows = GridRows.ItemsSource?.Cast<object>().Count() ?? 0;
        var hit = rows >= _limitApplied;

        ChipLimit.IsVisible = true;
        ChipLimit.Bind(Border.BackgroundProperty, App.Token(hit ? "AccYellowBg" : "FbTint"));
        TxtLimitNote.Bind(TextBlock.ForegroundProperty, App.Token(hit ? "FbAmber" : "FbBlueAccent"));
        TxtLimitNote.Text = hit
            ? "LIMIT " + _limitApplied + " reached — there are probably more rows"
            : "LIMIT " + _limitApplied + " — not reached";

        ToolTip.SetTip(ChipLimit, hit
            ? "The statement returned as many rows as the limit allowed, so this is very likely a partial "
              + "answer. Raise the limit, or narrow the query."
            : "A row limit was appended to this statement, but the result came in under it, so nothing was "
              + "cut off.");
    }

    private void ShowTable(ApiResult r)
    {
        GridRows.Columns.Clear();
        GridRows.ItemsSource = null;
        if (!r.IsJson) return;

        var table = ApiRunner.Tabulate(r.Body);
        if (table.Columns.Count == 0) return;

        FillGrid(table.Columns, table.Rows);
    }

    /// <summary>
    /// Put a set of rows in the grid.
    ///
    /// Separate from ShowTable because three things fill this grid — a fresh
    /// response, a result read back off disk, and a comparison between the two
    /// — and only the first of them has an ApiResult to hand.
    /// </summary>
    private void FillGrid(List<string> columns, List<Dictionary<string, string>> rows)
    {
        GridRows.Columns.Clear();
        GridRows.ItemsSource = null;

        foreach (var name in columns)
        {
            var column = name;   // captured per column, not per loop variable

            if (CellStyle.IsPillColumn(column, rows.Select(row => Cell(row, column))))
            {
                GridRows.Columns.Add(PillColumn(column));
                continue;
            }

            GridRows.Columns.Add(new DataGridTextColumn
            {
                Header = column,
                // Indexed into the row dictionary by column name: the rows are
                // shaped by whatever the response had, so there is nothing to
                // bind a property path to.
                Binding = new Avalonia.Data.Binding("[" + column + "]"),
            });
        }
        GridRows.ItemsSource = rows;
    }

    /// <summary>One cell out of a row, whatever shape the row turned out to be.</summary>
    private static string Cell(object? row, string column) =>
        row is IDictionary<string, string> d && d.TryGetValue(column, out var v) ? v : "";

    /// <summary>
    /// A column of states, drawn as pills.
    ///
    /// A template column rather than a text one, which costs the sorting a
    /// bound column gets for free — hence the explicit comparer. It sorts on
    /// the text, not on the tone: a user clicking a status header is looking
    /// for all the Voids together, not for the reds together.
    /// </summary>
    private static DataGridColumn PillColumn(string column) => new DataGridTemplateColumn
    {
        Header = column,
        IsReadOnly = true,
        SortMemberPath = column,
        CustomSortComparer = Comparer<object?>.Create((a, b) =>
            string.Compare(Cell(a, column), Cell(b, column), StringComparison.OrdinalIgnoreCase)),
        CellTemplate = new FuncDataTemplate<object?>((row, _) => Pill(Cell(row, column), column), true),
    };

    /// <summary>
    /// The pill itself, or plain text when the value has no tone — a blank
    /// cell stays blank rather than becoming an empty coloured box.
    /// </summary>
    private static Control Pill(string value, string column)
    {
        var tone = CellStyle.For(column, value);
        if (tone == ValueTone.None)
            return new TextBlock
            {
                Text = value,
                VerticalAlignment = VerticalAlignment.Center,
                Margin = new Avalonia.Thickness(4, 0),
            };

        var (inkKey, fillKey) = Brand.KeysForTone(tone);

        var text = new TextBlock
        {
            Text = value,
            FontSize = 11.5,
            FontWeight = FontWeight.SemiBold,
        };
        text.Bind(TextBlock.ForegroundProperty, App.Token(inkKey));

        var pill = new Border
        {
            CornerRadius = new Avalonia.CornerRadius(3),
            Padding = new Avalonia.Thickness(7, 1),
            Margin = new Avalonia.Thickness(4, 2),
            HorizontalAlignment = HorizontalAlignment.Left,
            VerticalAlignment = VerticalAlignment.Center,
            Child = text,
        };
        pill.Bind(Border.BackgroundProperty, App.Token(fillKey));

        return pill;
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
            _ => Brand.Bg2,
        };
        TxtRight.Foreground = check.Held switch
        {
            true => Brand.Success,
            false => Brand.Negative,
            _ => Brand.Sub,
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

    private async Task<bool> Confirm(string title, string message)
    {
        if (TopLevel.GetTopLevel(this) is not Window w) return false;
        return await Dialogs.ConfirmAsync(w, title, message, "Delete", "Keep it");
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
