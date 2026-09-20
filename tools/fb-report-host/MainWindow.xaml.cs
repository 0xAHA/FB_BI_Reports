using System.Diagnostics;
using System.IO;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;

namespace FbReportHost;

public partial class MainWindow : Window
{
    private readonly FishbowlClient _fb = new();
    private LibraryNode? _root;

    private readonly string _settingsFile = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "FbReportHost", "settings.json");
    private JsonObject _settings = new();

    private double _treeWidth = 260;
    private const double LogHeight = 200;

    public MainWindow()
    {
        InitializeComponent();
        LoadSettingsFile();

        // A library report has no repo above it, so the shared assets have to
        // live here. Seed them from the checkout this exe is running inside, so
        // the common case needs no setup at all.
        if (!Library.SharedAssetsPresent)
        {
            var seeded = Library.SeedSharedFromOwnRepo();
            if (seeded.Count > 0) Log("seeded shared assets from this checkout: " + string.Join(", ", seeded), "success");
        }

        RefreshTree();
        RefreshSharedStatus();
        Log("library: " + Library.Root, "info");
        Log("NOTE: the Fishbowl client runs JxBrowser 8.12.2 (an older Chromium) than this host's " +
            "WebView2 — something that works here can still fail there.", "warning");

        _pinned = SettingGet("host:pinned") != "0";
        ApplyPinState();
        if (!_pinned) SetRail(collapsed: true);
        ClearDescription(null);

        RefreshAuthChip();
        // Sign-in is the first thing anyone does, so ask once the shell is up
        // rather than making them find a button.
        Loaded += async (_, _) => await ShowLoginAsync();
    }

    // ── LIBRARY TREE ────────────────────────────────────────────────────

    private void RefreshTree()
    {
        _root = Library.BuildTree();
        Tree.ItemsSource = new[] { _root };
    }

    private LibraryNode? Selected => Tree.SelectedItem as LibraryNode;

    /// <summary>The folder a new item belongs in: the selection, or its parent when a file is selected.</summary>
    private string TargetFolder()
    {
        var n = Selected;
        if (n is null) return Library.Root;
        return n.IsFolder ? n.FullPath : (Path.GetDirectoryName(n.FullPath) ?? Library.Root);
    }

    private void Tree_SelectedItemChanged(object sender, RoutedPropertyChangedEventArgs<object> e)
    {
        if (Selected is { IsFolder: false } n) { Status(n.FullPath); ShowDescription(n); }
        else ClearDescription(Selected);
    }

    /// <summary>
    /// The detail panel. A Deployed export carries a real "description" from
    /// Fishbowl; a source .htm has none, so its &lt;title&gt; stands in and the
    /// panel says where the text came from rather than implying parity.
    /// </summary>
    private void ShowDescription(LibraryNode n)
    {
        try
        {
            var info = ReportLoader.Peek(n.FullPath);
            TxtDescName.Text = info.Name;
            TxtDescKind.Text = info.Kind + "  ·  " + (info.Bytes / 1024.0).ToString("N0") + " KB";
            if (!string.IsNullOrWhiteSpace(info.Description))
            {
                TxtDescBody.Text = info.Description;
                TxtDescBody.FontStyle = FontStyles.Normal;
            }
            else
            {
                TxtDescBody.Text = info.Kind.StartsWith("Deployed", StringComparison.Ordinal)
                    ? "This export has no description."
                    : "No description — a source report carries none. Descriptions come from a Deployed export.";
                TxtDescBody.FontStyle = FontStyles.Italic;
            }
        }
        catch (Exception ex)
        {
            TxtDescName.Text = n.DisplayName;
            TxtDescKind.Text = "";
            TxtDescBody.Text = "Could not read this file: " + ex.Message;
            TxtDescBody.FontStyle = FontStyles.Italic;
        }
    }

    private void ClearDescription(LibraryNode? folder)
    {
        TxtDescName.Text = folder?.DisplayName ?? "";
        TxtDescKind.Text = folder is { IsFolder: true }
            ? folder.Children.Count(c => !c.IsFolder) + " report(s), " +
              folder.Children.Count(c => c.IsFolder) + " folder(s)"
            : "";
        TxtDescBody.Text = "Select a report to see its description.";
        TxtDescBody.FontStyle = FontStyles.Italic;
    }

    // ── PANE PIN / COLLAPSE ─────────────────────────────────────────────
    // Pinned (the default) keeps the pane open. Unpinned collapses it to the
    // rail as soon as a report opens — the Visual Studio auto-hide idea, which
    // is what buys back the width on a laptop screen.

    private bool _pinned = true;

    /// <summary>
    /// Unpinning takes effect NOW, the way it does in Visual Studio: the pane
    /// goes to the rail immediately and stays there between reports. Making it
    /// a purely deferred setting — nothing visibly happens until the next time
    /// a report opens — is what made the button read as broken.
    /// </summary>
    private void BtnPin_Click(object sender, RoutedEventArgs e)
    {
        _pinned = !_pinned;
        SettingSet("host:pinned", _pinned ? "1" : "0");
        ApplyPinState();
        SetRail(collapsed: !_pinned);
        Status(_pinned
            ? "Library pinned — it will stay open."
            : "Library unpinned — it collapses to the rail, and after each report you open.");
    }

    /// <summary>
    /// The pin needs to read as a toggle at a glance. Opacity alone did not:
    /// the two states were a shade apart. Unpinned now turns the pin on its
    /// side — the same cue Visual Studio uses — and drops the pressed tint.
    /// </summary>
    private void ApplyPinState()
    {
        foreach (var b in new[] { BtnPin, BtnRailPin })
        {
            b.Opacity = _pinned ? 1.0 : 0.5;
            b.LayoutTransform = _pinned ? Transform.Identity : new RotateTransform(90);
            b.Background = _pinned ? (Brush)FindResource("FbTint2") : Brushes.Transparent;
            b.ToolTip = _pinned
                ? "Pinned — the library stays open. Click to auto-hide it."
                : "Auto-hiding — the library collapses after you open a report. Click to pin it open.";
        }
    }

    private void BtnCollapseRail_Click(object sender, RoutedEventArgs e) => SetRail(true);
    private void BtnExpandRail_Click(object sender, RoutedEventArgs e) => SetRail(false);

    private void SetRail(bool collapsed)
    {
        if (collapsed)
        {
            if (ColTree.Width.Value > 0) _treeWidth = ColTree.Width.Value;
            ColTree.Width = new GridLength(0);
            ColRail.Width = new GridLength(30);
            TreePane.Visibility = Visibility.Collapsed;
            TreeSplitter.Visibility = Visibility.Collapsed;
            RailPane.Visibility = Visibility.Visible;
        }
        else
        {
            ColRail.Width = new GridLength(0);
            ColTree.Width = new GridLength(_treeWidth <= 0 ? 290 : _treeWidth);
            TreePane.Visibility = Visibility.Visible;
            TreeSplitter.Visibility = Visibility.Visible;
            RailPane.Visibility = Visibility.Collapsed;
        }
    }

    private async void Tree_MouseDoubleClick(object sender, MouseButtonEventArgs e)
    {
        if (Selected is { IsFolder: false } n) await OpenInTabAsync(n.FullPath);
    }

    private async void MnuOpen_Click(object sender, RoutedEventArgs e)
    {
        if (Selected is { IsFolder: false } n) await OpenInTabAsync(n.FullPath);
    }

    private async void MnuPopOut_Click(object sender, RoutedEventArgs e)
    {
        if (Selected is { IsFolder: false } n) await PopOutAsync(n.FullPath);
    }

    private void MnuRefresh_Click(object sender, RoutedEventArgs e) => RefreshTree();

    private void BtnExpandAll_Click(object sender, RoutedEventArgs e) => SetAllExpanded(true);
    private void BtnCollapseAll_Click(object sender, RoutedEventArgs e) => SetAllExpanded(false);

    /// <summary>
    /// Open or close every folder at once.
    ///
    /// Driven through the model rather than the TreeViewItem containers,
    /// because a collapsed branch has no containers realised — walking the
    /// visual tree would silently miss everything not already on screen, which
    /// is exactly the part you wanted expanded.
    ///
    /// The root stays open either way: collapsing it would leave the pane
    /// showing a single "Library" line and nothing else.
    /// </summary>
    private void SetAllExpanded(bool expanded)
    {
        if (_root is null) return;
        var folders = 0;
        Walk(_root);
        _root.IsExpanded = true;
        Status((expanded ? "Expanded " : "Collapsed ") + folders + " folder" + (folders == 1 ? "" : "s") + ".");

        void Walk(LibraryNode n)
        {
            foreach (var c in n.Children)
            {
                if (c.IsFolder) { c.IsExpanded = expanded; folders++; }
                Walk(c);
            }
        }
    }

    /// <summary>Grey out what does not apply to the right-clicked item.</summary>
    private void TreeMenu_Opened(object sender, RoutedEventArgs e)
    {
        var isFile = Selected is { IsFolder: false };
        MnuOpen.IsEnabled = isFile;
        MnuPopOut.IsEnabled = isFile;
        MnuImportHere.Header = Selected is { IsFolder: true, Name: var f } && Selected.FullPath != Library.Root
            ? "Import report into “" + f + "”…"
            : "Import report into this folder…";
    }

    private async void MnuImportHere_Click(object sender, RoutedEventArgs e)
    {
        var dlg = new Microsoft.Win32.OpenFileDialog
        {
            Title = "Import into " + TargetFolder(),
            Filter = "Fishbowl reports (*.htm;*.html;*.json)|*.htm;*.html;*.json|All files (*.*)|*.*",
            Multiselect = true,
        };
        if (dlg.ShowDialog(this) == true) await ImportManyAsync(dlg.FileNames, TargetFolder());
    }

    // ── TREE DRAG AND DROP ──────────────────────────────────────────────
    // Two different drags land on this tree:
    //   * an INTERNAL one (a LibraryNode) moves a report or folder;
    //   * an EXTERNAL one (FileDrop from Explorer) imports into the folder
    //     under the cursor, rather than the selected one.

    private Point _dragStart;
    private LibraryNode? _dragNode;
    private TreeViewItem? _dropHighlight;

    private void Tree_PreviewMouseLeftButtonDown(object sender, MouseButtonEventArgs e)
    {
        _dragStart = e.GetPosition(null);
        _dragNode = (ItemAt(e.OriginalSource as DependencyObject)?.DataContext) as LibraryNode;
    }

    private void Tree_PreviewMouseMove(object sender, MouseEventArgs e)
    {
        if (e.LeftButton != MouseButtonState.Pressed || _dragNode is null) return;
        if (_dragNode.FullPath == Library.Root) return;            // the root itself never moves
        var d = e.GetPosition(null) - _dragStart;
        if (Math.Abs(d.X) < SystemParameters.MinimumHorizontalDragDistance &&
            Math.Abs(d.Y) < SystemParameters.MinimumVerticalDragDistance) return;

        var node = _dragNode;
        _dragNode = null;
        DragDrop.DoDragDrop(Tree, new DataObject(typeof(LibraryNode), node), DragDropEffects.Move);
    }

    private void Tree_DragOver(object sender, DragEventArgs e)
    {
        var target = FolderNodeAt(e);
        ClearDropHighlight();

        if (e.Data.GetDataPresent(typeof(LibraryNode)))
        {
            var src = (LibraryNode)e.Data.GetData(typeof(LibraryNode))!;
            e.Effects = CanMove(src, target) ? DragDropEffects.Move : DragDropEffects.None;
        }
        else if (e.Data.GetDataPresent(DataFormats.FileDrop))
        {
            e.Effects = target is null ? DragDropEffects.None : DragDropEffects.Copy;
        }
        else e.Effects = DragDropEffects.None;

        if (e.Effects != DragDropEffects.None && target is not null)
        {
            _dropHighlight = ContainerFor(target);
            if (_dropHighlight is not null) _dropHighlight.Background = (Brush)FindResource("FbTint2");
        }
        e.Handled = true;
    }

    private void Tree_DragLeave(object sender, DragEventArgs e) => ClearDropHighlight();

    private async void Tree_Drop(object sender, DragEventArgs e)
    {
        ClearDropHighlight();
        var target = FolderNodeAt(e);
        if (target is null) return;
        e.Handled = true;                       // never let the window-level import also fire

        if (e.Data.GetDataPresent(typeof(LibraryNode)))
        {
            var src = (LibraryNode)e.Data.GetData(typeof(LibraryNode))!;
            if (!CanMove(src, target)) return;
            try
            {
                var dest = Path.Combine(target.FullPath, src.Name);
                if (src.IsFolder) Directory.Move(src.FullPath, dest);
                else
                {
                    // Moving onto a taken name would throw, and quietly picking
                    // either answer is wrong for the same reason it is on an
                    // import — so ask the same question.
                    if (File.Exists(dest))
                    {
                        var dlg = new ImportConflictWindow(src.FullPath, dest, 0) { Owner = this };
                        dlg.ShowDialog();
                        if (dlg.Choice is not { } how || how == Library.OnConflict.Skip) return;
                        if (how == Library.OnConflict.Overwrite) File.Delete(dest);
                        else
                        {
                            var i = 2;
                            while (File.Exists(dest))
                                dest = Path.Combine(target.FullPath,
                                    Path.GetFileNameWithoutExtension(src.Name) + " (" + i++ + ")" + Path.GetExtension(src.Name));
                        }
                    }
                    File.Move(src.FullPath, dest);
                }
                RefreshTree();
                Status("Moved " + src.Name + " to " + target.Name);
                Log("moved " + src.FullPath + " -> " + dest, "info");
            }
            catch (Exception ex) { Warn("Could not move: " + ex.Message); }
            return;
        }

        if (e.Data.GetData(DataFormats.FileDrop) is string[] files && files.Length > 0)
            await ImportManyAsync(files, target.FullPath);
    }

    /// <summary>A move is legal when it actually changes folder and does not nest a folder inside itself.</summary>
    private static bool CanMove(LibraryNode src, LibraryNode? target)
    {
        if (target is null || !target.IsFolder) return false;
        if (src.FullPath == Library.Root) return false;
        if (string.Equals(Path.GetDirectoryName(src.FullPath), target.FullPath, StringComparison.OrdinalIgnoreCase))
            return false;                                              // already there
        if (src.IsFolder &&
            (target.FullPath + Path.DirectorySeparatorChar)
                .StartsWith(src.FullPath + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
            return false;                                              // would nest inside itself
        return true;
    }

    /// <summary>The folder under the cursor — a file's parent counts, so dropping on a sibling works.</summary>
    private LibraryNode? FolderNodeAt(DragEventArgs e)
    {
        var item = ItemAt(Tree.InputHitTest(e.GetPosition(Tree)) as DependencyObject);
        if (item?.DataContext is not LibraryNode n) return _root;      // empty space = the root
        if (n.IsFolder) return n;
        var parent = Path.GetDirectoryName(n.FullPath);
        return parent is null ? _root : FindNode(_root, parent);
    }

    private static LibraryNode? FindNode(LibraryNode? from, string fullPath)
    {
        if (from is null) return null;
        if (string.Equals(from.FullPath, fullPath, StringComparison.OrdinalIgnoreCase)) return from;
        foreach (var c in from.Children)
        {
            var hit = FindNode(c, fullPath);
            if (hit is not null) return hit;
        }
        return null;
    }

    private static TreeViewItem? ItemAt(DependencyObject? src)
    {
        while (src is not null and not TreeViewItem) src = VisualTreeHelper.GetParent(src);
        return src as TreeViewItem;
    }

    private TreeViewItem? ContainerFor(LibraryNode node)
    {
        TreeViewItem? Walk(ItemsControl parent)
        {
            for (var i = 0; i < parent.Items.Count; i++)
            {
                if (parent.ItemContainerGenerator.ContainerFromIndex(i) is not TreeViewItem tvi) continue;
                if (ReferenceEquals(tvi.DataContext, node)) return tvi;
                var deeper = Walk(tvi);
                if (deeper is not null) return deeper;
            }
            return null;
        }
        return Walk(Tree);
    }

    private void ClearDropHighlight()
    {
        if (_dropHighlight is null) return;
        _dropHighlight.ClearValue(BackgroundProperty);
        _dropHighlight = null;
    }

    private void BtnNewFolder_Click(object sender, RoutedEventArgs e)
    {
        var name = Prompt("New folder", "Folder name:", "New folder");
        if (string.IsNullOrWhiteSpace(name)) return;
        try
        {
            Directory.CreateDirectory(Path.Combine(TargetFolder(), name.Trim()));
            RefreshTree();
            Status("Created " + name.Trim());
        }
        catch (Exception ex) { Warn("Could not create the folder: " + ex.Message); }
    }

    private void MnuRename_Click(object sender, RoutedEventArgs e)
    {
        if (Selected is not { } n || n.FullPath == Library.Root) return;
        var name = Prompt("Rename", "New name:", n.Name);
        if (string.IsNullOrWhiteSpace(name) || name == n.Name) return;
        try
        {
            var dest = Path.Combine(Path.GetDirectoryName(n.FullPath)!, name.Trim());
            if (n.IsFolder) Directory.Move(n.FullPath, dest); else File.Move(n.FullPath, dest);
            RefreshTree();
            Status("Renamed to " + name.Trim());
        }
        catch (Exception ex) { Warn("Could not rename: " + ex.Message); }
    }

    private void MnuDelete_Click(object sender, RoutedEventArgs e)
    {
        if (Selected is not { } n || n.FullPath == Library.Root) return;
        var what = n.IsFolder ? "the folder \"" + n.Name + "\" and everything in it" : "\"" + n.Name + "\"";
        if (MessageBox.Show(this, "Delete " + what + " from the library?\n\nThe original file this was " +
                            "imported from is not touched.", "Delete",
                            MessageBoxButton.OKCancel, MessageBoxImage.Warning) != MessageBoxResult.OK) return;
        try
        {
            if (n.IsFolder) Directory.Delete(n.FullPath, true); else File.Delete(n.FullPath);
            RefreshTree();
            Status("Deleted " + n.Name);
        }
        catch (Exception ex) { Warn("Could not delete: " + ex.Message); }
    }

    // ── SHARED ASSETS ───────────────────────────────────────────────────

    /// <summary>
    /// The state lives on the button's own tooltip now that the pane's command
    /// bar is icons only. Red when a CORE asset is missing — a missing extra
    /// (fb-mfg, xlsx, …) is only a problem for the reports that use it, and is
    /// reported per report at load time instead.
    /// </summary>
    private void RefreshSharedStatus()
    {
        var have = Library.SharedAssetFiles;
        var missing = Library.MissingSharedAssets.ToList();
        BtnShared.ToolTip = missing.Count == 0
            ? "Shared assets (" + have.Length + "): " + string.Join(", ", have)
            : "MISSING " + string.Join(" + ", missing) +
              " — library reports using them will not run. Click to import.";
        BtnShared.Foreground = missing.Count == 0
            ? (Brush)FindResource("FbText")
            : new SolidColorBrush(Color.FromRgb(0xC4, 0x30, 0x46));
    }

    private void BtnShared_Click(object sender, RoutedEventArgs e)
    {
        var have = Library.SharedAssetFiles;
        var haveTxt = have.Length > 0 ? string.Join(", ", have) : "(none yet)";

        var msg =
            "SHARED ASSETS\n\n" +
            "A report does not contain the shared code. It contains a directive — " +
            "{% Script fb-lib %} or {% Style fb-styles %} — and the Fishbowl server " +
            "substitutes the saved Script or Style at SAVE time. Outside Fishbowl this " +
            "host has to supply it, or the report hits its own \"fb-lib not loaded\" guard.\n\n" +
            "Currently available here:\n    " + haveTxt + "\n\n" +
            "HOW THE NAME MAPS TO A FILE\n" +
            "    {% Script  <name> %}  ->  <name>.js\n" +
            "    {% Style   <name> %}  ->  <name>.css\n" +
            "So a report using {% Script fb-mfg %} needs fb-mfg.js here. It is NOT just " +
            "fb-lib and fb-styles: this repo also references fb-mfg, xlsx, pdfjs and " +
            "pdfjs-worker, and a Script that only exists on the server has no file in the " +
            "repo at all — export or copy it in yourself.\n\n" +
            "WHERE THEY ARE LOOKED UP, in order:\n" +
            "    1. the scripts/ folder of a repo ABOVE the report (a report opened in " +
            "place picks up the working-tree copy you are editing);\n" +
            "    2. this shared folder (the only option for a report imported into the " +
            "library, which has no repo above it).\n\n" +
            "IMPORTING copies EVERY .js and .css out of the folder you pick, so adding a " +
            "new shared asset needs nothing here but a re-import.\n\n" +
            "UPDATING is a re-import — the copy is a cache, not a live link. After editing " +
            "fb-lib.js in the repo, re-import for library reports to see the change. " +
            "Reports opened in place always read the working tree, so they need no " +
            "re-import.\n\n" +
            "Pick the folder to import from now?";

        if (MessageBox.Show(this, msg, "Shared assets",
                            MessageBoxButton.OKCancel, MessageBoxImage.Information) != MessageBoxResult.OK)
            return;

        // A folder picker, not a file picker: everything in scripts/ comes in
        // together, so one dialog beats one per asset.
        var dlg = new Microsoft.Win32.OpenFolderDialog
        {
            Title = "Pick the folder holding the shared .js / .css (your FB_BI_Reports\\scripts)",
        };
        if (dlg.ShowDialog(this) != true) return;
        try
        {
            var copied = Library.ImportSharedFrom(dlg.FolderName);
            RefreshSharedStatus();
            if (copied.Count == 0)
            {
                Warn("That folder holds no .js or .css files (and neither does a scripts " +
                     "subfolder of it).\n\nPick your FB_BI_Reports\\scripts folder, or the repo root.");
                return;
            }
            Status("Imported " + copied.Count + " shared asset(s): " + string.Join(", ", copied));
            Log("shared assets imported from " + dlg.FolderName + ": " + string.Join(", ", copied), "success");
            ReloadOpenTabs();   // anything already open was rendered without them
        }
        catch (Exception ex) { Warn("Could not import the shared assets: " + ex.Message); }
    }

    private void BtnReveal_Click(object sender, RoutedEventArgs e)
    {
        Library.EnsureRoot();
        var target = Selected?.FullPath ?? Library.Root;
        try
        {
            Process.Start(new ProcessStartInfo("explorer.exe",
                File.Exists(target) ? "/select,\"" + target + "\"" : "\"" + target + "\"") { UseShellExecute = true });
        }
        catch (Exception ex) { Warn("Could not open Explorer: " + ex.Message); }
    }

    // ── IMPORT / OPEN ───────────────────────────────────────────────────

    private async void BtnImport_Click(object sender, RoutedEventArgs e)
    {
        var dlg = new Microsoft.Win32.OpenFileDialog
        {
            Title = "Import reports into the library",
            Filter = "Fishbowl reports (*.htm;*.html;*.json)|*.htm;*.html;*.json|All files (*.*)|*.*",
            Multiselect = true,
        };
        if (dlg.ShowDialog(this) != true) return;
        await ImportManyAsync(dlg.FileNames);
    }

    private async void BtnOpen_Click(object sender, RoutedEventArgs e)
    {
        var dlg = new Microsoft.Win32.OpenFileDialog
        {
            Title = "Open a report where it sits",
            Filter = "Fishbowl reports (*.htm;*.html;*.json)|*.htm;*.html;*.json|All files (*.*)|*.*",
        };
        if (dlg.ShowDialog(this) == true) await OpenInTabAsync(dlg.FileName);
    }

    /// <summary>
    /// Bring files in, asking about every name that is already taken.
    ///
    /// The whole list is flattened up front rather than imported as it is
    /// walked, so the "do the same for the remaining files" count on the
    /// conflict dialog is a real number, and dropping a folder of twelve
    /// re-exports costs three clicks rather than twelve.
    /// </summary>
    private async Task ImportManyAsync(IEnumerable<string> paths, string? destination = null)
    {
        var folder = destination ?? TargetFolder();

        // (source file, the folder it lands in)
        var queue = new List<(string Src, string Dest)>();
        foreach (var p in paths)
        {
            if (Directory.Exists(p))
            {
                // A dropped folder brings its reports in, one level deep —
                // enough for "here is the Custom\BrightSteel folder".
                var sub = Path.Combine(folder, Path.GetFileName(p));
                foreach (var f in Directory.GetFiles(p).Where(Library.IsReport)) queue.Add((f, sub));
            }
            else if (Library.IsReport(p)) queue.Add((p, folder));
            else Log("skipped (not a report): " + p, "warning");
        }

        string? last = null;
        int imported = 0, replaced = 0, kept = 0, skipped = 0;
        Library.OnConflict? forAll = null;
        var cancelled = false;

        for (var i = 0; i < queue.Count; i++)
        {
            var (src, dest) = queue[i];
            try
            {
                var how = Library.OnConflict.KeepBoth;
                if (Library.Collides(src, dest))
                {
                    if (forAll is { } remembered) how = remembered;
                    else
                    {
                        var dlg = new ImportConflictWindow(src, Path.Combine(dest, Path.GetFileName(src)),
                                                          RemainingCollisions(queue, i + 1)) { Owner = this };
                        dlg.ShowDialog();
                        // Cancel abandons the WHOLE import, not just this file.
                        if (dlg.Choice is not { } chosen) { cancelled = true; break; }
                        how = chosen;
                        if (dlg.ApplyToAll) forAll = chosen;
                    }
                }

                var written = Library.Import(src, dest, how);
                if (written is null)
                {
                    skipped++;
                    Log("skipped (already in the library): " + Path.GetFileName(src), "info");
                    continue;
                }

                last = written;
                imported++;
                if (how == Library.OnConflict.Overwrite) replaced++;
                else if (!string.Equals(Path.GetFileName(written), Path.GetFileName(src),
                                       StringComparison.OrdinalIgnoreCase)) kept++;
            }
            catch (Exception ex) { Log("import failed for " + src + ": " + ex.Message, "error"); }
        }

        RefreshTree();

        var parts = new List<string>();
        if (imported > 0) parts.Add("imported " + imported);
        if (replaced > 0) parts.Add(replaced + " replaced");
        if (kept > 0) parts.Add(kept + " kept alongside");
        if (skipped > 0) parts.Add(skipped + " skipped");
        Status(parts.Count == 0
            ? (cancelled ? "Import cancelled." : "Nothing imported.")
            : char.ToUpper(parts[0][0]) + parts[0][1..] +
              (parts.Count > 1 ? " (" + string.Join(", ", parts.Skip(1)) + ")" : "") +
              " into " + folder + (cancelled ? " — the rest was cancelled." : ""));

        if (last is not null && imported == 1) await OpenInTabAsync(last);
    }

    /// <summary>How many files still to come would also land on a taken name.</summary>
    private static int RemainingCollisions(List<(string Src, string Dest)> queue, int from)
    {
        var n = 0;
        for (var i = from; i < queue.Count; i++)
            if (Library.Collides(queue[i].Src, queue[i].Dest)) n++;
        return n;
    }

    private void Window_DragOver(object sender, DragEventArgs e)
    {
        e.Effects = e.Data.GetDataPresent(DataFormats.FileDrop) ? DragDropEffects.Copy : DragDropEffects.None;
        e.Handled = true;
    }

    private async void Window_Drop(object sender, DragEventArgs e)
    {
        if (e.Data.GetData(DataFormats.FileDrop) is string[] files && files.Length > 0)
            await ImportManyAsync(files);
    }

    // ── TABS ────────────────────────────────────────────────────────────

    private async Task OpenInTabAsync(string path)
    {
        // Already open? Focus it rather than opening a second copy.
        foreach (TabItem existing in Tabs.Items)
            if (existing.Tag as string == path)
            {
                existing.IsSelected = true;
                if (!_pinned) SetRail(collapsed: true);
                return;
            }

        var view = new ReportView();
        var tab = new TabItem { Content = view, Tag = path, Header = BuildTabHeader(ReportLoader.LabelFor(path), view) };
        Tabs.Items.Add(tab);
        tab.IsSelected = true;
        if (!_pinned) SetRail(collapsed: true);

        try
        {
            await view.InitAsync(_fb, Log, SettingGet, SettingSet, Status);
            view.PopOutRequested += async p => { CloseTabFor(p); await PopOutAsync(p); };
            view.Load(path);
            if (tab.Header is StackPanel sp && sp.Children[0] is TextBlock tb)
                tb.Text = view.ReportName;
        }
        catch (Exception ex)
        {
            Tabs.Items.Remove(tab);
            Warn("WebView2 could not start:\n\n" + ex.Message +
                 "\n\nInstall the Microsoft Edge WebView2 Runtime and try again.");
        }
    }

    /// <summary>Tab header with a close button — a TabControl gives you neither by default.</summary>
    private object BuildTabHeader(string title, ReportView view)
    {
        var sp = new StackPanel { Orientation = Orientation.Horizontal };
        sp.Children.Add(new TextBlock
        {
            Text = title, MaxWidth = 220, TextTrimming = TextTrimming.CharacterEllipsis,
            VerticalAlignment = VerticalAlignment.Center
        });
        var x = new Button
        {
            Content = "×", Width = 17, Height = 17, Padding = new Thickness(0),
            Margin = new Thickness(7, 0, 0, 0), FontSize = 12,
            BorderThickness = new Thickness(0), Background = Brushes.Transparent,
            ToolTip = "Close",
        };
        x.Click += (_, _) =>
        {
            foreach (TabItem t in Tabs.Items)
                if (ReferenceEquals(t.Content, view)) { view.Shutdown(); Tabs.Items.Remove(t); break; }
        };
        sp.Children.Add(x);
        return sp;
    }

    private void CloseTabFor(string path)
    {
        foreach (TabItem t in Tabs.Items)
            if (t.Tag as string == path)
            {
                (t.Content as ReportView)?.Shutdown();
                Tabs.Items.Remove(t);
                break;
            }
    }

    private async Task PopOutAsync(string path)
    {
        var win = new ReportWindow { Owner = null };
        win.Show();
        await win.OpenAsync(_fb, path, Log, SettingGet, SettingSet);
    }

    // ── PANEL TOGGLES ───────────────────────────────────────────────────

    private void BtnLog_Click(object sender, RoutedEventArgs e)
    {
        var showing = RowLog.Height.Value > 0;
        RowLog.Height = new GridLength(showing ? 0 : LogHeight);
        LogSplitter.Visibility = showing ? Visibility.Collapsed : Visibility.Visible;
    }

    /// <summary>
    /// Copy the log out. Honours a selection when there is one — the reason to
    /// open this panel is usually to send someone one failing call, not 400
    /// lines of successful queries.
    /// </summary>
    private void BtnLogCopy_Click(object sender, RoutedEventArgs e)
    {
        var sel = TxtLog.SelectedText;
        var text = string.IsNullOrEmpty(sel) ? TxtLog.Text : sel;
        if (string.IsNullOrWhiteSpace(text)) { Status("Nothing in the log to copy."); return; }
        try
        {
            // SetDataObject(copy: true) leaves the text on the clipboard after
            // the host exits; SetText does not.
            Clipboard.SetDataObject(text, true);
            var lines = text.Count(c => c == (char)10) + 1;
            Status("Copied " + lines + " log line" + (lines == 1 ? "" : "s") +
                   (string.IsNullOrEmpty(sel) ? "." : " (the selection)."));
        }
        catch (Exception ex)
        {
            // Another process can hold the clipboard open; that is not a crash.
            Status("Could not copy: " + ex.Message);
        }
    }

    private void BtnLogClear_Click(object sender, RoutedEventArgs e)
    {
        TxtLog.Clear();
        Status("Log cleared.");
    }

    private void MnuLogSelectAll_Click(object sender, RoutedEventArgs e)
    {
        TxtLog.Focus();
        TxtLog.SelectAll();
    }

    // ── SIGN IN (modal) ─────────────────────────────────────────────────

    /// <summary>Shown once at startup; the user may also re-open it from the strip.</summary>
    private async Task ShowLoginAsync()
    {
        var dlg = new LoginWindow(_fb, SettingGet("host:server"), SettingGet("host:user")) { Owner = this };
        dlg.ShowDialog();
        RefreshAuthChip();
        if (!dlg.SignedIn)
        {
            // No offline mode — every report reads live data, so the only
            // alternative to a session is closing the app.
            Application.Current.Shutdown();
            return;
        }
        var who = _fb.User?["userFullName"]?.ToString() ?? "";
        Status("Signed in as " + who + ".");
        Log("signed in — " + who + ", " + _fb.Rights.Count + " access rights", "success");
        SettingSet("host:server", _fb.BaseUrl);
        SettingSet("host:user", _fb.User?["userName"]?.ToString() ?? SettingGet("host:user") ?? "");
        ReloadOpenTabs();
        await Task.CompletedTask;
    }

    private async void BtnAuth_Click(object sender, RoutedEventArgs e)
    {
        if (_fb.IsLoggedIn)
        {
            await _fb.LogoutAsync();
            RefreshAuthChip();
            Status("Signed out.");
            Log("signed out", "info");
            return;
        }
        await ShowLoginAsync();
    }

    private void RefreshAuthChip()
    {
        if (_fb.IsLoggedIn)
        {
            TxtAuth.Text = (_fb.User?["userFullName"]?.ToString() ?? "Signed in") +
                           "  ·  " + _fb.Rights.Count + " rights";
            BtnAuth.Content = "Sign out";
        }
        else
        {
            TxtAuth.Text = "Not signed in";
            BtnAuth.Content = "Sign in";
        }
    }

    private void ReloadOpenTabs()
    {
        foreach (TabItem t in Tabs.Items)
            if (t.Content is ReportView v && v.ReportPath is string p) v.Load(p);
    }

    // ── SETTINGS FILE ───────────────────────────────────────────────────

    private string? SettingGet(string key) => _settings[key]?.GetValue<string>();

    private void SettingSet(string key, string value)
    {
        _settings[key] = value;
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(_settingsFile)!);
            File.WriteAllText(_settingsFile,
                _settings.ToJsonString(new JsonSerializerOptions { WriteIndented = true }));
        }
        catch { /* a harness must not fall over because it cannot persist */ }
    }

    private void LoadSettingsFile()
    {
        try
        {
            if (File.Exists(_settingsFile))
                _settings = JsonNode.Parse(File.ReadAllText(_settingsFile))?.AsObject() ?? new JsonObject();
        }
        catch { _settings = new JsonObject(); }
        // server/user are handed to the login modal rather than shown on a bar
    }

    // ── SMALL UI HELPERS ────────────────────────────────────────────────

    private void Log(string message, string kind)
    {
        Dispatcher.Invoke(() =>
        {
            var tag = kind switch
            {
                "error" => "ERR ", "warning" => "WARN", "success" => "OK  ", "query" => "SQL ", _ => "    "
            };
            TxtLog.AppendText($"{DateTime.Now:HH:mm:ss}  {tag}  {message}{Environment.NewLine}");
            TxtLog.ScrollToEnd();
        });
    }

    private void Status(string s) => Dispatcher.Invoke(() => TxtStatus.Text = s);
    private void Warn(string s) => MessageBox.Show(this, s, "Report Host", MessageBoxButton.OK, MessageBoxImage.Warning);

    /// <summary>A one-line input box. WPF ships no InputBox, and a whole dialog for this is overkill.</summary>
    private string? Prompt(string title, string label, string initial)
    {
        var w = new Window
        {
            Title = title, Width = 380, SizeToContent = SizeToContent.Height,
            WindowStartupLocation = WindowStartupLocation.CenterOwner, Owner = this,
            ResizeMode = ResizeMode.NoResize, ShowInTaskbar = false,
        };
        var panel = new StackPanel { Margin = new Thickness(14) };
        panel.Children.Add(new TextBlock { Text = label, Margin = new Thickness(0, 0, 0, 6) });
        var box = new TextBox { Text = initial, Padding = new Thickness(4, 3, 4, 3) };
        box.SelectAll();
        panel.Children.Add(box);
        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right,
            Margin = new Thickness(0, 12, 0, 0)
        };
        var ok = new Button { Content = "OK", IsDefault = true, MinWidth = 72, Margin = new Thickness(0, 0, 6, 0) };
        var cancel = new Button { Content = "Cancel", IsCancel = true, MinWidth = 72 };
        ok.Click += (_, _) => { w.DialogResult = true; };
        row.Children.Add(ok); row.Children.Add(cancel);
        panel.Children.Add(row);
        w.Content = panel;
        box.Focus();
        return w.ShowDialog() == true ? box.Text : null;
    }

    protected override async void OnClosed(EventArgs e)
    {
        foreach (TabItem t in Tabs.Items) (t.Content as ReportView)?.Shutdown();
        try { await _fb.LogoutAsync(); } catch { /* shutting down anyway */ }
        base.OnClosed(e);
    }
}
