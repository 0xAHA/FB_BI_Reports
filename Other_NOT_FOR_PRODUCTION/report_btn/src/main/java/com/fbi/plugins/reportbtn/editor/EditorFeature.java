package com.fbi.plugins.reportbtn.editor;

import com.evnt.client.modules.biscripteditor.dialog.UploadScriptDialog;
import com.evnt.common.swing.swingutil.JXSplitButton;
import com.fbi.fbdata.bi.BiScriptFpo;
import com.fbi.gui.button.FBMainToolbarButton;
import com.fbi.plugins.reportbtn.WorkspaceExtension;
import com.fbi.plugins.reportbtn.WorkspaceHost;
import com.fbi.sdk.constants.bi.BiScriptTypeConst;

import javax.swing.Icon;
import javax.swing.ImageIcon;
import javax.swing.JMenuItem;
import javax.swing.JPopupMenu;
import javax.swing.JToolBar;
import javax.swing.SwingUtilities;
import java.awt.Component;
import java.net.URL;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.function.Consumer;

/**
 * The page editor (proof of concept): a WorkspaceExtension the Apps (beta) module
 * finds by class name. Delete this package (and its test package) to remove it;
 * or build with ./build.sh --no-editor.
 *
 * Entry points: the workspace toolbar's Edit (the selected report's page), New
 * (an app, script, style or template) and Import, the App Library's pencil
 * (openModule('Apps (beta)', 'edit:<id>'), shown when window.FB_WORKSPACE.edit is
 * true), "Open in the editor" on an include, and the explorer on the left of every
 * editor tab. Each record opens in one editor tab.
 */
public final class EditorFeature implements WorkspaceExtension {

    private WorkspaceHost host;
    private ScriptService service;
    private IndexCache indexes;
    private FBMainToolbarButton btnEdit;
    private List<ScriptService.Includable> includables;
    private AppExplorer explorer;
    private List<ScriptService.Entry> catalog;

    public EditorFeature() {
        // found and built by ReportWorkspacePlugin.loadExtension
    }

    // ---------------------------------------------------------------- WorkspaceExtension
    @Override
    public void install(WorkspaceHost host, JToolBar toolbar) {
        this.host = host;
        this.service = new ScriptService(host);
        this.indexes = new IndexCache(host);
        toolbar.add(WorkspaceHost.ribbonSeparator());
        btnEdit = button("Edit", "/toolbar/edit24.png", "Edit this app: HTML, JS and CSS", this::editSelected);
        toolbar.add(btnEdit);
        // New is a split button, as in the BI Editor: the button makes an app, its arrow offers the rest.
        JPopupMenu newMenu = new JPopupMenu();
        menuItem(newMenu, "App…", "From a template, with its folder, Apps menus and access", this::newPage);
        menuItem(newMenu, "Script", "A shared JavaScript module apps include", () -> newRecord(BiScriptTypeConst.SCRIPT));
        menuItem(newMenu, "Style", "A shared stylesheet apps include", () -> newRecord(BiScriptTypeConst.STYLE));
        menuItem(newMenu, "Template", "A page other apps start from", () -> newRecord(BiScriptTypeConst.TEMPLATE));
        JXSplitButton btnNew = new JXSplitButton("New", icon("/toolbar/add24.png", 24), newMenu);
        btnNew.setToolTipText("New app (the arrow: a script, style or template)");
        btnNew.setButtonSize(new java.awt.Dimension(55, 40));
        btnNew.addActionListener(e -> newPage());
        toolbar.add(btnNew);
        toolbar.add(button("Import", "/toolbar/upload24.png", "Import apps, scripts and styles from files "
            + "(the BI Editor's own Import)", this::importFiles));
        btnEdit.setEnabled(false);
    }

    @Override
    public void edit(WorkspaceHost.ReportRef report) {
        if (!mayView()) {
            return;
        }
        for (EditorTab t : host.tabs(EditorTab.class)) {
            if (t.showsReport(report.id)) {
                host.select(t);
                return;
            }
        }
        try {
            ScriptService.ReportBundle b = service.loadReport(report.id);
            if (b.script == null) {
                host.showError("\"" + report.name + "\" has no page to edit.");
                return;
            }
            EditorTab open = tabFor(b.script.getId());
            if (open != null) {
                host.select(open);
                return;
            }
            BiScriptFpo script = service.getScript(b.script.getId());
            show(new EditorTab(this, script, service.reportsFor(script.getId()), report.id, null));
        } catch (ScriptService.ServiceException e) {
            host.showError(e.getMessage());
        }
    }

