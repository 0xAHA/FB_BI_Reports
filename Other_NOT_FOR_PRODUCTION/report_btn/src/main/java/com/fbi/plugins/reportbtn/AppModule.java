package com.fbi.plugins.reportbtn;

import com.evnt.client.Client;
import com.evnt.client.modules.ClientModuleImpl;
import com.fbi.gui.button.FBMainToolbarButton;
import com.fbi.sdk.constants.MenuGroupNameConst;

import javax.swing.JTabbedPane;
import javax.swing.JToolBar;
import javax.swing.SwingUtilities;
import java.awt.BorderLayout;
import java.lang.reflect.Field;
import java.lang.reflect.Method;

/**
 * An app in its own main client tab: a client module of its own, so the client's
 * Save Bookmark remembers it with the other open tabs and reopens it at the next
 * login (AppModules creates it then, from its name).
 *
 * The module name is "Apps (beta)-<app record name>". The client grants a module
 * when one of the user's rights starts with the part before the first '-', so the
 * Apps (beta)-View right covers every app tab. shouldShow() is false, so app tabs
 * never appear in the module menus. ':' separates the names in a saved bookmark,
 * so it is swapped for a look-alike in the module name.
 */
final class AppModule extends ClientModuleImpl implements AppHost {

    static final String PREFIX = ReportWorkspacePlugin.MODULE_NAME + "-";
    private static final char COLON = (char) 0x2236;   // RATIO, looks like a colon

    private final String appName;
    private final JToolBar bar = new JToolBar();
    private final FBMainToolbarButton btnBack;
    private final FBMainToolbarButton btnForward;
    private ReportTab tab;

    AppModule(String appName, ReportTab tab) {
        this.appName = appName;
        this.tab = tab;
        setMenuGroup(MenuGroupNameConst.REPORTING);
        setLayout(new BorderLayout());
        if (tab != null) {
            add(tab, BorderLayout.CENTER);
        }
        btnBack = ReportWorkspacePlugin.button("Back", PaintedIcon.Kind.BACK, "Previous app", this::back);
        btnForward = ReportWorkspacePlugin.button("Forward", PaintedIcon.Kind.FORWARD, "Next app", this::forward);
        bar.setFloatable(false);
        bar.setRollover(true);
        bar.add(btnBack);
        bar.add(btnForward);
        bar.add(ReportWorkspacePlugin.button("Reload", "/toolbar/refresh24.png", "Load this app again", this::reload));
        bar.add(WorkspaceHost.ribbonSeparator());
        bar.add(ReportWorkspacePlugin.button("Window", "/toolbar/popup24.png",
            "Open this app in its own window (not blocked by dialogs in the main window)", this::toWindow));
        bar.add(ReportWorkspacePlugin.button("Apps Tab", PaintedIcon.Kind.NEW_TAB, "Move this app back into the Apps (beta) tabs",
            this::toWorkspace));
        changed();
    }

    static String moduleName(String appName) {
        return PREFIX + appName.replace(':', COLON);
    }

    static String appName(String moduleName) {
        return moduleName.substring(PREFIX.length()).replace(COLON, ':');
    }

    // ---------------------------------------------------------------- ClientModule
    @Override
    public String getModuleName() {
        return moduleName(appName);
    }

    @Override
    public String getModuleTitle() {
        return appName;
    }

    @Override
    public String getModuleIconClassPath() {
        return "/module/bireport48.png";
    }

    @Override
    public int getMenuItemPreferredLocation() {
        return 9999;   // never listed (shouldShow is false)
    }

    @Override
    public boolean shouldShow() {
        return false;   // never in the module menus
    }

    @Override
    public JToolBar getToolBar() {
        return bar;
    }

    @Override
    public boolean activateModule() {
        boolean ok = super.activateModule();
        if (tab == null) {
            open();   // restored from a bookmark: load the app now
        }
        SwingUtilities.invokeLater(this::retitleMainTab);
        return ok;
    }

    @Override
    public boolean closeModule() {
        ReportWorkspacePlugin ws = ReportWorkspacePlugin.current();
        if (tab != null) {
            if (ws != null) {
                ws.unregister(this);
            }
            remove(tab);
            tab.dispose();
            tab = null;
        }
        return super.closeModule();
    }

    // ---------------------------------------------------------------- AppHost
    @Override
    public ReportTab tab() {
        return tab;
    }

