package com.fbi.plugins.reportbtn;

import com.fbi.gui.button.FBMainToolbarButton;
import com.fbi.gui.misc.FBTabbedPane;
import com.fbi.plugins.FishbowlPlugin;
import com.fbi.sdk.constants.MenuGroupNameConst;

import javax.swing.AbstractAction;
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

/**
 * Report Workspace (proof of concept): BI reports in tabs, with Back, Forward and
 * Home, inside one module tab under Reporting.
 *
 * Any BI report can open a report here through the bridge function it already
 * has: openModule('Report Workspace', item). The client's openModule calls
 * showModule(name), which selects this module, then getModule(name)
 * .handleHyperLink(item), which lands below. Item grammar: WorkspaceLink.
 *
 * Each tab is a native BiBrowserPanel (ReportTab), loaded exactly as the BI Reports
 * module loads a report (ReportLoader), so a report keeps its toolbar, settings
 * and real report id. Its history is kept by the tab, not by Chromium.
 *
 * Non-admin users see the module only with the "Report Workspace-View" right
 * (Client.hasModuleAccess matches rights by module-name prefix).
 */
public class ReportWorkspacePlugin extends FishbowlPlugin {

    static final String MODULE_NAME = "Report Workspace";
    /** The Home report, by record name: the Report Launcher's FB_REPORT.name. */
    static final String HOME_REPORT = "Report Launcher";

    // The newest instance: a re-login builds a new one.
    private static volatile ReportWorkspacePlugin current;

    private final FBTabbedPane tabs = new FBTabbedPane();
    private final FBMainToolbarButton btnBack;
    private final FBMainToolbarButton btnForward;
    private int nextSerial = 1;

    public ReportWorkspacePlugin() {
        setModuleName(MODULE_NAME);
        setMenuGroup(MenuGroupNameConst.REPORTING);
        setIconClassPath("/module/bireport48.png");
        addAccessRight("View");
        current = this;

        btnBack = button("Back", PaintedIcon.Kind.BACK, "Previous report in this tab (Alt+Left)", this::back);
        btnForward = button("Forward", PaintedIcon.Kind.FORWARD, "Next report in this tab (Alt+Right)", this::forward);
        FBMainToolbarButton btnHome = button("Home", PaintedIcon.Kind.HOME, "Open the Report Launcher in this tab", () -> home(false));
        FBMainToolbarButton btnNewTab = button("New Tab", PaintedIcon.Kind.NEW_TAB, "Open the Report Launcher in a new tab", () -> home(true));
        JToolBar bar = new JToolBar();
        bar.setFloatable(false);
        bar.add(btnBack);
        bar.add(btnForward);
        bar.add(btnHome);
        bar.add(btnNewTab);
        setMainToolBar(bar);   // the client shows these in its toolbar while this module is active

        tabs.setShowCloseButton(true);
        tabs.setShowCloseButtonOnTab(true);
        tabs.setCloseTabOnMouseMiddleButton(true);
        tabs.setCloseAction(new AbstractAction() {
            @Override
            public void actionPerformed(ActionEvent e) {
                if (e.getSource() instanceof ReportTab) {
                    closeTab((ReportTab) e.getSource());
                }
            }
        });
        tabs.addChangeListener(e -> updateButtons());
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

    @Override
    public boolean activateModule() {
        boolean ok = super.activateModule();
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

    /**
     * openModule('Report Workspace', item). This arrives on the page's bridge
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
                case OPEN: {
                    AppCatalog.App app = link.id > 0 ? AppCatalog.byId(link.id) : AppCatalog.byName(link.name);
                    if (app == null) {
                        error("That report doesn't exist, or you don't have access to it ("
                            + (link.id > 0 ? "id " + link.id : "\"" + link.name + "\"") + ").");
                        return;
                    }
                    open(app.id, app.name, link.newTab);
                    break;
                }
                default:
                    break;
            }
        } catch (Exception e) {
            ReportAppsPlugin.log("Report Workspace: " + link + " failed", e);
            error("Could not open the report: " + e.getMessage());
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
        AppCatalog.App app = AppCatalog.byName(HOME_REPORT);
        if (app != null) {
            open(app.id, app.name, newTab);
            return;
        }
        ReportTab tab = newTab ? null : selected();
        if (tab == null) {
            tab = addTab();
        }
        tab.showMessage("<b>No Home report.</b><br><br>Home is the BI report named <b>"
            + escape(HOME_REPORT) + "</b>. Import the Report Launcher under that name, "
            + "or ask your administrator for access to it.");
        if (tab.current() == null) {
            tabs.setTitleAt(tabs.indexOfComponent(tab), "Home");
        }
        tabs.setSelectedComponent(tab);
        updateButtons();
    }

    private void back() {
        ReportTab tab = selected();
        ReportTab.Entry entry = tab != null ? tab.backEntry() : null;
        ReportLoader.Loaded loaded = entry != null ? load(entry.id, entry.name) : null;
        if (loaded != null) {
            tab.stepBack(loaded);
            retitle(tab);
            updateButtons();
        }
    }

    private void forward() {
        ReportTab tab = selected();
        ReportTab.Entry entry = tab != null ? tab.forwardEntry() : null;
        ReportLoader.Loaded loaded = entry != null ? load(entry.id, entry.name) : null;
        if (loaded != null) {
            tab.stepForward(loaded);
            retitle(tab);
            updateButtons();
        }
    }

    private ReportLoader.Loaded load(int id, String label) {
        try {
            return ReportLoader.load(id, label, this);
        } catch (ReportLoader.LoadException e) {
            error(e.getMessage());
        } catch (Exception e) {
            ReportAppsPlugin.log("Report Workspace: loading " + label + " failed", e);
            error("Could not open \"" + label + "\": " + e.getMessage());
        }
        return null;
    }

    private ReportTab addTab() {
        ReportTab tab = new ReportTab(this, nextSerial++);
        tabs.addTab("Report", tab);
        return tab;
    }

    private void closeTab(ReportTab tab) {
        tabs.remove(tab);
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

    private static FBMainToolbarButton button(String text, PaintedIcon.Kind kind, String tip, Runnable action) {
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
}