    @Override
    public Map<String, Boolean> workspaceFlags(int reportId) {
        Map<String, Boolean> flags = new LinkedHashMap<>();
        flags.put("edit", ClientRights.mayEdit(host));
        // The Report Builder may publish from this host.
        flags.put("publish", true);
        return flags;
    }

    @Override
    public void build(String verb, String arg) {
        if ("publish".equals(verb)) {
            BuilderPublisher.publish(this, arg);
        } else {
            host.showError("The Report Builder asked for something this version doesn't do (" + verb + ").");
        }
    }

    @Override
    public void selectionChanged(Component selected) {
        if (btnEdit != null) {
            btnEdit.setEnabled(host.selectedReport() != null);
        }
        if (selected instanceof EditorTab) {
            EditorTab tab = (EditorTab) selected;
            AppExplorer x = explorer();
            tab.attachExplorer(x);   // one explorer, in whichever editor tab shows
            revealLater(tab.scriptId());
        }
    }

    /** Selects the record in the explorer once it is laid out in its new tab. */
    private void revealLater(int scriptId) {
        if (explorer != null && scriptId > 0) {
            SwingUtilities.invokeLater(() -> explorer.reveal(scriptId));
        }
    }

    @Override
    public boolean checkForSave() {
        for (EditorTab t : host.tabs(EditorTab.class)) {
            if (t.isDirty() && !t.confirmClose()) {
                return false;
            }
        }
        return true;
    }

    // ---------------------------------------------------------------- entry points
    private void editSelected() {
        WorkspaceHost.ReportRef r = host.selectedReport();
        if (r != null) {
            edit(r);
        }
    }

    void openScript(ScriptService.Includable include) {
        if (!mayView()) {
            return;
        }
        EditorTab open = tabFor(include.id);
        if (open != null) {
            host.select(open);
            return;
        }
        try {
            BiScriptFpo script = service.getScript(include.id);
            show(new EditorTab(this, script, service.reportsFor(script.getId()), 0, null));
        } catch (ScriptService.ServiceException e) {
            host.showError(e.getMessage());
        }
    }

    /** A new, unsaved script, style or template, as the BI Editor's New menu makes them. */
    private void newRecord(BiScriptTypeConst type) {
        if (!ClientRights.mayEdit(host)) {
            host.showError("Creating a " + type.getName().toLowerCase(Locale.ROOT) + " needs the BI Editor-Edit right.");
            return;
        }
        BiScriptFpo fpo = new BiScriptFpo();   // id -1: new
        fpo.setType(type);
        fpo.setName("");
        fpo.setDescription("");
        fpo.setActive(true);
        fpo.setNote("");
        fpo.setData(type == BiScriptTypeConst.STYLE ? "/* " + "New style */\n" : type == BiScriptTypeConst.SCRIPT
            ? "// New script\n" : "");
        show(new EditorTab(this, fpo, new ArrayList<>(), 0, null));
    }

    /** The BI Editor's Import dialog (JSON files from a Download or the SharePoint folder), then a refresh. */
    private void importFiles() {
        if (!ClientRights.mayEdit(host)) {
            host.showError("Importing needs the BI Editor-Edit right.");
            return;
        }
        try {
            UploadScriptDialog d = new UploadScriptDialog(Exporter.mapper());
            d.setLocationRelativeTo(host.plugin());
            d.setVisible(true);
        } catch (RuntimeException | LinkageError e) {
            host.log("App editor: the import dialog failed", e);
            host.showError("The import dialog couldn't open: " + e.getMessage());
            return;
        }
        includables = null;
        for (EditorTab t : host.tabs(EditorTab.class)) {
            t.includablesChanged();
        }
        host.invalidateCatalog();
        reloadCatalog();
    }

