package com.fbi.plugins.reportbtn;

import com.evnt.eve.event.EVEvent;
import com.fbi.fbdata.QueryParameter;
import com.fbi.fbdata.bi.BiReportFpo;
import com.fbi.gui.button.FBMainToolbarButton;
import com.fbi.gui.misc.FBTabbedPane;
import com.fbi.plugins.FishbowlPlugin;
import com.fbi.sdk.constants.MenuGroupNameConst;

import javax.swing.AbstractAction;
import javax.swing.Icon;
import javax.swing.JComponent;
import javax.swing.JOptionPane;
import javax.swing.JToolBar;
import javax.swing.KeyStroke;
import javax.swing.SwingUtilities;
import java.awt.BorderLayout;
import java.awt.Component;
import java.awt.event.ActionEvent;
import java.awt.event.InputEvent;
import java.awt.event.KeyEvent;
import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Apps (beta) (proof of concept): BI reports in tabs, with Back, Forward and
 * Home, inside one module tab under Reporting.
 *
 * Any BI report can open a report here through the bridge function it already
 * has: openModule('Apps (beta)', item). The client's openModule calls
 * showModule(name), which selects this module, then getModule(name)
 * .handleHyperLink(item), which lands below. Item grammar: WorkspaceLink.
 *
 * Each report tab is a native BiBrowserPanel (ReportTab), loaded exactly as the BI
 * Reports module loads a report (ReportLoader), so a report keeps its toolbar,
 * settings and real report id. Its history is kept by the tab, not by Chromium.
 *
 * Optional features plug in through WorkspaceExtension, found by class name
 * (loadExtension), so deleting a feature's package removes it: the page editor
 * is com.fbi.plugins.reportbtn.editor.
 *
 * Non-admin users see the module only with the "Apps (beta)-View" right
 * (Client.hasModuleAccess matches rights by module-name prefix).
 */
public class ReportWorkspacePlugin extends FishbowlPlugin {

    static final String MODULE_NAME = "Apps (beta)";
    /** The Home tab: the App Library, built into the plugin (AppLibrary), shown under this name. */
    static final String HOME_REPORT = "App Library";
    /** The module right for the Report Builder (the full string is MODULE_NAME + "-" + this). */
    static final String BUILD_RIGHT = "Build Reports";
    /** The page editor, if it is in the jar. -Dreportbtn.editor=off turns it off. */
    private static final String EDITOR_CLASS = "com.fbi.plugins.reportbtn.editor.EditorFeature";

    // The newest instance: a re-login builds a new one.
    private static volatile ReportWorkspacePlugin current;

    private final FBTabbedPane tabs = new FBTabbedPane();
    private final FBMainToolbarButton btnBack;
    private final FBMainToolbarButton btnForward;
    private final FBMainToolbarButton btnMainTab;
    private final FBMainToolbarButton btnWindow;
    private final WorkspaceExtension extension;
    /** Apps moved out to their own main tab or window (AppModule, AppWindow). */
    private final Set<AppHost> detached = new LinkedHashSet<>();
    private int nextSerial = 1;

