package com.fbi.plugins.reportbtn.editor;

import com.evnt.client.ClientModule;
import com.evnt.client.modules.bireport.panels.BiBrowserPanel;
import com.fbi.fbdata.QueryParameter;

import javax.swing.BorderFactory;
import javax.swing.ButtonGroup;
import javax.swing.JButton;
import javax.swing.JLabel;
import javax.swing.JPanel;
import javax.swing.JToggleButton;
import javax.swing.UIManager;
import java.awt.BorderLayout;
import java.awt.Color;
import java.awt.FlowLayout;
import java.awt.Insets;
import java.util.Set;

/**
 * The page as the BI Reports module would show it, from the editor's unsaved
 * text: the native BiBrowserPanel, created on first use. With the real report id
 * the page's saved settings and loadReportData work (and saveReportData writes
 * real data); the sandbox uses -1, as the native editor's preview does.
 *
 * The header carries the dock choice (below or beside the code) and a close
 * button; the tab owns the split, so both are callbacks.
 */
final class PreviewPane extends JPanel {

    interface Owner {
        void closePreview();

        void dockPreview(boolean right);
    }

    private final ClientModule module;
    private final JLabel note = new JLabel(" ");
    private final JToggleButton bottom = new JToggleButton("Bottom");
    private final JToggleButton right = new JToggleButton("Right");
    private BiBrowserPanel browser;

    PreviewPane(ClientModule module, Owner owner, boolean dockRight) {
        super(new BorderLayout());
        this.module = module;

        bottom.setToolTipText("Show the preview below the code");
        right.setToolTipText("Show the preview beside the code");
        ButtonGroup dock = new ButtonGroup();
        dock.add(bottom);
        dock.add(right);
        (dockRight ? right : bottom).setSelected(true);
        bottom.addActionListener(e -> owner.dockPreview(false));
        right.addActionListener(e -> owner.dockPreview(true));
        JButton close = new JButton("✕");
        close.setToolTipText("Close the preview (F5 opens it again)");
        close.addActionListener(e -> owner.closePreview());

        JPanel tools = new JPanel(new FlowLayout(FlowLayout.RIGHT, 2, 0));
        tools.setOpaque(false);
        for (javax.swing.AbstractButton b : new javax.swing.AbstractButton[] {bottom, right, close}) {
            b.setFocusable(false);
            b.setMargin(new Insets(1, 6, 1, 6));
            tools.add(b);
        }
        note.setBorder(BorderFactory.createEmptyBorder(0, 4, 0, 4));
        JPanel head = new JPanel(new BorderLayout());
        Color line = UIManager.getColor("Separator.foreground");
        head.setBorder(BorderFactory.createCompoundBorder(
            BorderFactory.createMatteBorder(0, 0, 1, 0, line == null ? Color.LIGHT_GRAY : line),
            BorderFactory.createEmptyBorder(2, 4, 2, 2)));
        head.add(note, BorderLayout.CENTER);
        head.add(tools, BorderLayout.EAST);
        add(head, BorderLayout.NORTH);
    }

    void show(String html, int reportId, String name, Set<QueryParameter> params, String caption) {
        if (browser == null) {
            browser = new BiBrowserPanel();
            browser.init(module, false);
            add(browser, BorderLayout.CENTER);
            revalidate();
        }
        note.setText(caption);
        note.setToolTipText(caption);
        browser.clear();
        browser.loadHTML(html, reportId, name, false, params);
    }

    /** Stops the previewed page (its timers and queries) without throwing the browser away. */
    void stop() {
        if (browser != null) {
            try {
                browser.clear();
            } catch (RuntimeException ignored) {
                // hidden anyway
            }
        }
    }

    void setDock(boolean dockRight) {
        (dockRight ? right : bottom).setSelected(true);
    }

    boolean isEmpty() {
        return browser == null;
    }

    void dispose() {
        if (browser != null) {
            try {
                browser.dispose();
            } catch (RuntimeException ignored) {
                // closing anyway
            }
            browser = null;
        }
    }
}
