package com.fbi.plugins.reportbtn;

import com.evnt.client.modules.bireport.panels.BiBrowserPanel;

import javax.swing.BorderFactory;
import javax.swing.JLabel;
import javax.swing.JPanel;
import javax.swing.SwingConstants;
import java.awt.BorderLayout;
import java.awt.CardLayout;
import java.util.ArrayList;
import java.util.List;

/**
 * One Apps (beta) tab: a native BiBrowserPanel and the tab's history.
 *
 * History is a list of report ids kept here, not Chromium's: BiBrowserPanel and
 * its BiBrowser remember only the report given to the last loadHTML (the id that
 * saveReportData uses, and what Refresh / Print / Save act on). A Chromium Back
 * would show an older page while those still pointed at the newer report, so
 * every step reloads its report through the native path.
 */
final class ReportTab extends JPanel implements WorkspaceTab {

    static final class Entry {
        final int id;
        final String name;

        Entry(int id, String name) {
            this.id = id;
            this.name = name;
        }
    }

    private static final String BROWSER = "browser";
    private static final String MESSAGE = "message";

    private final ReportWorkspacePlugin module;
    private final int serial;
    private final CardLayout cards = new CardLayout();
    private final BiBrowserPanel browser = new BiBrowserPanel();
    private final JLabel message = new JLabel("", SwingConstants.CENTER);
    private final List<Entry> history = new ArrayList<>();
    private int index = -1;

    ReportTab(ReportWorkspacePlugin module, int serial) {
        this.module = module;
        this.serial = serial;
        setLayout(cards);
        // The page's own openModule calls resolve through this module, as in the BI module.
        browser.init(module, false);
        JPanel messagePanel = new JPanel(new BorderLayout());
        message.setBorder(BorderFactory.createEmptyBorder(40, 40, 40, 40));
        messagePanel.add(message, BorderLayout.CENTER);
        add(browser, BROWSER);
        add(messagePanel, MESSAGE);
    }

    int serial() {
        return serial;
    }

    Entry current() {
        return index >= 0 && index < history.size() ? history.get(index) : null;
    }

    boolean canBack() {
        return index > 0;
    }

    boolean canForward() {
        return index >= 0 && index < history.size() - 1;
    }

    Entry backEntry() {
        return canBack() ? history.get(index - 1) : null;
    }

    Entry forwardEntry() {
        return canForward() ? history.get(index + 1) : null;
    }

    /** Shows a newly opened report: drops any forward entries, then adds it. */
    void open(ReportLoader.Loaded loaded) {
        history.subList(index + 1, history.size()).clear();
        history.add(new Entry(loaded.report.getId(), loaded.report.getName()));
        index = history.size() - 1;
        render(loaded);
    }

    void stepBack(ReportLoader.Loaded loaded) {
        if (canBack()) {
            index--;
            render(loaded);
        }
    }

    void stepForward(ReportLoader.Loaded loaded) {
        if (canForward()) {
            index++;
            render(loaded);
        }
    }

    /** Re-shows the current report (e.g. after its page was saved). History is unchanged. */
    void reload(ReportLoader.Loaded loaded) {
        if (index >= 0) {
            history.set(index, new Entry(loaded.report.getId(), loaded.report.getName()));
            render(loaded);
        }
    }

    /** A note in place of a report (e.g. no Home report). History is unchanged. */
    void showMessage(String html) {
        message.setText("<html><div style='text-align:center;width:420px'>" + html + "</div></html>");
        cards.show(this, MESSAGE);
    }

    @Override
    public boolean confirmClose() {
        return true;
    }

    @Override
    public void dispose() {
        try {
            browser.dispose();
        } catch (Exception e) {
            ReportAppsPlugin.log("Closing a workspace tab failed", e);
        }
    }

    // As BiReportModuleClient does: clear, then load. window.FB_WORKSPACE tells the
    // page it is in the workspace, what Back / Forward can do, and any extension's
    // flags (e.g. edit: the page editor is there and the user may use it).
    private void render(ReportLoader.Loaded loaded) {
        String json = "{\"v\":1,\"module\":" + AppLauncher.jsonString(ReportWorkspacePlugin.MODULE_NAME)
            + ",\"tab\":" + serial
            + ",\"reportId\":" + loaded.report.getId()
            + ",\"canBack\":" + canBack()
            + ",\"canForward\":" + canForward()
            + module.workspaceFlags(loaded.report.getId()) + "}";
        String html = AppLauncher.insertScript(loaded.html, "FB_WORKSPACE", json);
        cards.show(this, BROWSER);
        browser.clear();
        browser.loadHTML(html, loaded.report.getId(), loaded.report.getName(), false, loaded.params);
    }
}