    public ReportWorkspacePlugin() {
        setModuleName(MODULE_NAME);
        setMenuGroup(MenuGroupNameConst.REPORTING);
        setIconClassPath("/module/bireport48.png");
        addAccessRight("View");
        // Apps (beta)-Build Reports: the Report Builder, publishing to the user's own groups.
        addAccessRight(BUILD_RIGHT);
        current = this;
        AppWindow.closeAll();   // a re-login: windows of the previous session go
        AppModules.install();   // app tabs reopen from the client's saved bookmarks

        btnBack = button("Back", PaintedIcon.Kind.BACK, "Previous app in this tab (Alt+Left)", this::back);
        btnForward = button("Forward", PaintedIcon.Kind.FORWARD, "Next app in this tab (Alt+Right)", this::forward);
        FBMainToolbarButton btnHome = button("Home", PaintedIcon.Kind.HOME, "Open the App Library in this tab", () -> home(false));
        FBMainToolbarButton btnNewTab = button("New Tab", PaintedIcon.Kind.NEW_TAB, "Open the App Library in a new tab", () -> home(true));
        JToolBar bar = new JToolBar();
        bar.setFloatable(false);
        bar.setRollover(true);   // as the client's own module toolbars
        bar.add(btnBack);
        bar.add(btnForward);
        bar.add(WorkspaceHost.ribbonSeparator());
        bar.add(btnHome);
        bar.add(btnNewTab);
        bar.add(WorkspaceHost.ribbonSeparator());
        btnMainTab = button("Main Tab", "/toolbar/windowsplit24.png",
            "Move this app into a main tab of its own (Save Bookmark then remembers it)", this::mainTabSelected);
        btnWindow = button("Window", "/toolbar/popup24.png",
            "Open this app in its own window, which dialogs in the main window don't block", this::windowSelected);
        bar.add(btnMainTab);
        bar.add(btnWindow);
        extension = loadExtension();
        if (extension != null) {
            try {
                extension.install(new Host(), bar);
            } catch (RuntimeException | LinkageError e) {
                ReportAppsPlugin.log("Apps (beta): the editor failed to start", e);
            }
        }
        setMainToolBar(bar);   // the client shows these in its toolbar while this module is active

        tabs.setShowCloseButton(true);
        tabs.setShowCloseButtonOnTab(true);
        tabs.setCloseTabOnMouseMiddleButton(true);
        tabs.setCloseAction(new AbstractAction() {
            @Override
            public void actionPerformed(ActionEvent e) {
                if (e.getSource() instanceof WorkspaceTab) {
                    closeTab((WorkspaceTab) e.getSource());
                }
            }
        });
        tabs.addChangeListener(e -> {
            updateButtons();
            if (extension != null) {
                extension.selectionChanged(tabs.getSelectedComponent());
            }
        });
        setLayout(new BorderLayout());
        add(tabs, BorderLayout.CENTER);

        // These fire when focus is outside the page; Chromium keeps its own keys.
        bindKey(KeyStroke.getKeyStroke(KeyEvent.VK_LEFT, InputEvent.ALT_DOWN_MASK), "rw.back", this::back);
        bindKey(KeyStroke.getKeyStroke(KeyEvent.VK_RIGHT, InputEvent.ALT_DOWN_MASK), "rw.forward", this::forward);
        updateButtons();
    }

    static ReportWorkspacePlugin current() {
        return current;
    }

    /** The optional feature, if its class is in the jar; failures to load leave the workspace as it was. */
    private static WorkspaceExtension loadExtension() {
        if ("off".equalsIgnoreCase(System.getProperty("reportbtn.editor", ""))) {
            return null;
        }
        try {
            return (WorkspaceExtension) Class.forName(EDITOR_CLASS).getDeclaredConstructor().newInstance();
        } catch (ClassNotFoundException e) {
            return null;   // built without the editor
        } catch (ReflectiveOperationException | RuntimeException | LinkageError e) {
            ReportAppsPlugin.log("Apps (beta): the editor could not be loaded", e);
            return null;
        }
    }

    @Override
    public boolean activateModule() {
        AppModules.install();
        int before = ribbonHeight();   // still the previous module's ribbon
        boolean ok = super.activateModule();
        SwingUtilities.invokeLater(() -> SwingUtilities.invokeLater(() -> matchRibbon(before)));
        // First visit (or every tab closed): start on Home. Queued, so a report
        // asked for by handleHyperLink in the same call opens after it, on top.
        if (tabs.getTabCount() == 0) {
            SwingUtilities.invokeLater(() -> {
                if (tabs.getTabCount() == 0) {
                    home(true);
                }
            });
        }
        return ok;
    }

    // ---------------------------------------------------------------- ribbon height
    /** The tallest ribbon seen in another module: ours keeps at least that height. */
    private static int tallestRibbon;

    /** The client's module ribbon (Client.barMainRoot, private), or null. */
    private static Component ribbon() {
        try {
            java.awt.Frame client = ReportAppsMenu.client();
            if (client == null) {
                return null;
            }
            java.lang.reflect.Field f = client.getClass().getDeclaredField("barMainRoot");
            f.setAccessible(true);
            Object bar = f.get(client);
            return bar instanceof Component ? (Component) bar : null;
        } catch (ReflectiveOperationException | RuntimeException e) {
            return null;
        }
    }

