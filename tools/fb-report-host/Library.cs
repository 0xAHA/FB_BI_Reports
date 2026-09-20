using System.Collections.ObjectModel;
using System.ComponentModel;
using System.IO;

namespace FbReportHost;

/// <summary>
/// The on-disk report library: an ordinary folder tree under
/// %LOCALAPPDATA%\FbReportHost\Library. Deliberately plain folders and files
/// rather than a database — the whole point is that a user can rearrange it in
/// Explorer, sync it, or hand a folder to a colleague, and the app just picks
/// the change up.
///
/// Importing COPIES the file in. The original stays where it is, so importing a
/// report out of the git working tree never risks the repo copy.
/// </summary>
public static class Library
{
    public static string Root { get; } = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "FbReportHost", "Library");

    /// <summary>
    /// Where fb-lib.js / fb-styles.css live for the library's own reports.
    ///
    /// This has to exist because a report only carries a DIRECTIVE, not the
    /// shared code — the Fishbowl server substitutes it at save time. A report
    /// opened in the repo can have the directive resolved by walking up to
    /// scripts/, but a report COPIED into the library has no repo above it, so
    /// without a copy of the shared assets here every such report dies on its
    /// own "fb-lib not loaded" guard.
    /// </summary>
    public static string SharedDir => Path.Combine(Root, "_shared");

    /// <summary>
    /// The two every report in this suite uses. NOT the whole set — a report
    /// may name any Script or Style saved on the server, and this repo alone
    /// references fb-mfg, xlsx, pdfjs and pdfjs-worker as well. These two are
    /// only what the startup seed and the "are we set up?" indicator look for.
    /// </summary>
    public static readonly string[] CoreAssets = ["fb-lib.js", "fb-styles.css"];

    /// <summary>Everything currently in _shared, whatever it is called.</summary>
    public static string[] SharedAssetFiles =>
        Directory.Exists(SharedDir)
            ? Directory.GetFiles(SharedDir)
                       .Where(f => IsAsset(f))
                       .Select(Path.GetFileName)
                       .OrderBy(n => n, StringComparer.OrdinalIgnoreCase)
                       .ToArray()!
            : [];

    public static bool IsAsset(string path)
    {
        var e = Path.GetExtension(path).ToLowerInvariant();
        return e is ".js" or ".css";
    }

    public static bool SharedAssetsPresent =>
        CoreAssets.All(a => File.Exists(Path.Combine(SharedDir, a)));

    public static IEnumerable<string> MissingSharedAssets =>
        CoreAssets.Where(a => !File.Exists(Path.Combine(SharedDir, a)));

    public static void EnsureRoot()
    {
        Directory.CreateDirectory(Root);
        Directory.CreateDirectory(SharedDir);
        var starter = Path.Combine(Root, "Imported");
        if (!Directory.Exists(starter) &&
            Directory.GetDirectories(Root).Count(d => !d.EndsWith("_shared")) == 0)
            Directory.CreateDirectory(starter);
    }

    /// <summary>Copy one shared asset in, overwriting — this is a cache, not a library of versions.</summary>
    public static void ImportSharedAsset(string sourcePath)
    {
        Directory.CreateDirectory(SharedDir);
        File.Copy(sourcePath, Path.Combine(SharedDir, Path.GetFileName(sourcePath)), overwrite: true);
    }

    /// <summary>
    /// Copy EVERY .js and .css out of a folder into _shared, overwriting.
    ///
    /// Deliberately not a fixed list: a report can name any Script or Style
    /// saved on the Fishbowl server, and this repo already references fb-mfg,
    /// xlsx, pdfjs and pdfjs-worker beyond the two core files. Taking whatever
    /// is in the folder means a new shared asset needs no code change here.
    ///
    /// Accepts either the repo root or the scripts folder itself, since both
    /// are things a user might reasonably pick.
    /// </summary>
    public static List<string> ImportSharedFrom(string folder)
    {
        var copied = new List<string>();
        foreach (var dir in new[] { Path.Combine(folder, "scripts"), folder })
        {
            if (!Directory.Exists(dir)) continue;
            foreach (var src in Directory.GetFiles(dir).Where(IsAsset))
            {
                var name = Path.GetFileName(src);
                if (copied.Contains(name)) continue;       // scripts/ wins over the root
                ImportSharedAsset(src);
                copied.Add(name);
            }
        }
        return copied;
    }

    /// <summary>
    /// Seed the shared assets from the repo this executable is sitting inside,
    /// if it is. Makes a fresh install work immediately for anyone running it
    /// out of the checkout, without hunting for the folder by hand.
    /// </summary>
    public static List<string> SeedSharedFromOwnRepo()
    {
        var d = new DirectoryInfo(AppContext.BaseDirectory);
        while (d is not null)
        {
            var scripts = Path.Combine(d.FullName, "scripts");
            if (File.Exists(Path.Combine(scripts, "fb-lib.js"))) return ImportSharedFrom(scripts);
            d = d.Parent;
        }
        return [];
    }

    public static bool IsReport(string path)
    {
        var e = Path.GetExtension(path).ToLowerInvariant();
        return e is ".htm" or ".html" or ".json";
    }

    /// <summary>What to do when the destination already holds a file of that name.</summary>
    public enum OnConflict
    {
        /// <summary>Keep both — the new one lands as "Report (2).htm".</summary>
        KeepBoth,
        /// <summary>Replace the existing file in place, keeping its name.</summary>
        Overwrite,
        /// <summary>Leave the library alone and import nothing.</summary>
        Skip,
    }

    /// <summary>Would importing this file land on top of something already there?</summary>
    public static bool Collides(string sourcePath, string targetFolder) =>
        File.Exists(Path.Combine(targetFolder, Path.GetFileName(sourcePath)));

    /// <summary>
    /// Copy a report into <paramref name="targetFolder"/>.
    ///
    /// The caller decides what a name collision means, because only the user
    /// knows: dragging in a newer export of a report you already have is an
    /// UPDATE, while dragging in a different report that happens to share a
    /// filename is a second report. Guessing either way loses work — silently
    /// suffixing leaves stale duplicates in the tree, and silently overwriting
    /// destroys the copy already imported.
    ///
    /// Returns the path written, or null if the import was skipped.
    /// </summary>
    public static string? Import(string sourcePath, string targetFolder,
                                 OnConflict onConflict = OnConflict.KeepBoth)
    {
        Directory.CreateDirectory(targetFolder);
        var name = Path.GetFileName(sourcePath);
        var dest = Path.Combine(targetFolder, name);

        if (File.Exists(dest))
        {
            switch (onConflict)
            {
                case OnConflict.Skip:
                    return null;
                case OnConflict.Overwrite:
                    // Same path on both sides means the user dragged a library
                    // file back onto its own folder; copying it over itself throws.
                    if (string.Equals(Path.GetFullPath(sourcePath), Path.GetFullPath(dest),
                                      StringComparison.OrdinalIgnoreCase)) return dest;
                    File.Copy(sourcePath, dest, overwrite: true);
                    return dest;
                default:
                    var i = 2;
                    while (File.Exists(dest))
                    {
                        dest = Path.Combine(targetFolder,
                            Path.GetFileNameWithoutExtension(name) + " (" + i++ + ")" + Path.GetExtension(name));
                    }
                    break;
            }
        }

        File.Copy(sourcePath, dest);
        return dest;
    }

    public static LibraryNode BuildTree()
    {
        EnsureRoot();
        var root = new LibraryNode(Root, true) { Name = "Library" };
        Populate(root);
        root.IsExpanded = true;
        return root;
    }

    private static void Populate(LibraryNode node)
    {
        node.Children.Clear();
        DirectoryInfo di;
        try { di = new DirectoryInfo(node.FullPath); } catch { return; }
        if (!di.Exists) return;

        foreach (var d in di.GetDirectories().OrderBy(d => d.Name, StringComparer.OrdinalIgnoreCase))
        {
            // _shared is plumbing, not content — it would only invite someone
            // to open fb-lib.js as though it were a report.
            if (string.Equals(d.FullName, SharedDir, StringComparison.OrdinalIgnoreCase)) continue;
            var child = new LibraryNode(d.FullName, true) { Name = d.Name };
            Populate(child);
            node.Children.Add(child);
        }
        foreach (var f in di.GetFiles().Where(f => IsReport(f.FullName))
                            .OrderBy(f => f.Name, StringComparer.OrdinalIgnoreCase))
        {
            node.Children.Add(new LibraryNode(f.FullName, false) { Name = f.Name });
        }
    }
}

