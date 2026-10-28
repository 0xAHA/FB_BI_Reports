package com.fbi.plugins.sqlstudio;

import com.evnt.client.modules.bireport.panels.BiBrowserPanel;
import com.fbi.gui.button.FBMainToolbarButton;
import com.fbi.plugins.FishbowlPlugin;
import com.fbi.sdk.constants.MenuGroupNameConst;
import com.fbi.util.FishbowlBrowser;
import com.teamdev.jxbrowser.frame.Frame;
import com.teamdev.jxbrowser.js.JsObject;

import javax.swing.BorderFactory;
import javax.swing.JLabel;
import javax.swing.JPanel;
import javax.swing.JToolBar;
import javax.swing.SwingConstants;
import javax.swing.SwingUtilities;
import java.awt.BorderLayout;
import java.awt.CardLayout;
import java.lang.reflect.Field;
import java.util.HashSet;

/**
 * SQL Studio: a replacement for the client's Data module, under Reporting.
 *
 * The module is only a shell. Everything you see is one page built into the jar
 * (StudioPage), shown in the client's own BiBrowserPanel, the panel the BI
 * Reports module uses. That panel already gives a page runQuery, runQueryAsync,
 * runRestApiAsync and saveSettings over the client's session, so the page
 * needs no bridge of its own, no login and no database credentials.
 *
 * Writes go through the REST data-query write path, never the native module's
 * support mode: that mode is a flag the client sends and the server believes.
 * Only an admin is offered them (window.FB_STUDIO.admin); the server decides
 * whether they run.
 *
 * Non-admin users see the module only with the "SQL Studio-View" right
 * (Client.hasModuleAccess matches rights by module-name prefix).
 */
public class SqlStudioPlugin extends FishbowlPlugin {

    static final String MODULE_NAME = "SQL Studio";
    private static final String BROWSER = "browser";
    private static final String MESSAGE = "message";

    private final DataQueryBridge bridge = new DataQueryBridge(this);
    private final CardLayout cards = new CardLayout();
    private final JPanel body = new JPanel(cards);
    private final JLabel message = new JLabel("", SwingConstants.CENTER);
    private BiBrowserPanel browser;

    public SqlStudioPlugin() {
        setModuleName(MODULE_NAME);
        setMenuGroup(MenuGroupNameConst.REPORTING);
        setIconClassPath("/module/dataexport48.png");
        addAccessRight("View");

        JToolBar bar = new JToolBar();
        bar.setFloatable(false);
        bar.setRollover(true);   // as the client's own module toolbars
        bar.add(button("Reload", "/toolbar/refresh24.png",
            "Load SQL Studio again (your SQL is kept; the schema is read afresh)", this::reload));
        setMainToolBar(bar);

        JPanel messagePanel = new JPanel(new BorderLayout());
        message.setBorder(BorderFactory.createEmptyBorder(40, 40, 40, 40));
        messagePanel.add(message, BorderLayout.CENTER);
        body.add(messagePanel, MESSAGE);
        setLayout(new BorderLayout());
        add(body, BorderLayout.CENTER);
    }

    @Override
    public boolean activateModule() {
        boolean ok = super.activateModule();
        // The browser is made on first show, not at login: every FishbowlPlugin is
        // created at login, and most sessions never open this module.
        if (browser == null) {
            SwingUtilities.invokeLater(this::reload);
        }
        return ok;
    }

    @Override
    public boolean closeModule() {
        if (browser != null) {
            try {
                body.remove(browser);
                browser.dispose();
            } catch (Exception e) {
                log("closing the page failed", e);
            }
            browser = null;
        }
        return super.closeModule();
    }

    private void reload() {
        String html;
        try {
            html = StudioPage.build(context());
        } catch (StudioPage.MissingException e) {
            showMessage(e.getMessage());
            return;
        }
        if (browser == null) {
            browser = new BiBrowserPanel();
            // The page's own openModule calls resolve through this module, as in the BI module.
            browser.init(this, false);
            attachBridge(browser);
            body.add(browser, BROWSER);
            BrowserFit.attach(browser);
        }
        cards.show(body, BROWSER);
        // As BiReportModuleClient does: clear, then load. -1 is the sandbox report id
        // (the native editor's preview id): the page keeps its settings per user with
        // saveSettings, and never calls saveReportData, which needs a saved report.
        browser.clear();
        browser.loadHTML(html, StudioPage.REPORT_ID, MODULE_NAME, false, new HashSet<>());
        BrowserFit.afterLoad(browser);
    }

    /**
     * Puts the saved-query bridge on the page's window after each load, as
     * window.sqlStudioHost, and tells the page with a 'sqlstudiohost' event.
     *
     * After the load, not before it: the panel's BiBrowser registers its own
     * functions through the browser's one InjectJsCallback, and setting
     * another would replace it. A load-finished observer is added beside
     * theirs instead. The page works without the bridge (the BI Reports
     * viewer has none); saved queries are then read-only.
     */
    private void attachBridge(BiBrowserPanel panel) {
        try {
            Field f = BiBrowserPanel.class.getDeclaredField("browser");
            f.setAccessible(true);
            Object b = f.get(panel);
            if (!(b instanceof FishbowlBrowser)) {
                log("saved queries stay read-only: no browser to bridge to", null);
                return;
            }
            ((FishbowlBrowser) b).onFinishedLoading(e -> {
                Frame frame = e.frame();
                if (frame != null && frame.isMain()) {
                    SwingUtilities.invokeLater(() -> inject(frame));
                }
            });
        } catch (ReflectiveOperationException | RuntimeException | LinkageError e) {
            log("saved queries stay read-only", e);
        }
    }

    private void inject(Frame frame) {
        try {
            JsObject window = frame.executeJavaScript("window");
            if (window != null && window.putProperty("sqlStudioHost", bridge)) {
                frame.executeJavaScript("window.dispatchEvent(new Event('sqlstudiohost'))");
            }
        } catch (RuntimeException e) {
            log("putting the saved-query bridge on the page failed", e);
        }
    }

    /** What the page is told about its host, as window.FB_STUDIO. */
    private String context() {
        int userId = getUserId();
        String user = getUsername();
        // User id 1, or the user named admin: what the client's own credentials treat as admin.
        boolean admin = userId == 1 || "admin".equalsIgnoreCase(user);
        return "{\"v\":1"
            + ",\"version\":" + StudioPage.jsonString(StudioPage.version())
            + ",\"user\":" + StudioPage.jsonString(user == null ? "" : user)
            + ",\"userId\":" + userId
            + ",\"admin\":" + admin
            + "}";
    }

    private void showMessage(String text) {
        message.setText("<html><div style='text-align:center;width:420px'>" + text + "</div></html>");
        cards.show(body, MESSAGE);
    }

    private static FBMainToolbarButton button(String text, String iconPath, String tip, Runnable action) {
        FBMainToolbarButton b = new FBMainToolbarButton();
        b.setText(text);
        java.net.URL url = SqlStudioPlugin.class.getResource(iconPath);
        if (url != null) {
            b.setIcon(new javax.swing.ImageIcon(url));
        }
        b.setToolTipText(tip);
        b.addActionListener(e -> action.run());
        return b;
    }

    static void log(String message, Throwable t) {
        System.out.println("[sql_studio] " + message + (t == null ? "" : ": " + t));
    }
}