    private static int ribbonHeight() {
        Component bar = ribbon();
        return bar == null ? 0 : bar.getHeight();
    }

    /**
     * Once the client has put our buttons in its ribbon: if it came out shorter than
     * the previous module's, our buttons grow by the difference, so switching to
     * Apps (beta) doesn't make the ribbon jump. The growth is kept for later visits.
     */
    private void matchRibbon(int previous) {
        Component bar = ribbon();
        if (bar == null || !isShowing()) {
            return;
        }
        tallestRibbon = Math.max(tallestRibbon, previous);
        int short_ = tallestRibbon - bar.getHeight();
        if (short_ <= 0 || short_ > 40) {
            return;   // already as tall, or a measurement to distrust
        }
        JToolBar mine = getToolBar();
        if (mine == null) {
            return;
        }
        for (Component c : mine.getComponents()) {
            if (c instanceof com.fbi.gui.button.FBButton) {
                java.awt.Dimension d = c.getPreferredSize();
                java.awt.Dimension taller = new java.awt.Dimension(d.width, d.height + short_);
                ((JComponent) c).setPreferredSize(taller);
                ((JComponent) c).setMinimumSize(taller);
                ((JComponent) c).setMaximumSize(taller);
            }
        }
        if (bar instanceof JComponent) {
            ((JComponent) bar).revalidate();
            bar.repaint();
        }
    }

    /** Client exit or module close: unsaved editor work can cancel it. */
    @Override
    public boolean checkForSave() {
        boolean ok = super.checkForSave();
        if (ok && extension != null) {
            try {
                ok = extension.checkForSave();
            } catch (RuntimeException e) {
                ReportAppsPlugin.log("Apps (beta): checkForSave failed", e);
            }
        }
        return ok;
    }

    /**
     * openModule('Apps (beta)', item). This arrives on the page's bridge
     * thread, inside the page's own call, so the work is queued to the event
     * thread instead of reloading a browser from inside its own callback.
     */
    @Override
    public void handleHyperLink(String item) {
        WorkspaceLink link = WorkspaceLink.parse(item);
        if (link == null) {
            return;
        }
        SwingUtilities.invokeLater(() -> follow(link));
    }

    private void follow(WorkspaceLink link) {
        try {
            switch (link.action) {
                case HOME:
                    home(link.newTab);
                    break;
                case BACK:
                    back();
                    break;
                case FORWARD:
                    forward();
                    break;
                case OPEN:
                case EDIT: {
                    AppCatalog.App app = link.id > 0 ? AppCatalog.byId(link.id) : AppCatalog.byName(link.name);
                    if (app == null) {
                        error("That app doesn't exist, or you don't have access to it ("
                            + (link.id > 0 ? "id " + link.id : "\"" + link.name + "\"") + ").");
                        return;
                    }
                    if (link.action == WorkspaceLink.Action.OPEN) {
                        open(app.id, app.name, link.newTab);
                    } else if (extension == null) {
                        error("The app editor isn't part of this build of the Apps (beta) module.");
                    } else {
                        extension.edit(new WorkspaceHost.ReportRef(app.id, app.name));
                    }
                    break;
                }
                case BUILD:
                    if (extension == null) {
                        error("The Report Builder's publishing isn't part of this build of the Apps (beta) module.");
                    } else {
                        extension.build(link.name, link.arg);
                    }
                    break;
                default:
                    break;
            }
        } catch (Exception e) {
            ReportAppsPlugin.log("Apps (beta): " + link + " failed", e);
            error((link.action == WorkspaceLink.Action.BUILD ? "Could not publish: " : "Could not open the app: ") + e.getMessage());
        }
    }

    /** Opens a report in the selected tab (or a new one), after it has loaded. */
    private void open(int id, String label, boolean newTab) {
        ReportLoader.Loaded loaded = load(id, label);
        if (loaded == null) {
            return;
        }
        ReportTab tab = newTab ? null : selected();
        if (tab == null) {
            tab = addTab();
        }
        tab.open(loaded);
        retitle(tab);
        tabs.setSelectedComponent(tab);
        updateButtons();
    }

