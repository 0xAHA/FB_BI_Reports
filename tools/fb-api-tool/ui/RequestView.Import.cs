using Avalonia.Controls;
using Avalonia.Controls.Templates;
using Avalonia.Input;
using Avalonia.Platform.Storage;

namespace FbApiTool.Ui;

/// <summary>
/// The import pane: /api/import/{name}.
///
/// A different shape from every other endpoint. The payload is a spreadsheet
/// rather than a JSON object, the type is a name from a fixed list the server
/// keeps rather than a path parameter, and the columns it wants are not
/// documented anywhere — they come back from the matching export endpoint,
/// with this database's custom fields already in them.
/// </summary>
public partial class RequestView
{
    private bool JsonMode => FmtJson.IsChecked == true;

    private void SetUpImport()
    {
        SecBody.IsVisible = false;
        TxtBody.IsVisible = false;
        SecImport.IsVisible = true;

        // Only the names the server will actually accept, each labelled with
        // the directions it supports. Export-only entries are still listed:
        // the same picker drives the header fetch, and hiding them would make
        // the list look incomplete.
        CmbImportName.ItemsSource = _ctx.Catalog.ImportNames;

        // Avalonia has no DisplayMemberPath, and the direction is worth showing
        // anyway: an export-only name in the list is not a mistake, it is there
        // because the same picker drives the header fetch.
        CmbImportName.ItemTemplate = new FuncDataTemplate<ImportName>((n, _) =>
            new StackPanel
            {
                Orientation = Avalonia.Layout.Orientation.Horizontal,
                Spacing = 8,
                Children =
                {
                    new TextBlock { Text = n?.Name ?? "", FontSize = 12.5 },
                    new TextBlock
                    {
                        Text = n?.Direction ?? "",
                        FontSize = 10.5,
                        VerticalAlignment = Avalonia.Layout.VerticalAlignment.Center,
                        Foreground = Brand.Muted,
                    },
                },
            }, true);

        CmbImportName.SelectionChanged += async (_, _) =>
        {
            UpdateUrl();
            if (SelectedImportName().Length > 0) await FetchHeadersAsync(quiet: true);
        };

        FmtCsv.IsCheckedChanged += (_, _) => ApplyFormat();
        FmtJson.IsCheckedChanged += (_, _) => ApplyFormat();

        BtnFetchHeaders.Click += async (_, _) => await FetchHeadersAsync(quiet: false);
        BtnClearImport.Click += (_, _) => TxtImport.Clear();
        BtnClearFile.Click += (_, _) => ClearFile();

        // The whole zone is the button. A file drop is the fast path and a
        // click is the one people look for, so both land in the same place.
        DropZone.PointerReleased += async (_, _) => await BrowseAsync();

        DragDrop.SetAllowDrop(DropZone, true);
        DropZone.AddHandler(DragDrop.DragOverEvent, OnDragOver);
        DropZone.AddHandler(DragDrop.DropEvent, OnDrop);

        VarComplete.Attach(TxtImport, () => _ctx.Variables);

        ApplyFormat();
    }

    private string SelectedImportName() =>
        (CmbImportName.SelectedItem as ImportName)?.Name ?? "";

    /// <summary>
    /// Switching format converts what is already there rather than clearing it.
    ///
    /// The two are the same rows in different clothes, and someone who has
    /// pasted forty lines of CSV and then realised the endpoint wants JSON
    /// should not have to go and fetch them again.
    /// </summary>
    private void ApplyFormat()
    {
        var text = (TxtImport.Text ?? "").Trim();
        if (text.Length > 0)
        {
            try { TxtImport.Text = JsonMode ? ImportPayload.CsvToJson(text) : ImportPayload.JsonToCsv(text); }
            catch { /* not convertible; leave what is there rather than losing it */ }
        }

        TxtImportHint.Text = JsonMode
            ? "ONE OBJECT PER ROW, SENT AS application/json"
            : "HEADER ROW FIRST, THEN ONE ROW PER RECORD, SENT AS text/plain";

        UpdateUrl();
    }