public sealed class LibraryNode(string fullPath, bool isFolder) : INotifyPropertyChanged
{
    public string FullPath { get; } = fullPath;
    public bool IsFolder { get; } = isFolder;
    /// <summary>The real filename — what rename and move operate on.</summary>
    public string Name { get; set; } = Path.GetFileName(fullPath);

    /// <summary>
    /// What the tree shows — deliberately NOT the filename.
    ///
    /// A Deployed export is identified by the name inside its envelope ("- Auto
    /// PO"); the file it happens to sit in ("- Auto PO-Page.json") is an
    /// artefact of the exporter's naming scheme and is not what anyone calls the
    /// report. For a source .htm there is no envelope, so the filename minus its
    /// extension is the best available label — every entry here is a report, so
    /// ".htm" on all of them is noise and the glyph already distinguishes them.
    /// </summary>
    public string DisplayName => IsFolder ? Name : ReportLoader.LabelFor(FullPath);

    public ObservableCollection<LibraryNode> Children { get; } = new();

    /// <summary>A Deployed export is JSON; a source report is HTML. Worth showing.</summary>
    public string Glyph => IsFolder ? "📁"
        : Path.GetExtension(FullPath).Equals(".json", StringComparison.OrdinalIgnoreCase) ? "📦"
        : "📄";

    private bool _expanded;
    public bool IsExpanded
    {
        get => _expanded;
        set { _expanded = value; PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(IsExpanded))); }
    }

    private bool _selected;
    public bool IsSelected
    {
        get => _selected;
        set { _selected = value; PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(IsSelected))); }
    }

    public event PropertyChangedEventHandler? PropertyChanged;
}