    private void home(boolean newTab) {
        open(AppLibrary.ID, HOME_REPORT, newTab);   // built in: no record, import or access rows needed
    }

    private void back() {
        ReportTab tab = selected();
        if (tab != null && stepBack(tab)) {
            retitle(tab);
            updateButtons();
        }
    }

    private void forward() {
        ReportTab tab = selected();
        if (tab != null && stepForward(tab)) {
            retitle(tab);
            updateButtons();
        }
    }

    // ---------------------------------------------------------------- any tab, wherever it is
    /** Back in this tab's history, through the native load; false if there was nothing to go to. */
    boolean stepBack(ReportTab tab) {
        ReportTab.Entry entry = tab.backEntry();
        ReportLoader.Loaded loaded = entry != null ? load(entry.id, entry.name) : null;
        if (loaded == null) {
            return false;
        }
        tab.stepBack(loaded);
        return true;
    }

    boolean stepForward(ReportTab tab) {
        ReportTab.Entry entry = tab.forwardEntry();
        ReportLoader.Loaded loaded = entry != null ? load(entry.id, entry.name) : null;
        if (loaded == null) {
            return false;
        }
        tab.stepForward(loaded);
        return true;
    }

    /** Loads the tab's current app again. */
    boolean reloadTab(ReportTab tab) {
        ReportTab.Entry entry = tab.current();
        ReportLoader.Loaded loaded = entry != null ? load(entry.id, entry.name) : null;
        if (loaded == null) {
            return false;
        }
        tab.reload(loaded);
        return true;
    }

    /** A tab not in the Apps (beta) tabs (for an AppModule). */
    ReportTab createTab() {
        return new ReportTab(this, nextSerial++);
    }

    /** The app of this record name, loaded the native way; null (after a message) if it can't be opened. */
    ReportLoader.Loaded loadApp(String name) {
        if (HOME_REPORT.equals(name)) {
            return load(AppLibrary.ID, name);
        }
        AppCatalog.App app = AppCatalog.byName(name);
        return app == null ? null : load(app.id, app.name);
    }

    void register(AppHost host) {
        detached.add(host);
    }

    void unregister(AppHost host) {
        detached.remove(host);
    }

    /** An app comes back from its own tab or window into the Apps (beta) tabs, and the module is shown. */
    void adopt(ReportTab tab) {
        tabs.addTab("App", tab);
        retitle(tab);
        tabs.setSelectedComponent(tab);
        updateButtons();
        com.evnt.client.Client client = ReportAppsMenu.client();
        if (client != null) {
            client.showModule(this);
        }
    }

    /** Puts the app in a main tab of its own (or shows the one already open for it). */
    void toMainTab(ReportTab tab) {
        ReportTab.Entry e = tab.current();
        if (e == null) {
            adopt(tab);
            return;
        }
        AppModule m = AppModules.find(AppModule.moduleName(e.name));
        if (m != null && m.tab() != null) {
            adopt(tab);   // that app already has a main tab: keep this one here, show that one
            m.showTab();
            return;
        }
        if (m == null) {
            m = new AppModule(e.name, null);
        }
        m.adoptTab(tab);
        m.showTab();
    }

    /** Ribbon: the selected app into a main tab of its own. */
    private void mainTabSelected() {
        ReportTab tab = selected();
        if (tab == null || tab.current() == null) {
            return;
        }
        tabs.remove(tab);
        updateButtons();
        toMainTab(tab);
    }

    /** Ribbon: the selected app into a window of its own. */
    private void windowSelected() {
        ReportTab tab = selected();
        if (tab == null || tab.current() == null) {
            return;
        }
        tabs.remove(tab);
        updateButtons();
        AppWindow.open(tab);
    }

    private ReportLoader.Loaded load(int id, String label) {
        try {
            return AppLibrary.is(id) ? AppLibrary.load(this) : ReportLoader.load(id, label, this);
        } catch (ReportLoader.LoadException e) {
            error(e.getMessage());
        } catch (Exception e) {
            ReportAppsPlugin.log("Apps (beta): loading " + label + " failed", e);
            error("Could not open \"" + label + "\": " + e.getMessage());
        }
        return null;
    }

