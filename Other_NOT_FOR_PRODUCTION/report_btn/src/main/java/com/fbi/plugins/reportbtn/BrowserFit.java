package com.fbi.plugins.reportbtn;

import javax.swing.SwingUtilities;
import javax.swing.Timer;
import java.awt.Component;
import java.awt.Container;
import java.awt.event.ComponentAdapter;
import java.awt.event.ComponentEvent;
import java.awt.event.HierarchyEvent;

/**
 * Keeps a page as wide as its panel. Chromium sometimes misses the size its view
 * is given while the page is still starting (a new tab, the module's first show):
 * the page then stays at its first, narrower width until the window is resized.
 * A one-pixel resize shortly after each load, and whenever the panel is shown,
 * does what that window resize does.
 */
public final class BrowserFit {

    private static final String VIEW_CLASS = "com.teamdev.jxbrowser.view.swing.BrowserView";
    private static final int[] AFTER_LOAD_MS = {300, 1500};

    private BrowserFit() {
    }

    /** Re-fits the panel's page whenever the panel is shown. */
    public static void attach(Component panel) {
        Timer shown = new Timer(AFTER_LOAD_MS[0], e -> fit(panel));
        shown.setRepeats(false);
        panel.addHierarchyListener(e -> {
            if ((e.getChangeFlags() & HierarchyEvent.SHOWING_CHANGED) != 0 && panel.isShowing()) {
                shown.restart();
            }
        });
        panel.addComponentListener(new ComponentAdapter() {
            @Override
            public void componentShown(ComponentEvent e) {
                shown.restart();
            }
        });
    }

    /** After a loadHTML: the page's size settles while it starts, so fit it twice. */
    public static void afterLoad(Component panel) {
        for (int ms : AFTER_LOAD_MS) {
            later(panel, ms);
        }
    }

    private static void later(Component panel, int ms) {
        Timer t = new Timer(ms, e -> fit(panel));
        t.setRepeats(false);
        t.start();
    }

    private static void fit(Component panel) {
        Component view = view(panel);
        if (view == null || !view.isShowing()) {
            return;
        }
        int w = view.getWidth();
        int h = view.getHeight();
        if (w < 2 || h < 2) {
            return;
        }
        view.setSize(w, h - 1);
        view.validate();
        // Restored on a later event, so the view sees two sizes, as in a window resize.
        SwingUtilities.invokeLater(() -> {
            view.setSize(w, h);
            Container parent = view.getParent();
            if (parent != null) {
                parent.revalidate();
            }
        });
    }

    /** The JxBrowser view inside the panel, or null. */
    private static Component view(Component c) {
        if (c.getClass().getName().equals(VIEW_CLASS)) {
            return c;
        }
        if (c instanceof Container) {
            for (Component child : ((Container) c).getComponents()) {
                Component v = view(child);
                if (v != null) {
                    return v;
                }
            }
        }
        return null;
    }
}