    /// <summary>
    /// Ask the matching export endpoint what columns this type uses, and lay
    /// out a template row.
    ///
    /// The layouts are documented; what asking the server adds is THIS
    /// instance. The header row comes back with the custom fields this
    /// database actually has, which no general documentation can know about —
    /// so it is not merely a reference, it is what this server will accept.
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

        // Overwriting something typed, or a file just dropped, would be worse
        // than leaving the template unfilled.
        var typed = (TxtImport.Text ?? "").Trim().Length > 0;
        if (quiet && typed) return;
        if (!quiet && typed &&
            !await Confirm("Fetch headers",
                "Replace what is in the payload editor with a fresh header template?"))
            return;

        var exportName = _ctx.Catalog.HeaderNameFor(name);

        try
        {
            var r = await _ctx.Runner.SendAsync(_ctx.BaseUrl(), "GET",
                "/api/export/" + Uri.EscapeDataString(exportName) + "/header",
                [], [new("Accept", "text/csv")], null, "application/json", _ctx.Token());

            if (!r.Ok)
            {
                _ctx.Status("No headers for “" + exportName + "” (" + r.Status + "). "
                          + (name == exportName ? "This type may be import-only." : "Alias tried: " + exportName));
                return;
            }

            var headers = ImportPayload.HeadersFrom(r.Body);
            if (headers.Count == 0)
            {
                _ctx.Status("The server returned no header row for " + exportName + ".");
                return;
            }

            TxtImport.Text = ImportPayload.Template(headers, JsonMode);
            _ctx.Status("Laid out " + headers.Count + " column(s) for " + name + ".");
        }
        catch (Exception ex) { _ctx.Status("Could not fetch headers: " + ex.Message); }
    }

    // ── GETTING A FILE IN ───────────────────────────────────────────────

    // Avalonia 12 replaced the old DataObject with a DataTransfer of typed
    // formats, so a dropped file arrives as DataFormat.File rather than as a
    // string key called "Files".
    private void OnDragOver(object? sender, DragEventArgs e) =>
        e.DragEffects = e.DataTransfer.Contains(DataFormat.File)
            ? DragDropEffects.Copy
            : DragDropEffects.None;

    private async void OnDrop(object? sender, DragEventArgs e)
    {
        if (e.DataTransfer.TryGetFile() is not IStorageFile file) return;
        await LoadFileAsync(file);
    }

    private async Task BrowseAsync()
    {
        if (TopLevel.GetTopLevel(this) is not TopLevel top) return;

        var picked = await top.StorageProvider.OpenFilePickerAsync(new()
        {
            Title = "Choose an import file",
            AllowMultiple = false,
            FileTypeFilter =
            [
                new("Import files") { Patterns = ["*.csv", "*.txt", "*.json"] },
                new("All files") { Patterns = ["*"] },
            ],
        });

        if (picked.FirstOrDefault() is { } file) await LoadFileAsync(file);
    }

    /// <summary>
    /// Read a dropped or chosen file in, and set the format from what it
    /// actually contains rather than from its extension alone — a .txt holding
    /// a JSON array is still JSON, and sending it as text/plain fails with an
    /// error that says nothing about why.
    /// </summary>
    private async Task LoadFileAsync(IStorageFile file)
    {
        try
        {
            await using var stream = await file.OpenReadAsync();
            using var reader = new StreamReader(stream);
            var content = await reader.ReadToEndAsync();

            var json = file.Name.EndsWith(".json", StringComparison.OrdinalIgnoreCase)
                       || ImportPayload.LooksJson(content);

            FmtJson.IsChecked = json;
            FmtCsv.IsChecked = !json;

            // Set directly rather than through ApplyFormat: the file is already
            // in the right shape and converting it would be a round trip that
            // can only lose something.
            TxtImport.Text = json ? ApiRunner.Pretty(content) : content;

            TxtDrop.Text = file.Name + "  ·  " + Size(content);
            BtnClearFile.IsVisible = true;
            UpdateUrl();
        }
        catch (Exception ex) { _ctx.Status("Could not read that file: " + ex.Message); }
    }

    private void ClearFile()
    {
        TxtImport.Clear();
        TxtDrop.Text = "Drop a .csv, .txt or .json file here, or click to browse";
        BtnClearFile.IsVisible = false;
        UpdateUrl();
    }
}