    private void newPage() {
        if (!ClientRights.mayEdit(host)) {
            host.showError("Creating an app needs the BI Editor-Edit right.");
            return;
        }
        Component parent = host.plugin();
        AccessPolicy.Rights rights = ClientRights.current(host, service);
        NewPageDialog.Spec spec = NewPageDialog.ask(parent, service.templates(), rights.admin || rights.biReportEdit, folderNames());
        if (spec == null) {
            return;
        }
        String start = BLANK;
        if (spec.template != null) {
            try {
                String data = service.getScript(spec.template.id).getData();
                if (data != null && !data.trim().isEmpty()) {
                    start = data;
                }
            } catch (ScriptService.ServiceException e) {
                host.showError(e.getMessage() + " Starting blank.");
            }
        }
        TemplateRewriter.Result r = TemplateRewriter.rewrite(start, spec.name, spec.description, spec.launchTag);
        String text = AppGroups.setFolder(r.text, spec.folder);
        BiScriptFpo fpo = new BiScriptFpo();   // id -1: new
        fpo.setType(BiScriptTypeConst.PAGE);
        fpo.setName(spec.name);
        fpo.setDescription(spec.description);
        fpo.setActive(true);
        fpo.setPublished(spec.published);
        fpo.setNote("");
        fpo.setData(text);
        EditorTab tab = new EditorTab(this, fpo, new ArrayList<>(), 0, spec.access);
        tab.setGadget(spec.published && spec.gadget);
        show(tab);
        if (!r.missed.isEmpty()) {
            host.log("App editor: the template had no " + r.missed, null);
        }
    }

    private void show(EditorTab tab) {
        host.addTab(tab, tab.title(), tab.tip(), icon("/toolbar/edit24.png", 16));
    }

    EditorTab tabFor(int scriptId) {
        for (EditorTab t : host.tabs(EditorTab.class)) {
            if (t.scriptId() == scriptId && scriptId > 0) {
                return t;
            }
        }
        return null;
    }

    private boolean mayView() {
        if (ClientRights.mayView(host)) {
            return true;
        }
        host.showError("Seeing an app's code needs the BI Editor-View right.");
        return false;
    }

    // ---------------------------------------------------------------- for the tabs
    WorkspaceHost host() {
        return host;
    }

    ScriptService service() {
        return service;
    }

    List<ScriptService.Includable> includables() {
        if (includables == null) {
            includables = service.includables();
        }
        return includables;
    }

    Set<String> includableKeys() {
        Set<String> keys = new HashSet<>();
        for (ScriptService.Includable s : includables()) {
            keys.add(InsertPanel.key(s));
        }
        return keys;
    }

    /** The active record a directive names (type in lower case, include name as written). */
    ScriptService.Includable findIncludable(String type, String includeName) {
        String key = type.toLowerCase(Locale.ROOT) + ":" + includeName.toLowerCase(Locale.ROOT);
        for (ScriptService.Includable s : includables()) {
            if (InsertPanel.key(s).equals(key)) {
                return s;
            }
        }
        return null;
    }

    void index(ScriptService.Includable script, Consumer<JsIndex.Module> done) {
        indexes.get(script, done);
    }

    void indexAll(EditorTab tab) {
        for (ScriptService.Includable s : includables()) {
            if (s.typeId == 20) {
                indexes.get(s, tab::moduleIndexed);
            }
        }
    }

    /** After a save: a script, style or template changes what pages can include; the explorer shows the new state. */
    void saved(EditorTab tab, int oldId, BiScriptFpo saved) {
        if (saved.getTypeId() != 10) {
            includables = null;
            for (EditorTab t : host.tabs(EditorTab.class)) {
                t.includablesChanged();
            }
        }
        reloadCatalog();
        revealLater(saved.getId());   // a first save (or a built-in's copy) is a new record
    }

    // ---------------------------------------------------------------- explorer
    AppExplorer explorer() {
        if (explorer == null) {
            explorer = new AppExplorer(this);
            reloadCatalog();
        }
        return explorer;
    }

    /** Re-reads every record for the explorer (two SELECTs). */
    void reloadCatalog() {
        if (explorer == null) {
            return;
        }
        explorer.setLoading();
        catalog = service.catalog();
        explorer.setEntries(catalog, service.nativeFolders(), FolderStore.read(host.plugin()));
    }

    /** Every folder an app can be filed in (Fishbowl's, created and in use), for the editor's and New App's pickers. */
    List<String> folderNames() {
        return explorer().folderNames();
    }