    private ReportTab addTab() {
        ReportTab tab = new ReportTab(this, nextSerial++);
        tabs.addTab("App", tab);
        return tab;
    }

    private void closeTab(WorkspaceTab tab) {
        if (!tab.confirmClose()) {
            return;
        }
        tabs.remove((Component) tab);
        tab.dispose();
        updateButtons();
    }

    private ReportTab selected() {
        Component c = tabs.getSelectedComponent();
        return c instanceof ReportTab ? (ReportTab) c : null;
    }

    private void retitle(ReportTab tab) {
        int i = tabs.indexOfComponent(tab);
        ReportTab.Entry entry = tab.current();
        if (i < 0 || entry == null) {
            return;
        }
        String title = entry.name.replaceFirst("^[\\s-]+", "");
        tabs.setTitleAt(i, title.length() > 40 ? title.substring(0, 39) + "…" : title);
        tabs.setToolTipTextAt(i, entry.name);
    }

    private void updateButtons() {
        ReportTab tab = selected();
        btnBack.setEnabled(tab != null && tab.canBack());
        btnForward.setEnabled(tab != null && tab.canForward());
        boolean app = tab != null && tab.current() != null;
        btnMainTab.setEnabled(app);
        btnWindow.setEnabled(app);
    }

    /** The extension's FB_WORKSPACE flags as JSON members (",\"edit\":true"), or "". */
    String workspaceFlags(int reportId) {
        if (extension == null) {
            return "";
        }
        StringBuilder out = new StringBuilder();
        try {
            Map<String, Boolean> flags = extension.workspaceFlags(reportId);
            if (flags != null) {
                for (Map.Entry<String, Boolean> e : flags.entrySet()) {
                    if (e.getKey() != null && e.getKey().matches("[A-Za-z]+") && e.getValue() != null) {
                        out.append(",\"").append(e.getKey()).append("\":").append(e.getValue());
                    }
                }
            }
        } catch (RuntimeException e) {
            ReportAppsPlugin.log("Apps (beta): workspaceFlags failed", e);
        }
        return out.toString();
    }

    private void error(String text) {
        JOptionPane.showMessageDialog(this, text, MODULE_NAME, JOptionPane.ERROR_MESSAGE);
    }

    private void bindKey(KeyStroke key, String name, Runnable action) {
        getInputMap(JComponent.WHEN_ANCESTOR_OF_FOCUSED_COMPONENT).put(key, name);
        getActionMap().put(name, new AbstractAction() {
            @Override
            public void actionPerformed(ActionEvent e) {
                action.run();
            }
        });
    }

    /** A ribbon button with one of the client's own 24 px icons. */
    static FBMainToolbarButton button(String text, String iconPath, String tip, Runnable action) {
        FBMainToolbarButton b = new FBMainToolbarButton();
        b.setText(text);
        java.net.URL url = ReportWorkspacePlugin.class.getResource(iconPath);
        if (url != null) {
            b.setIcon(new javax.swing.ImageIcon(url));
        }
        b.setToolTipText(tip);
        b.addActionListener(e -> action.run());
        return b;
    }

    static FBMainToolbarButton button(String text, PaintedIcon.Kind kind, String tip, Runnable action) {
        FBMainToolbarButton b = new FBMainToolbarButton();
        b.setText(text);
        b.setIcon(PaintedIcon.of(kind));
        b.setDisabledIcon(PaintedIcon.disabled(kind));
        b.setToolTipText(tip);
        b.addActionListener(e -> action.run());
        return b;
    }

    private static String escape(String s) {
        return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;");
    }

    /** What an extension sees of the workspace. */
    private final class Host implements WorkspaceHost {

        @Override
        public FishbowlPlugin plugin() {
            return ReportWorkspacePlugin.this;
        }

        @Override
        public void addTab(WorkspaceTab tab, String title, String tip, Icon icon) {
            tabs.addTab(title, icon, (Component) tab, tip);
            tabs.setSelectedComponent((Component) tab);
        }

