using System.Collections.ObjectModel;
using Avalonia.Controls;
using Avalonia.Interactivity;

namespace FbApiTool.Ui;

/// <summary>One saved request, as the list shows it.</summary>
public sealed record SavedRow(SavedRequest Request)
{
    public string Name => Request.Name;
    public string Summary => Request.Method + " " + Request.Path;
}

/// <summary>
/// The workspace band: saved requests, variables and history.
///
/// All three are things reached for while composing a request rather than
/// while reading a response, which is why they sit under the endpoint list
/// rather than beside the output.
/// </summary>
public partial class MainWindow
{
    private readonly ObservableCollection<SavedRow> _saved = [];

    private void SetUpWorkspace()
    {
        LstSaved.ItemsSource = _saved;
        GridVars.ItemsSource = _vars;
        LstHistory.ItemsSource = _history;

        LoadSaved();

        BtnOpenSaved.Click += (_, _) => OpenSaved();
        LstSaved.DoubleTapped += (_, _) => OpenSaved();
        BtnRenameSaved.Click += async (_, _) => await RenameSavedAsync();

        BtnAddVar.Click += (_, _) => _vars.Add(new Variable());
        BtnClearVars.Click += async (_, _) => await ClearVarsAsync();
        GridVars.CellEditEnded += (_, _) => Variables.Save(_vars);

        // Double-click, not single: a history list is scrolled through to find
        // something, and opening a tab on every arrow key would be unusable.
        LstHistory.DoubleTapped += (_, _) => ReopenHistory();

        BtnClearHist.Click += (_, _) => _history.Clear();

        // The band's height is dragged to taste; put it back where it was.
        if (double.TryParse(Get("workspaceHeight"), out var h) && h >= 90)
            WorkspaceBand.Height = h;

        WorkspaceBand.PropertyChanged += (_, e) =>
        {
            if (e.Property == HeightProperty && WorkspaceBand.Height >= 90)
                Set("workspaceHeight", WorkspaceBand.Height.ToString("0"));
        };
    }

    // ── SAVED ───────────────────────────────────────────────────────────

    private void LoadSaved()
    {
        _saved.Clear();
        foreach (var r in SavedRequests.Load()) _saved.Add(new SavedRow(r));
    }

    private void OpenSaved()
    {
        if (LstSaved.SelectedItem is not SavedRow row) { TxtStatus.Text = "Select a saved request first."; return; }

        var ep = _catalog.Endpoints.FirstOrDefault(e => e.Id == row.Request.EndpointId)
                 ?? _catalog.Endpoints.FirstOrDefault(e =>
                        e.Method.Equals(row.Request.Method, StringComparison.OrdinalIgnoreCase) &&
                        e.Path == row.Request.Path);

        if (ep is null)
        {
            TxtStatus.Text = "That endpoint is no longer in the catalog.";
            return;
        }

        OpenEndpoint(ep);
        if (Tabs.SelectedItem is TabItem { Content: RequestView v }) v.LoadFrom(row.Request);
        TxtStatus.Text = "Opened “" + row.Request.Name + "”.";
    }

    private async Task RenameSavedAsync()
    {
        if (LstSaved.SelectedItem is not SavedRow row) { TxtStatus.Text = "Select a saved request first."; return; }

        var name = await Dialogs.AskAsync(this, "Rename", "A new name for this request:", row.Request.Name);
        if (string.IsNullOrWhiteSpace(name)) return;

        row.Request.Name = name.Trim();
        SavedRequests.Put(row.Request);
        LoadSaved();
    }

    /// <summary>
    /// The X on a saved row. This one asks: a saved request is something
    /// somebody built and named, and there is no undo for it.
    /// </summary>
    /// <summary>
    /// Drop one variable.
    ///
    /// Not confirmed, unlike a saved request: a variable is a value someone
    /// captured a minute ago and can capture again, and a dialog for each one
    /// makes tidying up a list of eight a chore. Clear all still asks.
    /// </summary>
    private void KillVar(object? sender, RoutedEventArgs e)
    {
        if (sender is not Control { Tag: Variable v }) return;

        _vars.Remove(v);
        Variables.Save(_vars);
        TxtStatus.Text = "Removed {{" + v.Name + "}}.";
    }

    private async void KillSaved(object? sender, RoutedEventArgs e)
    {
        if (sender is not Control { Tag: SavedRequest r }) return;

        if (!await Dialogs.ConfirmAsync(this, "Fishbowl API Tool",
                "Delete the saved request “" + r.Name + "”?", "Delete", "Keep")) return;

        SavedRequests.Remove(r.Id);
        LoadSaved();
        TxtStatus.Text = "Deleted “" + r.Name + "”.";
    }

    // ── VARIABLES ───────────────────────────────────────────────────────

    /// <summary>
    /// Clearing them all does ask. A variable is cheap to retype, but a list
    /// of them is a session's worth of captured ids.
    /// </summary>
    private async Task ClearVarsAsync()
    {
        if (_vars.Count == 0) return;

        if (!await Dialogs.ConfirmAsync(this, "Fishbowl API Tool",
                "Remove all " + _vars.Count + " variable(s)?", "Remove", "Keep")) return;

        _vars.Clear();
        Variables.Save(_vars);
    }

    // ── HISTORY ─────────────────────────────────────────────────────────

    /// <summary>
    /// Put a past call back in a tab, filled in.
    ///
    /// Matched to a catalogued endpoint by method and shape rather than by the
    /// exact URL, because the URL has its path parameters already substituted —
    /// /api/parts/42 has to find the endpoint whose path is /api/parts/{id}.
    /// </summary>
    private void ReopenHistory()
    {
        if (LstHistory.SelectedItem is not HistoryEntry h) return;

        var (_, path, query) = ApiRunner.SplitUrl(h.Url, _fb.BaseUrl);

        var ep = _catalog.Endpoints
            .Where(e => e.Method.Equals(h.Method, StringComparison.OrdinalIgnoreCase))
            .Where(e => PathMatches(e.Path, path))
            // The most specific match: /api/parts/{id} beats /api/parts when
            // both fit, because the one with more literal segments is the one
            // that was actually called.
            .OrderByDescending(e => e.Path.Count(c => c == '/'))
            .ThenBy(e => e.Path.Count(c => c == '{'))
            .FirstOrDefault();

        if (ep is null) { TxtStatus.Text = "No catalogued endpoint matches " + h.Method + " " + path + "."; return; }

        OpenEndpoint(ep);
        if (Tabs.SelectedItem is TabItem { Content: RequestView v })
            v.LoadFrom(ep, path, query, h.Body);

        TxtStatus.Text = "Reopened " + h.Method + " " + path + ".";
    }

    /// <summary>Does a called path fit a catalogued template with {placeholders}?</summary>
    private static bool PathMatches(string template, string actual)
    {
        var t = template.Split('/', StringSplitOptions.RemoveEmptyEntries);
        var a = actual.Split('/', StringSplitOptions.RemoveEmptyEntries);
        if (t.Length != a.Length) return false;

        for (var i = 0; i < t.Length; i++)
        {
            if (t[i].StartsWith('{')) continue;             // a parameter matches anything
            if (!t[i].Equals(a[i], StringComparison.OrdinalIgnoreCase)) return false;
        }
        return true;
    }
}
