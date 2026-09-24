using Avalonia.Controls;

namespace FbApiTool.Ui;

/// <summary>
/// Kept data-query results, and the comparison between two of them.
///
/// A query run against a live database cannot be re-run to get the same
/// answer — the database has moved on. That is the whole reason for writing
/// one down, and the reason "what changed since this morning?" is a question
/// only this pane can answer.
/// </summary>
public partial class RequestView
{
    private bool KeepResults => ChkKeep.IsChecked == true;

    private void SetUpSaved()
    {
        ChkKeep.IsChecked = _ctx.Setting(Prefs.KeepResults) != "0";
        ChkKeep.IsCheckedChanged += (_, _) =>
            _ctx.SetSetting(Prefs.KeepResults, KeepResults ? "1" : "0");

        BtnSaved.Click += (_, _) =>
        {
            SavedPane.IsVisible = !SavedPane.IsVisible;
            if (SavedPane.IsVisible) RefreshRuns();
        };

        BtnRestoreRun.Click += (_, _) => RestoreRun();
        BtnCompareRun.Click += async (_, _) => await CompareRunAsync();
        BtnRenameRun.Click += async (_, _) => await RenameRunAsync();
        BtnDeleteRun.Click += async (_, _) => await DeleteRunAsync();
        BtnClearRuns.Click += async (_, _) => await ClearRunsAsync();

        LstRuns.DoubleTapped += (_, _) => LoadRun();
    }

    private QueryRun? SelectedRun => LstRuns.SelectedItem as QueryRun;

    private void RefreshRuns()
    {
        var runs = QueryHistory.List();
        LstRuns.ItemsSource = runs;
        TxtSavedCount.Text = runs.Count == 0
            ? "NOTHING KEPT YET"
            : runs.Count + (runs.Count == 1 ? " KEPT RESULT" : " KEPT RESULTS");
    }

    /// <summary>
    /// Write down a successful query, if keeping is on.
    ///
    /// Only successful ones, and only real result sets: a 400 carries an error
    /// message, not data, and keeping those would bury the runs worth
    /// comparing under the typos that produced them.
    /// </summary>
    private void KeepRun(ApiResult r)
    {
        if (_sqlParam is null || !KeepResults || !r.Ok) return;

        var sql = TxtSql.Text.Trim();
        if (sql.Length == 0) return;

        var rows = GridRows.ItemsSource?.Cast<object>().Count() ?? 0;
        QueryHistory.Save(_ctx.BaseUrl(), sql, r, rows);

        if (SavedPane.IsVisible) RefreshRuns();
    }

    private void RestoreRun()
    {
        if (SelectedRun is not { } run) { _ctx.Status("Pick a kept result first."); return; }

        TxtSql.Text = run.Sql;
        _ctx.Status("Query restored from " + run.When + ". It has not been re-run.");
    }

    /// <summary>Put a kept result back in the response pane, without re-running it.</summary>
    private void LoadRun()
    {
        if (SelectedRun is not { } run) return;

        var body = QueryHistory.Body(run.Id);
        if (body is null) { _ctx.Status("That result's body is no longer on disk."); return; }

        TxtRaw.Text = body;
        TxtPretty.Text = ApiRunner.Pretty(body);

        var table = ApiRunner.Tabulate(body);
        FillGrid(table.Columns, table.Rows);

        ChipStatus.IsVisible = true;
        TxtStatusCode.Text = run.Status.ToString();
        ChipStatus.Background = Brand.TintBlue;
        TxtStatusCode.Foreground = Brand.BlueAccent;
        TxtTiming.Text = "kept " + run.SavedAt.ToString("ddd d MMM HH:mm") + "  ·  "
                       + run.RowCount + " rows  ·  " + run.Millis + " ms";
        ChipLimit.IsVisible = false;

        Views.SelectedIndex = GridRows.Columns.Count > 0 ? 2 : 0;
        _ctx.Status("Showing the result kept at " + run.When + ".");
    }

    /// <summary>
    /// What moved between a kept result and the one on screen.
    ///
    /// The comparison goes in the table view, marked row by row, because the
    /// question is always about rows rather than about bytes — a text diff of
    /// two JSON documents answers a question nobody asked.
    /// </summary>
    private async Task CompareRunAsync()
    {
        if (SelectedRun is not { } run) { _ctx.Status("Pick a kept result to compare against."); return; }

        var saved = QueryHistory.Body(run.Id);
        if (saved is null) { await Tell("That result's body is no longer on disk."); return; }
        if (_last is null) { await Tell("Run the query first, so there is something to compare with."); return; }

        var a = ApiRunner.Tabulate(saved);
        var b = ApiRunner.Tabulate(_last.Body);

        if (a.Columns.Count == 0 || b.Columns.Count == 0)
        {
            await Tell("One of these is not a table of rows, so there is nothing to line up.");
            return;
        }

        var diff = QueryDiff.Compare(a.Columns, a.Rows, b.Columns, b.Rows,
                                     run.Label ?? run.When, "now");

        if (!diff.Any)
        {
            await Tell(diff.Summary + "\n\nNothing to show — the two results are the same.");
            return;
        }

        FillGrid(diff.Columns, diff.Rows);
        Views.SelectedIndex = 2;
        _ctx.Status(diff.Summary);
    }

    private async Task RenameRunAsync()
    {
        if (SelectedRun is not { } run) return;

        var name = await _ctx.Ask("Rename kept result", "A name you will recognise later",
                                  run.Label ?? "");
        if (name is null) return;

        QueryHistory.Rename(run.Id, name.Length == 0 ? null : name);
        RefreshRuns();
    }

    private async Task DeleteRunAsync()
    {
        if (SelectedRun is not { } run) return;
        if (!await Confirm("Delete kept result", "Delete the result kept at " + run.When + "?")) return;

        QueryHistory.Delete(run.Id);
        RefreshRuns();
    }

    private async Task ClearRunsAsync()
    {
        if (!await Confirm("Clear kept results",
                "Delete every kept result?\n\nThey cannot be re-run to get the same answer back.")) return;

        QueryHistory.Clear();
        RefreshRuns();
    }
}
