package com.fbi.plugins.reportbtn;

import com.evnt.client.Client;

import javax.swing.BorderFactory;
import javax.swing.ImageIcon;
import javax.swing.JButton;
import javax.swing.JFrame;
import javax.swing.JToolBar;
import javax.swing.WindowConstants;
import java.awt.BorderLayout;
import java.awt.Dialog;
import java.awt.Dimension;
import java.awt.Image;
import java.awt.Insets;
import java.awt.event.WindowAdapter;
import java.awt.event.WindowEvent;
import java.net.URL;
import java.util.LinkedHashSet;
import java.util.Set;

/**
 * An app in a window of its own. It is excluded from application-modal dialogs, so
 * a dialog open in the main window (an order's Save prompt, say) doesn't lock it.
 * Its toolbar moves it back into a tab, or into its own main tab; closing the
 * window closes the app.
 */
final class AppWindow extends JFrame implements AppHost {

    private static final Set<AppWindow> OPEN = new LinkedHashSet<>();

    private ReportTab tab;
    private final JButton btnBack;
    private final JButton btnForward;

    private AppWindow(ReportTab tab) {
        super("App");
        this.tab = tab;
        setModalExclusionType(Dialog.ModalExclusionType.APPLICATION_EXCLUDE);
        setDefaultCloseOperation(WindowConstants.DO_NOTHING_ON_CLOSE);
        Client client = ReportAppsMenu.client();
        if (client != null && client.getIconImages() != null) {
            setIconImages(client.getIconImages());
        }
        JToolBar bar = new JToolBar();
        bar.setFloatable(false);
        bar.setBorder(BorderFactory.createEmptyBorder(2, 4, 2, 4));
        btnBack = tool(bar, "Back", null, "Previous app", this::back);
        btnBack.setIcon(PaintedIcon.of(PaintedIcon.Kind.BACK));
        btnBack.setDisabledIcon(PaintedIcon.disabled(PaintedIcon.Kind.BACK));
        btnForward = tool(bar, "Forward", null, "Next app", this::forward);
        btnForward.setIcon(PaintedIcon.of(PaintedIcon.Kind.FORWARD));
        btnForward.setDisabledIcon(PaintedIcon.disabled(PaintedIcon.Kind.FORWARD));
        tool(bar, "Reload", "/toolbar/refresh24.png", "Load this app again", this::reload);
        bar.addSeparator();
        tool(bar, "Main Tab", "/toolbar/windowsplit24.png", "Move this app into its own main tab", this::toMainTab);
        JButton dock = tool(bar, "Apps Tab", null, "Move this app back into the Apps (beta) tabs", this::toWorkspace);
        dock.setIcon(PaintedIcon.of(PaintedIcon.Kind.NEW_TAB));
        getContentPane().setLayout(new BorderLayout());
        getContentPane().add(bar, BorderLayout.NORTH);
        getContentPane().add(tab, BorderLayout.CENTER);
        addWindowListener(new WindowAdapter() {
            @Override
            public void windowClosing(WindowEvent e) {
                closeApp();
            }
        });
        Dimension size = client != null && client.getWidth() > 400
            ? new Dimension(client.getWidth() * 4 / 5, client.getHeight() * 4 / 5) : new Dimension(1200, 800);
        setSize(size);
        setLocationRelativeTo(client);
        changed();
    }

    /** Moves the app into a new window and shows it. */
    static AppWindow open(ReportTab tab) {
        AppWindow w = new AppWindow(tab);
        OPEN.add(w);
        ReportWorkspacePlugin ws = ReportWorkspacePlugin.current();
        if (ws != null) {
            ws.register(w);
        }
        w.setVisible(true);
        tab.revalidate();
        return w;
    }

    /** At a re-login: windows from the previous session go. */
    static void closeAll() {
        for (AppWindow w : OPEN.toArray(new AppWindow[0])) {
            w.closeApp();
        }
    }

    @Override
    public ReportTab tab() {
        return tab;
    }

    @Override
    public void changed() {
        btnBack.setEnabled(tab != null && tab.canBack());
        btnForward.setEnabled(tab != null && tab.canForward());
        ReportTab.Entry e = tab == null ? null : tab.current();
        setTitle(e != null ? e.name + " - " + ReportWorkspacePlugin.MODULE_NAME : ReportWorkspacePlugin.MODULE_NAME);
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

    private void toWorkspace() {
        ReportWorkspacePlugin ws = ReportWorkspacePlugin.current();
        ReportTab t = release();
        if (t != null && ws != null) {
            ws.adopt(t);
        }
    }

    private void toMainTab() {
        ReportWorkspacePlugin ws = ReportWorkspacePlugin.current();
        ReportTab t = release();
        if (t != null && ws != null) {
            ws.toMainTab(t);
        }
    }

    /** Takes the app out of the window and closes it (the app stays open elsewhere). */
    private ReportTab release() {
        ReportTab t = tab;
        if (t == null) {
            return null;
        }
        unregister();
        getContentPane().remove(t);
        tab = null;
        OPEN.remove(this);
        dispose();
        return t;
    }

    private void closeApp() {
        ReportTab t = tab;
        unregister();
        tab = null;
        OPEN.remove(this);
        dispose();
        if (t != null) {
            t.dispose();
        }
    }

    private void unregister() {
        ReportWorkspacePlugin ws = ReportWorkspacePlugin.current();
        if (ws != null) {
            ws.unregister(this);
        }
    }

    private static JButton tool(JToolBar bar, String text, String icon, String tip, Runnable action) {
        JButton b = new JButton(text);
        URL url = icon == null ? null : AppWindow.class.getResource(icon);
        if (url != null) {
            b.setIcon(new ImageIcon(new ImageIcon(url).getImage().getScaledInstance(16, 16, Image.SCALE_SMOOTH)));
        }
        b.setToolTipText(tip);
        b.setFocusable(false);
        b.setMargin(new Insets(2, 6, 2, 6));
        b.addActionListener(e -> action.run());
        bar.add(b);
        return b;
    }
}