    @Override
    public void changed() {
        btnBack.setEnabled(tab != null && tab.canBack());
        btnForward.setEnabled(tab != null && tab.canForward());
        retitleMainTab();
    }

    // ---------------------------------------------------------------- actions
    private void open() {
        ReportWorkspacePlugin ws = ReportWorkspacePlugin.current();
        if (ws == null) {
            return;
        }
        tab = ws.createTab();
        add(tab, BorderLayout.CENTER);
        ws.register(this);
        ReportLoader.Loaded loaded = ws.loadApp(appName);
        if (loaded != null) {
            tab.open(loaded);
        } else {
            tab.showMessage("<b>" + escape(appName) + "</b> isn't available: it was renamed or deleted, "
                + "or you no longer have access to it.");
        }
        revalidate();
        changed();
    }

    private void back() {
        ReportWorkspacePlugin ws = ReportWorkspacePlugin.current();
        if (ws != null && tab != null && ws.stepBack(tab)) {
            changed();
        }
    }

    private void forward() {
        ReportWorkspacePlugin ws = ReportWorkspacePlugin.current();
        if (ws != null && tab != null && ws.stepForward(tab)) {
            changed();
        }
    }

    private void reload() {
        ReportWorkspacePlugin ws = ReportWorkspacePlugin.current();
        if (ws != null && tab != null && ws.reloadTab(tab)) {
            changed();
        }
    }

    private void toWindow() {
        ReportTab t = release();
        if (t != null) {
            AppWindow.open(t);
        }
    }

    private void toWorkspace() {
        ReportWorkspacePlugin ws = ReportWorkspacePlugin.current();
        ReportTab t = release();
        if (t != null && ws != null) {
            ws.adopt(t);
        }
    }

    /** Takes the app out of this tab and closes the tab (the app itself stays open). */
    private ReportTab release() {
        ReportTab t = tab;
        if (t == null) {
            return null;
        }
        ReportWorkspacePlugin ws = ReportWorkspacePlugin.current();
        if (ws != null) {
            ws.unregister(this);
        }
        remove(t);
        tab = null;
        closeMainTab();
        return t;
    }

    /** Takes an app moved here from a tab or window (this module has none open). */
    void adoptTab(ReportTab t) {
        tab = t;
        add(t, BorderLayout.CENTER);
        ReportWorkspacePlugin ws = ReportWorkspacePlugin.current();
        if (ws != null) {
            ws.register(this);
        }
        revalidate();
        changed();
    }

    // ---------------------------------------------------------------- the client's main tabs
    /** Shows this module in a new main tab (or selects it). */
    void showTab() {
        Client client = ReportAppsMenu.client();
        if (client == null) {
            return;
        }
        if (!AppModules.registered(this)) {
            client.addModule(this);
        }
        client.showModule(this);
    }

    private void closeMainTab() {
        Client client = ReportAppsMenu.client();
        if (client == null) {
            return;
        }
        try {
            Method m = Client.class.getDeclaredMethod("closeModule", com.evnt.client.ClientModule.class);
            m.setAccessible(true);
            m.invoke(client, this);
        } catch (ReflectiveOperationException | RuntimeException e) {
            ReportAppsPlugin.log("Apps (beta): closing the app tab failed", e);
        }
    }

    /** The client titles a tab with the module name; this tab shows the app's own name. */
    private void retitleMainTab() {
        JTabbedPane tabs = clientTabs();
        if (tabs == null) {
            return;
        }
        int i = tabs.indexOfComponent(this);
        if (i < 0) {
            return;
        }
        ReportTab.Entry e = tab == null ? null : tab.current();
        String title = e != null ? e.name : appName;
        tabs.setTitleAt(i, title.length() > 40 ? title.substring(0, 39) + "…" : title);
        tabs.setToolTipTextAt(i, title);
    }

    static JTabbedPane clientTabs() {
        Client client = ReportAppsMenu.client();
        if (client == null) {
            return null;
        }
        try {
            Field f = Client.class.getDeclaredField("tabContent");
            f.setAccessible(true);
            Object o = f.get(client);
            return o instanceof JTabbedPane ? (JTabbedPane) o : null;
        } catch (ReflectiveOperationException | RuntimeException e) {
            return null;
        }
    }

    private static String escape(String s) {
        return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;");
    }

    @Override
    public String toString() {
        return getModuleName();
    }
}
