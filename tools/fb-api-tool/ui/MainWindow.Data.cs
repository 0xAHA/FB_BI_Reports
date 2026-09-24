using Avalonia;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Threading;
using Avalonia.VisualTree;

namespace FbApiTool.Ui;

/// <summary>
/// The Data tab: the schema browser beside the query pane.
///
/// The browser is not a convenience on top of completion — it is the other
/// half of it. Completion answers "what comes next" once you know the table;
/// the tree answers "which table", which is the question you actually have in
/// a 400-table schema you did not design.
/// </summary>
public partial class MainWindow
{
    private List<SchemaGroup> _schemaGroups = [];

    private void SetUpSchemaBrowser()
    {
        BtnSchemaRefresh.Click += async (_, _) =>
        {
            BtnSchemaRefresh.IsEnabled = false;
            TxtSchemaInfo.Text = "Reading the schema…";
            try { await LoadSchemaAsync(true); }
            finally { BtnSchemaRefresh.IsEnabled = true; RefreshSchemaTree(); }
        };

        // Filtering is over a list already in memory, so it can run on every
        // keystroke — no debounce to get wrong.
        TxtSchemaFilter.GetObservable(TextBox.TextProperty)
                       .Subscribe(new Sink(RefreshSchemaTree));

        TreeSchema.DoubleTapped += (_, e) =>
        {
            // The item the pointer is over, not the selected one: a double-tap
            // selects and fires together, and on the first click of a new row
            // SelectedItem has not caught up yet.
            var node = (e.Source as Visual)?.FindAncestorOfType<TreeViewItem>()?.DataContext
                       ?? TreeSchema.SelectedItem;

            var text = node switch
            {
                ColumnNode c => c.Insert,
                TableNode t => t.Insert,
                _ => null,
            };
            if (text is null) return;

            _dataView?.InsertSql(text);
            e.Handled = true;
        };

        BtnSchemaHide.Click += (_, _) => FoldSchema(false);
        BtnSchemaShow.Click += (_, _) => FoldSchema(true);

        // The endpoint list folds the same way. These were markup only — the
        // buttons were there and nothing was listening to them.
        BtnSidebarHide.Click += (_, _) => FoldSidebar(false);
        BtnSidebarShow.Click += (_, _) => FoldSidebar(true);

        RefreshSchemaTree();
    }

    /// <summary>Fold the schema browser away, and bring it back.</summary>
    private void FoldSchema(bool show) =>
        Fold(show, DataGridCols, SchemaBrowserPane, SchemaSplitter, BtnSchemaShow, 300);

    private void FoldSidebar(bool show) =>
        Fold(show, ReqGridCols, SidebarPane, SidebarSplitter, BtnSidebarShow, 330);

    /// <summary>
    /// Fold a side panel away and give its width to whatever is beside it.
    ///
    /// The column keeps a GUTTER rather than collapsing to nothing. A hidden
    /// child of a zero-width column has nowhere to draw, which is why the
    /// button that was supposed to bring the panel back was invisible and the
    /// panel could not be reopened at all. The gutter is also what makes the
    /// fold readable as a fold: a full-height strip is the panel, closed,
    /// where a panel that vanishes entirely just looks like a bug.
    /// </summary>
    private const double Gutter = 22;

    private static void Fold(bool show, Grid grid, Control pane, Control splitter,
                             Control reopen, double width)
    {
        var cols = grid.ColumnDefinitions;
        cols[0].Width = new GridLength(show ? width : Gutter);
        cols[1].Width = new GridLength(show ? 6 : 0);

        // MinWidth would hold the column open at its old size whatever the
        // width says, so it has to come down too.
        cols[0].MinWidth = show ? 0 : Gutter;

        pane.IsVisible = show;
        splitter.IsVisible = show;
        reopen.IsVisible = !show;
    }

    /// <summary>
    /// Rebuild the tree from the snapshot and the filter box.
    ///
    /// Rebuilt rather than filtered in place: a match on a column has to open
    /// the table that holds it and show only the columns that matched, which
    /// is a different tree, not a hidden subset of the same one.
    /// </summary>
    private void RefreshSchemaTree()
    {
        _schemaGroups = SchemaBrowser.Build(_schema, TxtSchemaFilter.Text);
        TreeSchema.ItemsSource = _schemaGroups;
        TxtSchemaInfo.Text = SchemaBrowser.Describe(_schema, _schemaGroups);
    }

    // ── THE WORKSPACE PANEL ─────────────────────────────────────────────

    /// <summary>
    /// Move the saved/variables/history panel to whichever tab is in front.
    ///
    /// Moved, not copied. Two panels would mean two lists of variables, and
    /// the one you were not looking at would be the one that was right.
    /// </summary>
    private void PlaceWorkspace()
    {
        var onData = ReferenceEquals(Shell.SelectedItem, TabData);
        var target = onData ? WorkHostData : WorkspaceBand;
        if (ReferenceEquals(Workspace.Parent, target)) return;

        WorkspaceBand.Child = null;
        WorkHostData.Child = null;
        target.Child = Workspace;
    }

    /// <summary>A minimal observer, so three subscriptions need no Rx package.</summary>
    private sealed class Sink(Action then) : IObserver<string?>
    {
        public void OnNext(string? value) => Dispatcher.UIThread.Post(then);
        public void OnCompleted() { }
        public void OnError(Exception error) { }
    }
}