        @Override
        public void retitle(WorkspaceTab tab, String title, String tip) {
            int i = tabs.indexOfComponent((Component) tab);
            if (i >= 0) {
                tabs.setTitleAt(i, title);
                tabs.setToolTipTextAt(i, tip);
            }
        }

        @Override
        public void select(WorkspaceTab tab) {
            if (tabs.indexOfComponent((Component) tab) >= 0) {
                tabs.setSelectedComponent((Component) tab);
            }
        }

        @Override
        public void closeTab(WorkspaceTab tab) {
            if (tabs.indexOfComponent((Component) tab) >= 0) {
                ReportWorkspacePlugin.this.closeTab(tab);
            }
        }

        @Override
        public <T extends WorkspaceTab> List<T> tabs(Class<T> type) {
            List<T> out = new ArrayList<>();
            for (int i = 0; i < tabs.getTabCount(); i++) {
                Component c = tabs.getComponentAt(i);
                if (type.isInstance(c)) {
                    out.add(type.cast(c));
                }
            }
            return out;
        }

        @Override
        public ReportRef findReport(int id, String name) {
            AppCatalog.App app = id > 0 ? AppCatalog.byId(id) : AppCatalog.byName(name);
            return app == null ? null : new ReportRef(app.id, app.name);
        }

        @Override
        public ReportRef selectedReport() {
            ReportTab tab = selected();
            ReportTab.Entry entry = tab != null ? tab.current() : null;
            // The built-in App Library is no record: nothing to edit.
            return entry == null || AppLibrary.is(entry.id) ? null : new ReportRef(entry.id, entry.name);
        }

        @Override
        public void openReport(int reportId, boolean newTab) {
            AppCatalog.App app = AppCatalog.byId(reportId);
            open(reportId, app != null ? app.name : "app " + reportId, newTab);
        }

        @Override
        public void reloadReports(Collection<Integer> reportIds) {
            List<ReportTab> all = new ArrayList<>();
            for (int i = 0; i < tabs.getTabCount(); i++) {
                Component c = tabs.getComponentAt(i);
                if (c instanceof ReportTab) {
                    all.add((ReportTab) c);
                }
            }
            for (AppHost h : new ArrayList<>(detached)) {
                if (h.tab() != null) {
                    all.add(h.tab());
                }
            }
            for (ReportTab tab : all) {
                ReportTab.Entry entry = tab.current();
                if (entry == null || (reportIds != null && !reportIds.contains(entry.id))) {
                    continue;
                }
                try {
                    tab.reload(AppLibrary.is(entry.id) ? AppLibrary.load(ReportWorkspacePlugin.this)
                        : ReportLoader.load(entry.id, entry.name, ReportWorkspacePlugin.this));
                    ReportWorkspacePlugin.this.retitle(tab);
                    for (AppHost h : detached) {
                        if (h.tab() == tab) {
                            h.changed();
                        }
                    }
                } catch (ReportLoader.LoadException e) {
                    tab.showMessage(escape(e.getMessage()));
                } catch (Exception e) {
                    ReportAppsPlugin.log("Apps (beta): reloading " + entry.name + " failed", e);
                    tab.showMessage("Could not reload <b>" + escape(entry.name) + "</b>.");
                }
            }
        }

        @Override
        public void invalidateCatalog() {
            AppCatalog.invalidate();
        }

        @Override
        public String serverError(EVEvent reply) {
            return ReportLoader.failed(reply) ? ReportLoader.message(ReportWorkspacePlugin.this, reply) : null;
        }

        @Override
        public Set<QueryParameter> savedParams(BiReportFpo report) {
            return ReportLoader.savedParams(report);
        }

        @Override
        public List<?> query(String sql) {
            List<?> rows = runQuery(sql);
            return rows == null ? new ArrayList<>() : rows;
        }

        @Override
        public String column(Object row, String name) {
            return AppCatalog.column(row, name);
        }

        @Override
        public int userId() {
            return getUserId();
        }

        @Override
        public String userName() {
            return getUsername();
        }

        @Override
        public void log(String message, Throwable error) {
            if (error == null) {
                ReportAppsPlugin.log(message);
            } else {
                ReportAppsPlugin.log(message, error);
            }
        }

        @Override
        public void showError(String message) {
            error(message);
        }
    }
}
