package com.fbi.plugins.reportbtn.editor;

import com.evnt.client.common.ClientProperties;

import javax.swing.Timer;

/**
 * The editor's panel layout, remembered per user across sessions: the Apps panel's width,
 * the Insert panel's width, the code / preview split, where the preview docks and which
 * panels show. Kept in client.properties under a key per user id (the BI Editor keeps its
 * own layout per user too), so a second user on the PC starts from the defaults. One
 * instance is shared by the open editor tabs; a change is written once dragging stops.
 */
final class EditorLayout {

    static final int APPS_WIDTH = 270;
    static final int INSERT_WIDTH = 340;
    static final double CODE_RATIO = 0.5;

    int appsWidth = APPS_WIDTH;
    int insertWidth = INSERT_WIDTH;
    /** The code's share of the code / preview split (0.1 to 0.9). */
    double codeRatio = CODE_RATIO;
    boolean previewRight;
    boolean showApps = true;
    boolean showInsert = true;

    private final String key;
    private Timer pending;

    private EditorLayout(String key) {
        this.key = key;
    }

    static EditorLayout load(int userId) {
        EditorLayout l = new EditorLayout("reportbtn.editor.layout." + Math.max(0, userId));
        try {
            l.parse(ClientProperties.getProperty(l.key, ""));
        } catch (RuntimeException | LinkageError ignored) {
            // the defaults
        }
        return l;
    }

    /** For the self-check: no key, never saved. */
    static EditorLayout of(String text) {
        EditorLayout l = new EditorLayout(null);
        l.parse(text);
        return l;
    }

    /** "apps=270;insert=340;code=0.5;preview=right;showApps=1;showInsert=1"; unknown or bad parts are ignored. */
    void parse(String text) {
        if (text == null) {
            return;
        }
        for (String part : text.split(";")) {
            int eq = part.indexOf('=');
            if (eq <= 0) {
                continue;
            }
            String k = part.substring(0, eq).trim();
            String v = part.substring(eq + 1).trim();
            try {
                switch (k) {
                    case "apps": appsWidth = clamp(Integer.parseInt(v), 120, 900); break;
                    case "insert": insertWidth = clamp(Integer.parseInt(v), 160, 900); break;
                    case "code": codeRatio = Math.max(0.1, Math.min(0.9, Double.parseDouble(v))); break;
                    case "preview": previewRight = "right".equals(v); break;
                    case "showApps": showApps = !"0".equals(v); break;
                    case "showInsert": showInsert = !"0".equals(v); break;
                    default: break;
                }
            } catch (NumberFormatException ignored) {
                // keep the default
            }
        }
    }

    String format() {
        return "apps=" + appsWidth + ";insert=" + insertWidth + ";code=" + (Math.round(codeRatio * 1000) / 1000.0)
            + ";preview=" + (previewRight ? "right" : "below") + ";showApps=" + (showApps ? 1 : 0)
            + ";showInsert=" + (showInsert ? 1 : 0);
    }

    /** Writes the layout after a short pause, so a drag is written once. */
    void saveSoon() {
        if (key == null) {
            return;
        }
        if (pending == null) {
            pending = new Timer(800, e -> save());
            pending.setRepeats(false);
        }
        pending.restart();
    }

    private void save() {
        try {
            ClientProperties.setProperty(key, format());
            ClientProperties.saveProperties();
        } catch (RuntimeException | LinkageError ignored) {
            // not remembered this time
        }
    }

    private static int clamp(int v, int lo, int hi) {
        return Math.max(lo, Math.min(hi, v));
    }
}
