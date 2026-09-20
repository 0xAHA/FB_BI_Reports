using System.IO;
using System.Text;
using System.Text.Json.Nodes;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;

namespace FbApiTool;

/// <summary>What a request view needs from the shell it lives in.</summary>
public sealed class RequestContext
{
    public required ApiCatalog Catalog { get; init; }
    public required ApiRunner Runner { get; init; }
    public required Func<string> BaseUrl { get; init; }
    public required Func<string?> Token { get; init; }
    public required Action<string> Status { get; init; }
    public required Action<HistoryEntry> Record { get; init; }

    /// <summary>Read a persisted preference, e.g. whether to keep query results.</summary>
    public required Func<string, string?> Setting { get; init; }

    public required Action<string, string> SetSetting { get; init; }

    /// <summary>The live variable list, shared with the workspace panel.</summary>
    public required IReadOnlyCollection<Variable> Variables { get; init; }

    /// <summary>Set or add a variable: name, value, where it came from.</summary>
    public required Action<string, string, string?> SetVariable { get; init; }

    /// <summary>The signed-in user’s access rights, or null when not connected.</summary>
    public required Func<IReadOnlySet<string>?> Rights { get; init; }

    public required Func<bool> Authenticated { get; init; }

    /// <summary>Asked before a write; false cancels the send.</summary>
    public required Func<string, string, bool> ConfirmSend { get; init; }

    public required Action<SavedRequest> Store { get; init; }

    public required Func<DbSchema.Snapshot?> Schema { get; init; }

    public required Func<bool, Task<DbSchema.Snapshot?>> LoadSchema { get; init; }

    /// <summary>A one-line input box, owned by the main window.</summary>
    public required Func<string, string, string, string?> Ask { get; init; }
}

/// <summary>
/// One open request: the form, the payload and the response it produced.
///
/// Everything is on screen at once by design. The HTML tool this replaces put
/// the body editor and the field list in the same pane, and that matters more
/// than it sounds: composing a body while reading which fields are required is
/// the main thing anyone does here, and splitting the two across tabs turns it
/// into a memory exercise.
/// </summary>
public partial class RequestView : UserControl
{
    private readonly RequestContext _ctx;
    public ApiEndpoint Endpoint { get; }

    private ApiResult? _last;
    private string _loadedFile = "";

    /// <summary>The query parameter the SQL editor stands in for, when there is one.</summary>
    private ApiParam? _sqlParam;

    public RequestView(RequestContext ctx, ApiEndpoint ep)
    {
        InitializeComponent();
        _ctx = ctx;
        Endpoint = ep;

        TxtMethod.Text = ep.Method;
        BadgeMethod.Background = MethodColours.Fill(ep.Method);
        TxtMethod.Foreground = MethodColours.For(ep.Method);
        TxtEpDesc.Text = string.IsNullOrWhiteSpace(ep.Description)
            ? "(no description in the catalog)" : ep.Description;

        // Before the field builders: both of them attach the boxes they make
        // to it, and it has to exist by then.
        _vars = new VarComplete(VarPopup, VarList, () => _ctx.Variables);
        _vars.Attach(TxtBody);
        _vars.Attach(TxtUrl);

        BuildPathParams();
        BuildQueryParams();

        _sqlParam = ep.QueryParams.FirstOrDefault(SqlFormat.IsSqlParam);

        SetUpDefaultView();
        RefreshRightCheck();
        IsVisibleChanged += (_, e) => { if ((bool)e.NewValue) RefreshRightCheck(); };

        if (ep.IsImport) SetUpImport();
        else if (_sqlParam is not null) SetUpSql();
        else SetUpBody();

        UpdateUrl();
    }