    /** The explorer's Duplicate, for one record (an editor tab's Duplicate… button). */
    void duplicate(Component parent, int scriptId) {
        AppExplorer x = explorer();
        ScriptService.Entry e = entry(scriptId);
        if (e == null) {
            reloadCatalog();   // saved after the last read
            e = entry(scriptId);
        }
        if (e == null) {
            host.showError("That record isn't in Fishbowl's list any more.");
            return;
        }
        x.actions().duplicate(parent, Collections.singletonList(e));
    }

    private ScriptService.Entry entry(int scriptId) {
        if (catalog != null) {
            for (ScriptService.Entry e : catalog) {
                if (e.id == scriptId) {
                    return e;
                }
            }
        }
        return null;
    }

    void openEntry(ScriptService.Entry e) {
        openById(e.id);
    }

    void runEntry(ScriptService.Entry e) {
        if (!e.reports.isEmpty()) {
            host.openReport(e.reports.get(0).id, true);
        }
    }

    void openById(int scriptId) {
        if (!mayView()) {
            return;
        }
        EditorTab open = tabFor(scriptId);
        if (open != null) {
            host.select(open);
            return;
        }
        try {
            BiScriptFpo script = service.getScript(scriptId);
            if (script.getTypeId() == 50) {
                host.showError("Images are edited in the BI Editor module.");
                return;
            }
            show(new EditorTab(this, script, service.reportsFor(script.getId()), 0, null));
        } catch (ScriptService.ServiceException ex) {
            host.showError(ex.getMessage());
        }
    }

    /** After an explorer action: reload clean editor tabs of those records, and everything that lists them. */
    void recordsChanged(List<ScriptService.Entry> changed) {
        boolean shared = false;
        for (ScriptService.Entry e : changed) {
            shared |= e.typeId != 10;
            EditorTab t = tabFor(e.id);
            if (t != null && !t.isDirty()) {
                t.reloadQuietly();
            }
        }
        if (shared) {
            includables = null;
            for (EditorTab t : host.tabs(EditorTab.class)) {
                t.includablesChanged();
            }
        }
        host.invalidateCatalog();
        List<Integer> reportIds = new ArrayList<>();
        for (ScriptService.Entry e : changed) {
            for (AccessPolicy.Report r : e.reports) {
                reportIds.add(r.id);
            }
        }
        if (!reportIds.isEmpty()) {
            host.reloadReports(reportIds);
        }
        reloadCatalog();
    }

    void closed(EditorTab tab) {
        if (host.tabs(EditorTab.class).isEmpty()) {
            includables = null;   // re-read when the next editor opens
        }
    }

    // ---------------------------------------------------------------- helpers
    private static FBMainToolbarButton button(String text, String icon, String tip, Runnable action) {
        FBMainToolbarButton b = new FBMainToolbarButton();
        b.setText(text);
        Icon i = icon(icon, 24);
        if (i != null) {
            b.setIcon(i);
        }
        b.setToolTipText(tip);
        if (action != null) {
            b.addActionListener(e -> action.run());
        }
        return b;
    }

    private static void menuItem(JPopupMenu m, String text, String tip, Runnable action) {
        JMenuItem i = new JMenuItem(text);
        i.setToolTipText(tip);
        i.addActionListener(e -> action.run());
        m.add(i);
    }

    static Icon icon(String path, int size) {
        URL url = EditorFeature.class.getResource(path);
        if (url == null) {
            return null;
        }
        ImageIcon ii = new ImageIcon(url);
        return size == ii.getIconWidth() ? ii : new ImageIcon(ii.getImage().getScaledInstance(size, size, java.awt.Image.SCALE_SMOOTH));
    }

    private static final String BLANK = String.join("\n",
        "<!DOCTYPE html>",
        "<html lang=\"en\">",
        "<head>",
        "    <meta charset=\"UTF-8\">",
        "    <script>",
        "        window.FB_REPORT = {",
        "            key:   null,",
        "            name:  null,",
        "            build: 'UNSTAMPED'     // @fb-build",
        "        };",
        "    </script>",
        "    <title>New app</title>",
        "</head>",
        "<body>",
        "",
        "</body>",
        "</html>",
        "");

    static List<String> none() {
        return Collections.emptyList();
    }
}