    /// <summary>
    /// Enter sends, from anywhere in the form.
    ///
    /// Except inside the payload editors, where Enter has to mean a new line —
    /// they are multi-line by nature and losing a half-typed body to a stray
    /// keystroke would be far worse than the convenience is worth. Ctrl+Enter
    /// sends from there, and from anywhere else too.
    /// </summary>
    private void View_PreviewKeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key != Key.Enter && e.Key != Key.Return) return;

        var ctrl = (Keyboard.Modifiers & ModifierKeys.Control) == ModifierKeys.Control;
        // A RichTextBox is not a TextBox, so the SQL editor has to be named
        // explicitly or Enter would send instead of making a new line.
        var inEditor = Keyboard.FocusedElement is TextBox { AcceptsReturn: true }
                    or System.Windows.Controls.RichTextBox;
        if (inEditor && !ctrl) return;

        // An open combo drop-down is using Enter to choose an item.
        if (Keyboard.FocusedElement is DependencyObject d && ComboOpenAbove(d)) return;

        e.Handled = true;
        if (BtnSend.IsEnabled) BtnSend_Click(BtnSend, new RoutedEventArgs());
    }

    private static bool ComboOpenAbove(DependencyObject from)
    {
        for (var n = from; n is not null; n = VisualTreeHelper.GetParent(n))
            if (n is ComboBox { IsDropDownOpen: true }) return true;
        return false;
    }

    // ── FORM ────────────────────────────────────────────────────────────

    private void BuildPathParams()
    {
        // The import endpoint's only path parameter IS the import type, and it
        // gets a proper picker below, so the generic row would just duplicate it.
        var names = Endpoint.IsImport
            ? Endpoint.PathParams.Where(p => !p.Equals("name", StringComparison.OrdinalIgnoreCase)).ToList()
            : Endpoint.PathParams;

        if (names.Count == 0) { SecPath.Visibility = Visibility.Collapsed; return; }
        foreach (var p in names) PanelPath.Children.Add(PathRow(p));
    }

    private FrameworkElement PathRow(string name)
    {
        var grid = new Grid { Margin = new Thickness(0, 0, 0, 5) };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(150) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

        var label = new TextBlock
        {
            Text = "{" + name + "}",
            FontFamily = new FontFamily("Cascadia Mono, Consolas, monospace"),
            FontSize = 13, VerticalAlignment = VerticalAlignment.Center,
        };
        var box = new TextBox { Tag = name, Padding = new Thickness(6, 4, 6, 4), FontSize = 13 };
        box.TextChanged += (_, _) => UpdateUrl();
        _vars.Attach(box);

        Grid.SetColumn(label, 0);
        Grid.SetColumn(box, 1);
        grid.Children.Add(label);
        grid.Children.Add(box);
        return grid;
    }

    private void BuildQueryParams()
    {
        // The SQL parameter is rendered as an editor instead, so it must not
        // also appear here — two inputs for one value is a trap.
        var shown = Endpoint.QueryParams.Where(q => !SqlFormat.IsSqlParam(q)).ToList();
        foreach (var q in shown) PanelQuery.Children.Add(QueryRow(q.Name, "", q.Description));
        if (shown.Count == 0) PanelQuery.Children.Add(QueryRow("", "", ""));
    }

    private FrameworkElement QueryRow(string key, string value, string description)
    {
        var outer = new StackPanel { Margin = new Thickness(0, 0, 0, 5) };
        var grid = new Grid();
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(210) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var k = new TextBox { Text = key, Padding = new Thickness(6, 3, 6, 3), FontSize = 13, Margin = new Thickness(0, 0, 6, 0) };
        var v = new TextBox { Text = value, Padding = new Thickness(6, 3, 6, 3), FontSize = 13 };
        var x = new Button { Content = "×", Style = (Style)FindResource("RowKill"), Margin = new Thickness(6, 0, 0, 0), ToolTip = "Remove" };
        _vars.Attach(k);
        _vars.Attach(v);

        k.TextChanged += (_, _) => UpdateUrl();
        v.TextChanged += (_, _) => UpdateUrl();
        x.Click += (_, _) => { PanelQuery.Children.Remove(outer); UpdateUrl(); };

        if (!string.IsNullOrWhiteSpace(description)) { k.ToolTip = description; v.ToolTip = description; }

        Grid.SetColumn(k, 0); Grid.SetColumn(v, 1); Grid.SetColumn(x, 2);
        grid.Children.Add(k); grid.Children.Add(v); grid.Children.Add(x);
        outer.Children.Add(grid);

        if (!string.IsNullOrWhiteSpace(description))
            outer.Children.Add(new TextBlock
            {
                Text = description, FontSize = 11.5, TextWrapping = TextWrapping.Wrap,
                Foreground = (Brush)FindResource("FbTextMuted"), Margin = new Thickness(2, 1, 0, 0),
            });

        outer.Tag = new[] { k, v };
        return outer;
    }

    private void BtnAddQuery_Click(object sender, RoutedEventArgs e) => PanelQuery.Children.Add(QueryRow("", "", ""));

    private void BtnAddHeader_Click(object sender, RoutedEventArgs e) => PanelHeaders.Children.Add(HeaderRow("", ""));

    private FrameworkElement HeaderRow(string key, string value)
    {
        var grid = new Grid { Margin = new Thickness(0, 0, 0, 5) };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(210) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var k = new TextBox { Text = key, Padding = new Thickness(6, 3, 6, 3), FontSize = 13, Margin = new Thickness(0, 0, 6, 0) };
        var v = new TextBox { Text = value, Padding = new Thickness(6, 3, 6, 3), FontSize = 13 };
        var x = new Button { Content = "×", Style = (Style)FindResource("RowKill"), Margin = new Thickness(6, 0, 0, 0), ToolTip = "Remove" };
        _vars.Attach(k);
        _vars.Attach(v);
        x.Click += (_, _) => PanelHeaders.Children.Remove(grid);

        Grid.SetColumn(k, 0); Grid.SetColumn(v, 1); Grid.SetColumn(x, 2);
        grid.Children.Add(k); grid.Children.Add(v); grid.Children.Add(x);
        grid.Tag = new[] { k, v };
        return grid;
    }

    // ── BODY ────────────────────────────────────────────────────────────

    private void SetUpBody()
    {
        var takesBody = Endpoint.BodySample is not null || Endpoint.Method is "POST" or "PUT" or "PATCH";
        if (!takesBody && Endpoint.Attributes.Count == 0)
        {
            SecBody.Visibility = Visibility.Collapsed;
            return;
        }

        TxtBody.Text = Endpoint.BodySample ?? "";

        // A GET with a documented field list has no body to edit — those
        // fields describe what comes BACK, so the pane becomes a response
        // reference and the field list takes the whole card.
        if (!takesBody)
        {
            TxtBodyLabel.Text = "RESPONSE FIELDS";
            TxtContentType.Visibility = Visibility.Collapsed;
            TxtBody.Visibility = Visibility.Collapsed;
            SchemaPane.MaxHeight = double.PositiveInfinity;
            SchemaPane.Margin = new Thickness(0);
        }

        if (Endpoint.Attributes.Count == 0)
        {
            ShowSchema(false);
            BtnSchemaToggle.Visibility = Visibility.Collapsed;
        }
        else
        {
            GridSchema.ItemsSource = Endpoint.Attributes.Select(a => new SchemaRow(a)).ToList();
            TxtSchemaCount.Text = Endpoint.Attributes.Count + " DOCUMENTED FIELD" +
                                  (Endpoint.Attributes.Count == 1 ? "" : "S");
            ShowSchema(true);
        }
    }

    private void BtnSchemaToggle_Click(object sender, RoutedEventArgs e) =>
        ShowSchema(SchemaPane.Visibility != Visibility.Visible);

    private void ShowSchema(bool on)
    {
        SchemaPane.Visibility = on ? Visibility.Visible : Visibility.Collapsed;
        BtnSchemaToggle.Content = on ? "Fields ▴" : "Fields ▾";
    }

    private void BtnFormatBody_Click(object sender, RoutedEventArgs e)
    {
        var box = ActivePayloadBox();
        if (box.Text.Trim().Length == 0) return;
        box.Text = ApiRunner.Pretty(box.Text);
    }

    /// <summary>The text that will be sent, whichever pane is showing.</summary>
    private string PayloadText => _sqlParam is not null ? TxtSql.Text : ActivePayloadBox().Text;

    private void BtnResetBody_Click(object sender, RoutedEventArgs e)
    {
        if (Endpoint.BodySample is not null) TxtBody.Text = Endpoint.BodySample;
    }

    private void BtnCopyBody_Click(object sender, RoutedEventArgs e) => Copy(ActivePayloadBox().Text, "Request body");

    private TextBox ActivePayloadBox() => Endpoint.IsImport ? TxtImport : TxtBody;

    // ── IMPORT ──────────────────────────────────────────────────────────

    /// <summary>
    /// Give /api/data-query a real editor.
    ///
    /// The statement travels in a query parameter, which as an ordinary
    /// parameter row is a single line you cannot read a join in.
    /// </summary>
    private void SetUpSql()
    {
        SecBody.Visibility = Visibility.Collapsed;
        SecSql.Visibility = Visibility.Visible;
        TxtSql.TextChanged += (_, _) => UpdateUrl();
        TxtSql.SchemaSource = _ctx.Schema;
        TxtSql.VariableSource = () => _ctx.Variables;
        // Completion is far more useful with real table names, so ask for them
        // the first time a query pane opens rather than waiting for a Refresh.
        _ = _ctx.LoadSchema(false);
        SetUpSavedRuns();
        TxtSql.Text = """
            SELECT id, num, description
            FROM part
            WHERE activeFlag = 1
            ORDER BY num
            LIMIT 100
            """;
    }

    private void BtnFormatSql_Click(object sender, RoutedEventArgs e)
    {
        if (TxtSql.Text.Trim().Length == 0) return;
        TxtSql.Text = SqlFormat.Pretty(TxtSql.Text);   // the setter recolours
    }

    /// <summary>
    /// Put a name from the schema browser into the editor, at the caret.
    ///
    /// With a space in front when one is needed, because the alternative —
    /// pasting straight onto the end of the previous word — silently
    /// produces something that does not parse.
    /// </summary>
    public void InsertSql(string text)
    {
        if (_sqlParam is null) return;
        TxtSql.InsertAtCaret(text);
        TxtSql.Focus();
    }

    private void BtnCopySql_Click(object sender, RoutedEventArgs e) => Copy(TxtSql.Text, "Query");

    private void BtnClearSql_Click(object sender, RoutedEventArgs e) => TxtSql.Clear();

    private void SetUpImport()
    {
        SecBody.Visibility = Visibility.Collapsed;
        SecImport.Visibility = Visibility.Visible;

        // Only the names the server will actually accept for an import, and
        // each one labelled with the directions it supports — "export only"
        // entries are still listed because the same picker drives the export
        // endpoints, and hiding them would make the list look incomplete.
        CmbImportName.ItemsSource = _ctx.Catalog.ImportNames;
        CmbImportName.DisplayMemberPath = nameof(ImportName.Name);
        CmbImportName.ItemTemplate = null;

        ApplyFormat();
    }

    private bool JsonMode => FmtJson.IsChecked == true;

    private void Fmt_Click(object sender, RoutedEventArgs e)
    {
        // Convert what is already there rather than throwing it away — the two
        // formats carry exactly the same rows.
        var text = TxtImport.Text.Trim();
        if (text.Length > 0)
        {
            try { TxtImport.Text = JsonMode ? ImportPayload.CsvToJson(text) : ImportPayload.JsonToCsv(text); }
            catch (Exception ex) { _ctx.Status("Could not convert what is in the editor: " + ex.Message); }
        }
        ApplyFormat();
    }

    private void ApplyFormat()
    {
        TxtImportHint.Text = JsonMode
            ? "PAYLOAD  ·  application/json  ·  a 2-D array — the first row is the headers"
            : "PAYLOAD  ·  text/plain  ·  first row is the headers, values in double quotes";
    }

    /// <summary>
    /// Open the list on a click anywhere in the box, not just on the arrow.
    ///
    /// An editable ComboBox only opens from its arrow by default, which is the
    /// wrong default for a 67-item list nobody has memorised: the text field is
    /// for narrowing the list down, not for typing a name blind.
    ///
    /// The arrow is skipped deliberately. It is a ToggleButton that flips the
    /// drop-down itself, so opening it here first made the toggle close it
    /// again and the list never appeared at all.
    /// </summary>
    private void CmbImportName_Click(object sender, MouseButtonEventArgs e)
    {
        if (CmbImportName.IsDropDownOpen) return;
        if (e.OriginalSource is DependencyObject src && ToggleAbove(src)) return;
        CmbImportName.IsDropDownOpen = true;
        // Not handled: the caret still lands where the click was aimed.
    }

    private static bool ToggleAbove(DependencyObject from)
    {
        for (var n = from; n is not null; n = VisualTreeHelper.GetParent(n))
        {
            if (n is System.Windows.Controls.Primitives.ToggleButton) return true;
            if (n is ComboBox) return false;          // reached the box itself
        }
        return false;
    }
    private async void CmbImportName_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        UpdateUrl();
        if (SelectedImportName().Length > 0) await FetchHeadersAsync(quiet: true);
    }

    private string SelectedImportName() =>
        (CmbImportName.SelectedItem as ImportName)?.Name ?? (CmbImportName.Text ?? "").Trim();

    private async void BtnFetchHeaders_Click(object sender, RoutedEventArgs e) => await FetchHeadersAsync(quiet: false);

    /// <summary>
    /// Ask the matching export endpoint what columns this type uses and lay out
    /// a template row.
    ///
    /// The layouts are documented. What asking the server adds is THIS
    /// instance: the header row comes back with the custom fields this database
    /// actually has, which no general documentation can know about. So it is
    /// not merely a reference — it is what this server will accept.
    /// </summary>
    private async Task FetchHeadersAsync(bool quiet)
    {
        var name = SelectedImportName();
        if (name.Length == 0)
        {
            if (!quiet) _ctx.Status("Choose an import type first.");
            return;
        }
        if (string.IsNullOrEmpty(_ctx.Token()))
        {
            if (!quiet) _ctx.Status("Connect first — fetching headers needs a token.");
            return;
        }
        // Overwriting something the user typed (or a file they just dropped)
        // would be worse than leaving the template unfilled.
        if (!quiet && TxtImport.Text.Trim().Length > 0 &&
            MessageBox.Show(Window.GetWindow(this), "Replace what is in the payload editor with a fresh header template?",
                "Fetch headers", MessageBoxButton.YesNo, MessageBoxImage.Question, MessageBoxResult.No) != MessageBoxResult.Yes)
            return;
        if (quiet && TxtImport.Text.Trim().Length > 0) return;

        var exportName = _ctx.Catalog.HeaderNameFor(name);
        try
        {
            var r = await _ctx.Runner.SendAsync(_ctx.BaseUrl(), "GET",
                "/api/export/" + Uri.EscapeDataString(exportName) + "/header",
                [], [new("Accept", "text/csv")], null, "application/json", _ctx.Token());

            if (!r.Ok)
            {
                _ctx.Status("No headers for “" + exportName + "” (" + r.Status + "). " +
                            (name == exportName ? "This type may be import-only." : "Alias tried: " + exportName));
                return;
            }

            var headers = ImportPayload.HeadersFrom(r.Body);
            if (headers.Count == 0) { _ctx.Status("The server returned no header row for " + exportName + "."); return; }

            TxtImport.Text = ImportPayload.Template(headers, JsonMode);
            _ctx.Status("Laid out " + headers.Count + " column(s) for " + name + ".");
        }
        catch (Exception ex) { _ctx.Status("Could not fetch headers: " + ex.Message); }
    }

    private void DropZone_Click(object sender, MouseButtonEventArgs e)
    {
        var dlg = new Microsoft.Win32.OpenFileDialog
        {
            Title = "Load an import payload",
            Filter = "Import files (*.csv;*.txt;*.json)|*.csv;*.txt;*.json|All files (*.*)|*.*",
        };
        if (dlg.ShowDialog(Window.GetWindow(this)) == true) LoadPayload(dlg.FileName);
    }

    private void View_DragOver(object sender, DragEventArgs e)
    {
        e.Effects = Endpoint.IsImport && e.Data.GetDataPresent(DataFormats.FileDrop)
            ? DragDropEffects.Copy : DragDropEffects.None;
        e.Handled = true;
    }

    private void View_Drop(object sender, DragEventArgs e)
    {
        if (!Endpoint.IsImport) return;
        if (e.Data.GetData(DataFormats.FileDrop) is string[] { Length: > 0 } files) LoadPayload(files[0]);
        e.Handled = true;
    }

    private void LoadPayload(string path)
    {
        try
        {
            var content = File.ReadAllText(path);
            // Trust the content over the extension — plenty of .txt files hold
            // JSON, and getting this wrong sends the wrong Content-Type.
            var json = path.EndsWith(".json", StringComparison.OrdinalIgnoreCase) || ImportPayload.LooksJson(content);
            FmtJson.IsChecked = json;
            FmtCsv.IsChecked = !json;
            ApplyFormat();

            TxtImport.Text = json ? ApiRunner.Pretty(content) : content;
            _loadedFile = path;
            TxtDrop.Text = "✓ " + Path.GetFileName(path) + "  (" + (new FileInfo(path).Length / 1024.0).ToString("N1") + " KB)";
            DropZone.Background = (Brush)FindResource("FbTint");
            BtnClearFile.Visibility = Visibility.Visible;
            _ctx.Status("Loaded " + path);
        }
        catch (Exception ex) { _ctx.Status("Could not read that file: " + ex.Message); }
    }

    private void BtnClearFile_Click(object sender, RoutedEventArgs e)
    {
        TxtImport.Clear();
        _loadedFile = "";
        TxtDrop.Text = "Drop a .csv, .txt or .json file here, or click to browse";
        DropZone.Background = new SolidColorBrush(Color.FromRgb(0xFB, 0xFC, 0xFD));
        BtnClearFile.Visibility = Visibility.Collapsed;
    }

    // ── URL ─────────────────────────────────────────────────────────────

    /// <summary>The path as typed, with {{placeholders}} still in it.</summary>
    private string RawPath()
    {
        var path = Endpoint.Path;

        if (Endpoint.IsImport)
        {
            var name = SelectedImportName();
            if (name.Length > 0) path = path.Replace("{name}", name, StringComparison.Ordinal);
        }

        foreach (var (k, v) in RawPathValues())
            if (v.Length > 0) path = path.Replace("{" + k + "}", v, StringComparison.Ordinal);

        return path;
    }

    private Dictionary<string, string> RawPathValues()
    {
        var values = new Dictionary<string, string>();
        if (Endpoint.IsImport && SelectedImportName() is { Length: > 0 } n) values["name"] = n;

        foreach (var grid in PanelPath.Children.OfType<Grid>())
        {
            if (grid.Children.OfType<TextBox>().FirstOrDefault() is not { Tag: string k } box) continue;
            var v = box.Text.Trim();
            if (v.Length > 0) values[k] = v;
        }
        return values;
    }

    private List<KeyValuePair<string, string>> RawQuery()
    {
        var list = new List<KeyValuePair<string, string>>();
        foreach (var row in PanelQuery.Children.OfType<StackPanel>())
        {
            if (row.Tag is not TextBox[] { Length: 2 } pair) continue;
            var k = pair[0].Text.Trim();
            if (k.Length > 0 && !string.IsNullOrEmpty(pair[1].Text)) list.Add(new(k, pair[1].Text));
        }
        if (_sqlParam is not null && TxtSql.Text.Trim().Length > 0)
            list.Add(new(_sqlParam.Name, TxtSql.Text.Trim()));
        return list;
    }

    private List<KeyValuePair<string, string>> RawHeaders()
    {
        var list = new List<KeyValuePair<string, string>>();
        foreach (var row in PanelHeaders.Children.OfType<Grid>())
        {
            if (row.Tag is not TextBox[] { Length: 2 } pair) continue;
            var k = pair[0].Text.Trim();
            if (k.Length > 0) list.Add(new(k, pair[1].Text));
        }
        return list;
    }

    /// <summary>The same pairs, with every {{name}} resolved.</summary>
    private List<KeyValuePair<string, string>> Filled(List<KeyValuePair<string, string>> pairs) =>
        [.. pairs.Select(p => new KeyValuePair<string, string>(Fill(p.Key), Fill(p.Value)))];

    private string? BodyToSend()
    {
        var text = PayloadText;
        return text.Trim().Length > 0 ? Fill(text) : null;
    }

    private string ResolvedPath()
    {
        var path = Endpoint.Path;

        // Expanded first, then escaped: a variable holding "A B" has to reach
        // the URL as A%20B, and escaping the placeholder itself would send
        // %7B%7BpartId%7D%7D.
        foreach (var (k, v) in RawPathValues())
        {
            var value = Fill(v);
            if (value.Length > 0)
                path = path.Replace("{" + k + "}", Uri.EscapeDataString(value), StringComparison.Ordinal);
        }
        return path;
    }

    private List<KeyValuePair<string, string>> CollectQuery() => Filled(RawQuery());

    private List<KeyValuePair<string, string>> CollectHeaders() => Filled(RawHeaders());

    /// <summary>
    /// True once the URL bar has been typed into by hand. The fields below then
    /// stop driving it — quietly rebuilding over somebody's edit is the more
    /// annoying of the two behaviours, and Revert URL puts them back in charge.
    /// </summary>
    private bool _urlEdited;

    /// <summary>Set while UpdateUrl writes, so its own write is not an edit.</summary>
    private bool _writingUrl;

    public void UpdateUrl()
    {
        if (_urlEdited) return;

        _writingUrl = true;
        TxtUrl.Text = ApiRunner.BuildUrl(_ctx.BaseUrl(), ResolvedPath(), CollectQuery());
        _writingUrl = false;
    }

    private void TxtUrl_TextChanged(object sender, TextChangedEventArgs e)
    {
        if (_writingUrl) return;
        _urlEdited = true;
        BtnRevertUrl.Visibility = Visibility.Visible;
    }

    private void BtnRevertUrl_Click(object sender, RoutedEventArgs e)
    {
        _urlEdited = false;
        BtnRevertUrl.Visibility = Visibility.Collapsed;
        UpdateUrl();
        _ctx.Status("URL back to what the fields build.");
    }

    /// <summary>
    /// What to actually send: the form's three pieces, or the typed URL taken
    /// apart again when it has been overridden.
    /// </summary>
    private (string BaseUrl, string Path, List<KeyValuePair<string, string>> Query) Target()
    {
        if (!_urlEdited) return (_ctx.BaseUrl(), ResolvedPath(), CollectQuery());
        return ApiRunner.SplitUrl(Fill(TxtUrl.Text), _ctx.BaseUrl());
    }

    private void BtnCopyUrl_Click(object sender, RoutedEventArgs e) => Copy(TxtUrl.Text, "URL");

    // ── SEND ────────────────────────────────────────────────────────────

    private string ContentType => Endpoint.IsImport
        ? (JsonMode ? ImportPayload.JsonContentType : ImportPayload.CsvContentType)
        : TxtContentType.Text.Trim();

    private async void BtnSend_Click(object sender, RoutedEventArgs e)
    {
        var (baseUrl, path, query) = Target();
        if (path.Contains('{'))
        {
            var missing = System.Text.RegularExpressions.Regex.Matches(path, @"\{([A-Za-z0-9_]+)\}")
                                .Select(m => m.Groups[1].Value);
            _ctx.Status("Fill in the path parameter(s) first: " + string.Join(", ", missing));
            MessageBox.Show(Window.GetWindow(this),
                Endpoint.IsImport ? "Choose an import type first." : "Fill in: " + string.Join(", ", missing),
                "Fishbowl API Tool", MessageBoxButton.OK, MessageBoxImage.Warning);
            return;
        }

        // An unresolved {{name}} would otherwise travel to the server as
        // literal braces and come back as a puzzling 400 or an empty result.
        if (MissingVariables() is { Count: > 0 } unset)
        {
            MessageBox.Show(Window.GetWindow(this),
                "These variables have no value yet:\n\n  " + string.Join("\n  ", unset.Select(m => "{{" + m + "}}")) +
                "\n\nSet them in the Variables panel, or capture them from a response.",
                "Fishbowl API Tool", MessageBoxButton.OK, MessageBoxImage.Warning);
            return;
        }

        if (Endpoint.RequiresAuth && string.IsNullOrEmpty(_ctx.Token()))
        {
            MessageBox.Show(Window.GetWindow(this), "This endpoint needs a token. Connect first.",
                            "Fishbowl API Tool", MessageBoxButton.OK, MessageBoxImage.Warning);
            return;
        }

        // A SQL endpoint sends nothing in the body — the statement rides in the
        // query string, and CollectQuery has already picked it up.
        var payload = _sqlParam is not null ? "" : ActivePayloadBox().Text;
        var body = SecBody.Visibility == Visibility.Visible || Endpoint.IsImport
            ? (payload.Trim().Length > 0 ? Fill(payload) : null) : null;

        // Invalid JSON comes back as a generic 400 that says nothing useful, so
        // say what is actually wrong before spending the round trip.
        if (body is not null && ContentType.Contains("json", StringComparison.OrdinalIgnoreCase))
        {
            try { JsonNode.Parse(body); }
            catch (System.Text.Json.JsonException jx)
            {
                MessageBox.Show(Window.GetWindow(this), "The payload is not valid JSON:\n\n" + jx.Message,
                                "Fishbowl API Tool", MessageBoxButton.OK, MessageBoxImage.Warning);
                return;
            }
        }

        if (!_ctx.ConfirmSend(Endpoint.Method, ApiRunner.BuildUrl(baseUrl, path, query))) return;

        BtnSend.IsEnabled = false;
        BtnSend.Content = "Sending…";
        _ctx.Status(Endpoint.Method + " " + path + " …");
        try
        {
            var r = await _ctx.Runner.SendAsync(baseUrl, Endpoint.Method, path,
                query, CollectHeaders(), body, ContentType, _ctx.Token());
            Show(r);
            RunCaptures(r);
            _ctx.Record(new HistoryEntry
            {
                EndpointId = Endpoint.Id, Method = r.Method, Url = r.Url, Body = body, Status = r.Status,
            });
        }
        catch (Exception ex) { Fail(ex); }
        finally { BtnSend.IsEnabled = true; BtnSend.Content = "Send"; }
    }

    private void Show(ApiResult r, bool live = true)
    {
        _last = r;
        _shown = r;
        BadgeStatus.Visibility = Visibility.Visible;
        TxtRespStatus.Text = r.Status + " " + r.Reason;
        BadgeStatus.Background = r.Ok ? (Brush)FindResource("FbGreen")
                               : r.Status >= 500 ? (Brush)FindResource("FbRed")
                               : (Brush)FindResource("FbAmber");
        TxtRespMeta.Text = r.Millis + " ms  ·  " + Bytes(r.Bytes) + (r.IsJson ? "  ·  JSON" : "");

        TxtRaw.Text = r.Body;
        if (r.IsJson) TxtPretty.SetJson(ApiRunner.Pretty(r.Body));
        else TxtPretty.SetPlain(r.Body);
        GridHeaders.ItemsSource = r.ResponseHeaders;
        BuildTable(r);
        var hasRows = r.IsJson && ApiRunner.Tabulate(r.Body).Rows.Count > 0;
        RespTabs.SelectedIndex = ChooseTab(r, hasRows);

        // Keep the result, if this is a query and the option is on. Saving a
        // reloaded result would duplicate it, which is why "live" exists.
        if (live && _sqlParam is not null && r.Ok && KeepResults)
        {
            var saved = QueryHistory.Save(_ctx.BaseUrl(), TxtSql.Text.Trim(), r,
                                          ApiRunner.Tabulate(r.Body).Rows.Count);
            if (saved is not null && SavedPane.Visibility == Visibility.Visible) RefreshRuns();
        }
        if (live)
            _ctx.Status(r.Method + " " + r.Url + "  →  " + r.Status + " " + r.Reason + " in " + r.Millis + " ms");
    }

    // ── WHICH TAB A RESPONSE OPENS ON ───────────────────────────────────

    private const string ViewSetting = "resp:defaultView";
    private static readonly string[] ViewNames = ["Auto", "Pretty", "Raw", "Table", "Headers"];

    private void SetUpDefaultView()
    {
        CmbDefaultView.ItemsSource = ViewNames;
        var saved = _ctx.Setting(ViewSetting);
        var i = Array.FindIndex(ViewNames, v => v.Equals(saved, StringComparison.OrdinalIgnoreCase));
        CmbDefaultView.SelectedIndex = i < 0 ? 0 : i;
    }

    private void CmbDefaultView_Changed(object sender, SelectionChangedEventArgs e)
    {
        if (CmbDefaultView.SelectedItem is not string v) return;
        _ctx.SetSetting(ViewSetting, v);
        // Apply it now rather than only on the next request — otherwise the
        // setting looks as though it did nothing.
        if (_last is not null)
            RespTabs.SelectedIndex = ChooseTab(_last, _last.IsJson && ApiRunner.Tabulate(_last.Body).Rows.Count > 0);
    }

    /// <summary>
    /// The tab to open on.
    ///
    /// A chosen tab is honoured where it makes sense and quietly stepped past
    /// where it does not: opening on an empty Table because that is the
    /// preference would just hide the error the response actually contains.
    /// </summary>
    private int ChooseTab(ApiResult r, bool hasRows)
    {
        var choice = CmbDefaultView.SelectedItem as string ?? "Auto";

        if (!r.IsJson) return choice == "Headers" ? 3 : 1;          // only Raw has anything in it

        return choice switch
        {
            "Pretty" => 0,
            "Raw" => 1,
            "Table" => hasRows ? 2 : 0,
            "Headers" => 3,
            // Auto: a query is run to look at rows, so show them when there
            // are any. Everything else reads better as JSON.
            _ => _sqlParam is not null && hasRows ? 2 : 0,
        };
    }

    private void Fail(Exception ex)
    {
        _last = null;
        BadgeStatus.Visibility = Visibility.Visible;
        BadgeStatus.Background = (Brush)FindResource("FbRed");
        TxtRespStatus.Text = "no response";
        TxtRespMeta.Text = "";
        // A transport failure never reached the server, so say that rather than
        // leaving a bare exception that reads like an API error.
        var msg = "The request did not reach the server.\n\n" + ex.Message;
        if (ex.InnerException is not null) msg += "\n\n" + ex.InnerException.Message;
        TxtRaw.Text = msg;
        TxtPretty.SetPlain(msg);
        GridResp.ItemsSource = null;
        GridResp.Columns.Clear();
        GridHeaders.ItemsSource = null;
        RespTabs.SelectedIndex = 1;
        _ctx.Status("Failed: " + ex.Message);
    }

    private void BuildTable(ApiResult r)
    {
        GridResp.Columns.Clear();
        GridResp.ItemsSource = null;
        if (!r.IsJson) return;

        var (cols, rows) = ApiRunner.Tabulate(r.Body);
        if (cols.Count == 0 || rows.Count == 0) return;

        foreach (var c in cols) GridResp.Columns.Add(ToneColumn(c));
        GridResp.ItemsSource = rows;
    }

    /// <summary>
    /// A column that draws a recognised value as a coloured chip.
    ///
    /// Built in code because the columns are whatever the endpoint returned —
    /// there is no compile-time type to write a template against. Rows are
    /// dictionaries, so the binding is an indexer.
    ///
    /// Only values Tone recognises get a chip. Chipping every cell would be
    /// noise, and chipping a part number would be a lie.
    /// </summary>
    private static DataGridTemplateColumn ToneColumn(string key)
    {
        var binding = new System.Windows.Data.Binding("[" + key + "]");

        var chip = new FrameworkElementFactory(typeof(Border));
        chip.SetBinding(Border.BackgroundProperty,
            Bound(key, new ToneConverter(ToneConverter.Part.Background)));
        chip.SetValue(Border.CornerRadiusProperty, new CornerRadius(3));
        chip.SetValue(Border.PaddingProperty, new Thickness(6, 1, 6, 1));
        chip.SetValue(Border.HorizontalAlignmentProperty, HorizontalAlignment.Left);
        chip.SetValue(Border.MarginProperty, new Thickness(0, 1, 0, 1));

        var text = new FrameworkElementFactory(typeof(TextBlock));
        text.SetBinding(TextBlock.TextProperty, binding);
        text.SetBinding(TextBlock.ForegroundProperty,
            Bound(key, new ToneConverter(ToneConverter.Part.Foreground)));
        text.SetBinding(TextBlock.FontWeightProperty,
            Bound(key, new ToneConverter(ToneConverter.Part.Weight)));
        text.SetBinding(TextBlock.FontStyleProperty,
            Bound(key, new ToneConverter(ToneConverter.Part.Style)));
        text.SetValue(TextBlock.TextTrimmingProperty, TextTrimming.CharacterEllipsis);
        chip.AppendChild(text);

        return new DataGridTemplateColumn
        {
            Header = key,
            CellTemplate = new DataTemplate { VisualTree = chip },
            Width = new DataGridLength(1, DataGridLengthUnitType.Auto),
            SortMemberPath = "[" + key + "]",
        };
    }

    /// <summary>
    /// Sort by what the column holds, not by how it is spelled.
    ///
    /// Every cell is a string — the table is built from whatever JSON came
    /// back — so the default sort gives 10, 15, 2, 20 on an id column. The
    /// comparer looks at the values instead.
    /// </summary>
    private void GridResp_Sorting(object sender, DataGridSortingEventArgs e)
    {
        if (GridResp.ItemsSource is null) return;
        var key = e.Column.Header as string;
        if (string.IsNullOrEmpty(key)) return;

        var descending = e.Column.SortDirection == System.ComponentModel.ListSortDirection.Ascending;

        if (System.Windows.Data.CollectionViewSource.GetDefaultView(GridResp.ItemsSource)
                is not System.Windows.Data.ListCollectionView view) return;

        view.CustomSort = new RowComparer(key, descending);

        // Clear every other header arrow, or two columns both look sorted.
        foreach (var c in GridResp.Columns) c.SortDirection = null;
        e.Column.SortDirection = descending
            ? System.ComponentModel.ListSortDirection.Descending
            : System.ComponentModel.ListSortDirection.Ascending;
        e.Handled = true;
    }

    private static System.Windows.Data.Binding Bound(string key, ToneConverter converter) =>
        new("[" + key + "]") { Converter = converter };
    private static string Bytes(long n) =>
        n < 1024 ? n + " B" : n < 1024 * 1024 ? (n / 1024.0).ToString("N1") + " KB"
                                              : (n / 1048576.0).ToString("N1") + " MB";

    private void BtnCopyResp_Click(object sender, RoutedEventArgs e) => Copy(TxtRaw.Text, "Response");

    /// <summary>
    /// Save what is in the response pane.
    ///
    /// A tabular result — which is every query result, and most search
    /// endpoints — offers CSV alongside JSON, because a spreadsheet is where it
    /// is usually going. The format follows the file type chosen in the dialog,
    /// so it is the one selection Windows already has rather than a modal of
    /// our own in front of it.
    /// </summary>
    private void BtnSaveResp_Click(object sender, RoutedEventArgs e)
    {
        if (string.IsNullOrEmpty(TxtRaw.Text)) { _ctx.Status("Nothing to save."); return; }

        var json = _last?.IsJson == true;
        var (columns, rows) = json ? ApiRunner.Tabulate(TxtRaw.Text) : ([], []);

        // The comparison view is tabular too, but it lives in the grid rather
        // than in the body text, so take the grid's own rows when it has some.
        if (GridResp.ItemsSource is IEnumerable<Dictionary<string, string>> shown && rows.Count == 0)
        {
            rows = [.. shown];
            columns = [.. GridResp.Columns.Select(c => c.Header as string ?? "").Where(h => h.Length > 0)];
        }

        var tabular = rows.Count > 0 && columns.Count > 0;

        var dlg = new Microsoft.Win32.SaveFileDialog
        {
            FileName = ResultExport.SuggestName(Endpoint.Name, tabular ? "csv" : json ? "json" : "txt"),
            Filter = tabular
                ? "CSV for a spreadsheet (*.csv)|*.csv|JSON (*.json)|*.json|All files (*.*)|*.*"
                : json
                    ? "JSON (*.json)|*.json|All files (*.*)|*.*"
                    : "Text (*.txt)|*.txt|All files (*.*)|*.*",
            // Rows are what someone asked for when they ran a query; offer that
            // first and let them pick JSON if they want the response verbatim.
            FilterIndex = 1,
            AddExtension = true,
        };
        if (dlg.ShowDialog(Window.GetWindow(this)) != true) return;

        var asCsv = tabular &&
                    dlg.FileName.EndsWith(".csv", StringComparison.OrdinalIgnoreCase);

        try
        {
            if (asCsv)
            {
                File.WriteAllText(dlg.FileName, ResultExport.ToCsv(columns, rows), new UTF8Encoding(true));
                _ctx.Status("Saved " + rows.Count + " row(s) as CSV — " + dlg.FileName);
            }
            else
            {
                File.WriteAllText(dlg.FileName, TxtRaw.Text);
                _ctx.Status("Saved " + dlg.FileName);
            }
        }
        catch (Exception ex) { _ctx.Status("Could not save: " + ex.Message); }
    }

    private void Copy(string text, string what)
    {
        if (string.IsNullOrEmpty(text)) { _ctx.Status("Nothing to copy."); return; }
        try { Clipboard.SetDataObject(text, true); _ctx.Status(what + " copied."); }
        catch (Exception ex) { _ctx.Status("Could not copy: " + ex.Message); }
    }

    // ── RESTORE FROM HISTORY ────────────────────────────────────────────

    /// <summary>Put a past call's path, query and body back into the form.</summary>
    public void Restore(HistoryEntry h)
    {
        var uri = new Uri(h.Url);
        ApplyPath(uri.AbsolutePath);
        ApplyQuery(uri.Query);
        if (h.Body is not null) ActivePayloadBox().Text = h.Body;
        UpdateUrl();
    }

    private void ApplyPath(string actual)
    {
        var template = Endpoint.Path.Split('/');
        var real = actual.Split('/');
        if (template.Length != real.Length) return;

        var boxes = PanelPath.Children.OfType<Grid>()
            .Select(g => g.Children.OfType<TextBox>().FirstOrDefault())
            .Where(b => b is not null).ToList();

        for (var i = 0; i < template.Length; i++)
        {
            if (!template[i].StartsWith('{')) continue;
            var name = template[i].Trim('{', '}');
            var value = Uri.UnescapeDataString(real[i]);
            if (Endpoint.IsImport && name.Equals("name", StringComparison.OrdinalIgnoreCase))
            { CmbImportName.Text = value; continue; }
            if (boxes.FirstOrDefault(b => (string?)b!.Tag == name) is { } box) box.Text = value;
        }
    }

    private void ApplyQuery(string query)
    {
        if (string.IsNullOrWhiteSpace(query)) return;
        var sent = query.TrimStart('?').Split('&', StringSplitOptions.RemoveEmptyEntries)
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
            var key = pair[0].Text.Trim();
            pair[1].Text = sent.TryGetValue(key, out var v) ? v : "";
            sent.Remove(key);
        }
        // Anything that was not a documented parameter still has to come back.
        foreach (var (k, v) in sent) PanelQuery.Children.Add(QueryRow(k, v, ""));
    }

    // ── KEPT RESULTS ────────────────────────────────────────────────────
    // A query run against a live database cannot be re-run to get the same
    // answer — that is the whole reason for keeping one. "Was this number
    // different an hour ago?" is unanswerable unless the earlier answer was
    // written down.

    private const string KeepSetting = "sql:keepResults";

    /// <summary>The last result shown, so a kept run can be compared with it.</summary>
    private ApiResult? _shown;

    private void SetUpSavedRuns()
    {
        ChkKeep.IsChecked = _ctx.Setting(KeepSetting) != "0";
        RefreshRuns();
    }

    private bool KeepResults => ChkKeep.IsChecked == true;

    private void ChkKeep_Click(object sender, RoutedEventArgs e)
    {
        _ctx.SetSetting(KeepSetting, KeepResults ? "1" : "0");
        _ctx.Status(KeepResults
            ? "Results will be kept in " + QueryHistory.Dir
            : "Results will no longer be kept. The ones already saved are untouched.");
        if (KeepResults) SavedPane.Visibility = Visibility.Visible;
    }

    private void BtnSaved_Click(object sender, RoutedEventArgs e)
    {
        SavedPane.Visibility = SavedPane.Visibility == Visibility.Visible
            ? Visibility.Collapsed : Visibility.Visible;
        if (SavedPane.Visibility == Visibility.Visible) RefreshRuns();
    }

    private void RefreshRuns()
    {
        var runs = QueryHistory.List();
        LstRuns.ItemsSource = runs;
        TxtSavedCount.Text = runs.Count == 0
            ? "KEPT RESULTS — NONE YET"
            : "KEPT RESULTS — " + runs.Count + " OF " + QueryHistory.Keep;
    }

    private QueryRun? SelectedRun => LstRuns.SelectedItem as QueryRun;

    private void LstRuns_DoubleClick(object sender, MouseButtonEventArgs e) => LoadRun();

    /// <summary>
    /// Put a kept result back in the response pane.
    ///
    /// The status badge says where it came from rather than showing the HTTP
    /// code again: a result from Tuesday sitting under a green "200 OK" would
    /// read as something that just happened.
    /// </summary>
    private void LoadRun()
    {
        if (SelectedRun is not { } run) return;

        var body = QueryHistory.Body(run.Id);
        if (body is null)
        {
            _ctx.Status("That result is no longer on disk.");
            RefreshRuns();
            return;
        }

        var result = new ApiResult("GET", run.Server, run.Status, "kept " + run.When,
                                   body, true, run.Millis, run.Bytes, [], [], null);
        Show(result, live: false);
        _ctx.Status("Showing the result kept at " + run.SavedAt.ToString("ddd d MMM, HH:mm:ss") + ".");
    }

    private void BtnRestoreRun_Click(object sender, RoutedEventArgs e)
    {
        if (SelectedRun is not { } run) { _ctx.Status("Select a kept result first."); return; }
        TxtSql.Text = run.Sql;
        _ctx.Status("Query restored from " + run.When + ".");
    }

    /// <summary>
    /// Compare the selected run with whatever the response pane is showing.
    ///
    /// The comparison is rendered into the response pane itself — a table of
    /// differences and a summary — rather than into a window of its own, so it
    /// can be sorted, copied and saved like any other result.
    /// </summary>
    private void BtnCompareRun_Click(object sender, RoutedEventArgs e)
    {
        if (SelectedRun is not { } run) { _ctx.Status("Select a kept result to compare."); return; }
        if (_shown is null) { _ctx.Status("Run a query first — there is nothing to compare against."); return; }

        var body = QueryHistory.Body(run.Id);
        if (body is null) { _ctx.Status("That result is no longer on disk."); RefreshRuns(); return; }

        var (colsA, rowsA) = ApiRunner.Tabulate(body);
        var (colsB, rowsB) = ApiRunner.Tabulate(_shown.Body);

        var diff = QueryDiff.Compare(colsA, rowsA, colsB, rowsB,
                                     "kept " + run.When, "showing now");

        GridResp.Columns.Clear();
        GridResp.ItemsSource = null;
        foreach (var c in diff.Columns) GridResp.Columns.Add(ToneColumn(c));
        GridResp.ItemsSource = diff.Rows;

        TxtPretty.SetPlain(diff.Summary);
        TxtRaw.Text = diff.Summary;

        BadgeStatus.Visibility = Visibility.Visible;
        BadgeStatus.Background = diff.Any ? (Brush)FindResource("FbWarning") : (Brush)FindResource("FbSuccess");
        TxtRespStatus.Text = diff.Any ? "differences" : "identical";
        TxtRespMeta.Text = diff.Summary.Replace('\n', ' ');

        // The table is the point of a comparison; the summary is on Pretty.
        RespTabs.SelectedIndex = diff.Any ? 2 : 0;
        _ctx.Status(diff.Summary.Replace('\n', ' '));
    }

    private void BtnRenameRun_Click(object sender, RoutedEventArgs e)
    {
        if (SelectedRun is not { } run) { _ctx.Status("Select a kept result first."); return; }
        var name = Prompt("Name this result", "A short label, to tell it apart from a similar run:",
                          run.Label ?? "");
        if (name is null) return;
        QueryHistory.Rename(run.Id, name);
        RefreshRuns();
    }

    private void BtnDeleteRun_Click(object sender, RoutedEventArgs e)
    {
        if (SelectedRun is not { } run) { _ctx.Status("Select a kept result first."); return; }
        QueryHistory.Delete(run.Id);
        RefreshRuns();
        _ctx.Status("Deleted the result kept at " + run.When + ".");
    }

    private void BtnClearRuns_Click(object sender, RoutedEventArgs e)
    {
        var n = QueryHistory.List().Count;
        if (n == 0) { _ctx.Status("Nothing kept."); return; }

        if (MessageBox.Show(Window.GetWindow(this),
                "Delete all " + n + " kept result(s)?\n\nThey cannot be recovered — a query cannot be " +
                "re-run to get the same answer.",
                "Clear kept results", MessageBoxButton.YesNo, MessageBoxImage.Warning,
                MessageBoxResult.No) != MessageBoxResult.Yes) return;

        QueryHistory.Clear();
        RefreshRuns();
        _ctx.Status("Cleared " + n + " kept result(s).");
    }

    /// <summary>A one-line input. WPF ships no InputBox, and a dialog class for this is overkill.</summary>
    private string? Prompt(string title, string label, string initial)
    {
        var box = new TextBox { Text = initial, Margin = new Thickness(0, 8, 0, 14), Padding = new Thickness(7, 5, 7, 5) };
        var ok = new Button { Content = "Save", IsDefault = true, MinWidth = 88, Style = (Style)FindResource("Primary") };
        var cancel = new Button { Content = "Cancel", IsCancel = true, MinWidth = 88, Margin = new Thickness(0, 0, 8, 0) };

        var buttons = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right };
        buttons.Children.Add(cancel);
        buttons.Children.Add(ok);

        var panel = new StackPanel { Margin = new Thickness(18) };
        panel.Children.Add(new TextBlock { Text = label, TextWrapping = TextWrapping.Wrap, FontSize = 12.5 });
        panel.Children.Add(box);
        panel.Children.Add(buttons);

        var win = new Window
        {
            Title = title, Content = panel, Width = 430, SizeToContent = SizeToContent.Height,
            WindowStartupLocation = WindowStartupLocation.CenterOwner, Owner = Window.GetWindow(this),
            ResizeMode = ResizeMode.NoResize, ShowInTaskbar = false,
        };
        ok.Click += (_, _) => win.DialogResult = true;
        win.Loaded += (_, _) => { box.Focus(); box.SelectAll(); };

        return win.ShowDialog() == true ? box.Text.Trim() : null;
    }

    // ── VARIABLES ───────────────────────────────────────────────────────

    /// <summary>What {{name}} resolves to right now.</summary>
    private Dictionary<string, string> Vars => Variables.ToMap(_ctx.Variables);

    /// <summary>
    /// Expand a field for sending.
    ///
    /// An unknown {{name}} is left exactly as it is on purpose — the send check
    /// then catches it by name. Substituting an empty string would build a URL
    /// that looks valid and quietly asks for the wrong record.
    /// </summary>
    private string Fill(string? text) => Variables.Expand(text, Vars);

    /// <summary>Every unresolved placeholder anywhere in the request.</summary>
    private List<string> MissingVariables()
    {
        var values = Vars;
        var names = new List<string>();

        void Scan(string? t)
        {
            foreach (var n in Variables.Unresolved(t, values))
                if (!names.Contains(n, StringComparer.OrdinalIgnoreCase)) names.Add(n);
        }

        Scan(RawPath());
        foreach (var q in RawQuery()) { Scan(q.Key); Scan(q.Value); }
        foreach (var h in RawHeaders()) { Scan(h.Key); Scan(h.Value); }
        Scan(PayloadText);
        return names;
    }

    // ── CAPTURE ─────────────────────────────────────────────────────────

    /// <summary>
    /// Take a value out of the response and put it in a variable.
    ///
    /// This is the point of the whole feature. Fishbowl's contracts force
    /// multi-step work — create an order, read back its id, issue it — and the
    /// id in the middle exists only in the response just received. Without
    /// this, every such sequence is numbers copied between tabs by hand.
    /// </summary>
    private void BtnCapture_Click(object sender, RoutedEventArgs e)
    {
        if (_shown is null) { _ctx.Status("Run the request first — there is nothing to capture."); return; }

        var paths = Variables.Paths(_shown.Body);
        if (paths.Count == 0) { _ctx.Status("Nothing in that response looks capturable."); return; }

        var dlg = new CaptureWindow(paths, _shown.Body, _ctx) { Owner = Window.GetWindow(this) };
        if (dlg.ShowDialog() != true || dlg.Path is null || dlg.VariableName is null) return;

        var value = Variables.Capture(_shown.Body, dlg.Path);
        if (value is null) { _ctx.Status("No value at " + dlg.Path + "."); return; }

        _ctx.SetVariable(dlg.VariableName, value, "captured from " + Endpoint.Name);
        _ctx.Status("{{" + dlg.VariableName + "}} = " + Variables.Preview(value));

        if (dlg.Remember)
        {
            _captures.RemoveAll(c => c.Variable.Equals(dlg.VariableName, StringComparison.OrdinalIgnoreCase));
            _captures.Add(new CaptureRule { Path = dlg.Path, Variable = dlg.VariableName });
            RefreshCaptureLabel();
        }
    }

    private readonly List<CaptureRule> _captures = [];

    private void RefreshCaptureLabel() =>
        TxtCaptures.Text = _captures.Count == 0
            ? ""
            : string.Join("   ", _captures.Select(c => c.ToString()));

    /// <summary>Run the remembered rules against a response that just arrived.</summary>
    private void RunCaptures(ApiResult r)
    {
        if (_captures.Count == 0 || !r.Ok || !r.IsJson) return;

        foreach (var rule in _captures)
        {
            var value = Variables.Capture(r.Body, rule.Path);
            if (value is null) continue;
            _ctx.SetVariable(rule.Variable, value, "captured from " + Endpoint.Name);
        }
    }

    // ── SAVING THE REQUEST ──────────────────────────────────────────────

    /// <summary>
    /// Keep this request by name.
    ///
    /// Stored with the {{placeholders}} intact rather than with what they
    /// currently resolve to, so one saved request works against every server
    /// instead of being welded to the one it was recorded on.
    /// </summary>
    private void BtnSaveRequest_Click(object sender, RoutedEventArgs e)
    {
        var suggested = _saved?.Name ?? Endpoint.Name;
        var name = _ctx.Ask("Save request", "A name for this request:", suggested);
        if (string.IsNullOrWhiteSpace(name)) return;

        var request = new SavedRequest
        {
            Id = _saved?.Id ?? Guid.NewGuid().ToString("N")[..8],
            Name = name.Trim(),
            EndpointId = Endpoint.Id,
            Method = Endpoint.Method,
            Path = Endpoint.Path,
            ContentType = ContentType,
            Body = PayloadText.Trim().Length > 0 ? PayloadText : null,
            Captures = [.. _captures],
        };

        foreach (var (k, v) in RawPathValues()) request.PathValues[k] = v;
        foreach (var q in RawQuery()) request.Query.Add(new NameValue { Name = q.Key, Value = q.Value });
        foreach (var h in RawHeaders()) request.Headers.Add(new NameValue { Name = h.Key, Value = h.Value });

        _saved = request;
        _ctx.Store(request);
    }

    private SavedRequest? _saved;

    /// <summary>Put a saved request back into the form.</summary>
    public void Apply(SavedRequest r)
    {
        _saved = r;

        foreach (var grid in PanelPath.Children.OfType<Grid>())
        {
            if (grid.Children.OfType<TextBox>().FirstOrDefault() is not { Tag: string name } box) continue;
            if (r.PathValues.TryGetValue(name, out var v)) box.Text = v;
        }

        if (Endpoint.IsImport && r.PathValues.TryGetValue("name", out var importName))
            CmbImportName.Text = importName;

        if (r.Query.Count > 0)
        {
            PanelQuery.Children.Clear();
            foreach (var q in r.Query)
            {
                var doc = Endpoint.QueryParams.FirstOrDefault(p =>
                    p.Name.Equals(q.Name, StringComparison.OrdinalIgnoreCase));
                if (_sqlParam is not null && doc is not null && SqlFormat.IsSqlParam(doc)) { TxtSql.Text = q.Value; continue; }
                PanelQuery.Children.Add(QueryRow(q.Name, q.Value, doc?.Description ?? ""));
            }
            if (PanelQuery.Children.Count == 0) PanelQuery.Children.Add(QueryRow("", "", ""));
        }

        PanelHeaders.Children.Clear();
        foreach (var h in r.Headers) PanelHeaders.Children.Add(HeaderRow(h.Name, h.Value));

        if (r.Body is not null)
        {
            if (_sqlParam is not null) TxtSql.Text = r.Body;
            else ActivePayloadBox().Text = r.Body;
        }

        _captures.Clear();
        _captures.AddRange(r.Captures);
        RefreshCaptureLabel();

        UpdateUrl();
    }

    // ── COPY AS ─────────────────────────────────────────────────────────

    private void BtnCopyAs_Click(object sender, RoutedEventArgs e)
    {
        if (sender is Button b && b.ContextMenu is { } menu)
        {
            menu.PlacementTarget = b;
            menu.IsOpen = true;
        }
    }

    private void MnuCopyUrl_Click(object sender, RoutedEventArgs e) => Copy(TxtUrl.Text, "URL");

    private void MnuCopyCurl_Click(object sender, RoutedEventArgs e) =>
        Copy(CurlFormat.ToCurl(Endpoint.Method, TxtUrl.Text, Filled(RawHeaders()),
                               BodyToSend(), ContentType, Endpoint.RequiresAuth),
             "cURL command");

    private void MnuCopyBiReport_Click(object sender, RoutedEventArgs e) =>
        Copy(CurlFormat.ToRunRestApiAsync(Endpoint.Method, Fill(RawPath()),
                                          Filled(RawQuery()), BodyToSend(), ContentType),
             "runRestApiAsync call");

    /// <summary>
    /// Fill the form in from a cURL command on the clipboard.
    ///
    /// This is how an API problem actually arrives — someone pastes the command
    /// they ran. Anything the command carries that this endpoint does not
    /// document still comes across as an extra row rather than being dropped.
    /// </summary>
    private void MnuPasteCurl_Click(object sender, RoutedEventArgs e)
    {
        string text;
        try { text = Clipboard.GetText(); }
        catch (Exception ex) { _ctx.Status("Could not read the clipboard: " + ex.Message); return; }

        if (CurlFormat.Parse(text) is not { } curl)
        {
            MessageBox.Show(Window.GetWindow(this),
                "The clipboard does not hold a cURL command.\n\nCopy one — from a colleague, a ticket, or a " +
                "browser's Copy as cURL — and try again.",
                "Paste from cURL", MessageBoxButton.OK, MessageBoxImage.Information);
            return;
        }

        if (!curl.Method.Equals(Endpoint.Method, StringComparison.OrdinalIgnoreCase))
            _ctx.Status("Note: that command is a " + curl.Method + ", and this endpoint is a " + Endpoint.Method + ".");

        Uri uri;
        try { uri = new Uri(curl.Url); }
        catch { _ctx.Status("That command's URL could not be read."); return; }

        ApplyPath(uri.AbsolutePath);
        ApplyQuery(uri.Query);

        PanelHeaders.Children.Clear();
        foreach (var h in curl.Headers)
        {
            // Authorization comes from the connection, and the pasted one is
            // a placeholder or somebody else's session either way.
            if (h.Key.Equals("Authorization", StringComparison.OrdinalIgnoreCase)) continue;
            if (h.Key.Equals("Content-Type", StringComparison.OrdinalIgnoreCase)) continue;
            PanelHeaders.Children.Add(HeaderRow(h.Key, h.Value));
        }

        if (curl.Body is not null)
        {
            if (_sqlParam is not null) TxtSql.Text = curl.Body;
            else ActivePayloadBox().Text = ApiRunner.Pretty(curl.Body);
        }

        UpdateUrl();
        _ctx.Status("Filled in from the cURL command.");
    }

    // ── ACCESS RIGHT ────────────────────────────────────────────────────

    /// <summary>
    /// Say up front which right this endpoint documents, and whether the
    /// signed-in user has it.
    ///
    /// A 403 from Fishbowl does not say what was missing, so the usual next
    /// step is guessing whether the payload is wrong or the account is — and
    /// that guess costs far more than the call did.
    ///
    /// The answer belongs to whoever is signed in RIGHT NOW, so it is worked
    /// out again on every connection change and again whenever the pane comes
    /// back into view. Computing it once at construction was the bug: a tab
    /// opened before signing in went on saying it could not tell.
    /// </summary>
    public void RefreshRights() => RefreshRightCheck();

    /// <summary>Completion for {{name}}, shared by every field in this pane.</summary>
    private readonly VarComplete _vars;

    private void RefreshRightCheck()
    {
        var check = AccessRights.For(Endpoint, _ctx.Rights());
        if (check is null) { ChipRight.Visibility = Visibility.Collapsed; return; }

        ChipRight.Visibility = Visibility.Visible;
        TxtRight.Text = check.Label;
        ChipRight.Background = check.Held switch
        {
            true => (Brush)FindResource("MethodPostBg"),
            false => (Brush)FindResource("MethodDeleteBg"),
            _ => (Brush)FindResource("FbBg2"),
        };
        TxtRight.Foreground = check.Held switch
        {
            true => (Brush)FindResource("FbSuccess"),
            false => (Brush)FindResource("FbNegative"),
            _ => (Brush)FindResource("FbTextSub"),
        };
        ChipRight.ToolTip = check.Right is null
            ? "The documentation names " + check.Documented + ", which does not map to a known access-right string — so this is not checked."
            : "Documented as " + check.Documented + " → " + check.Right;
    }
}
