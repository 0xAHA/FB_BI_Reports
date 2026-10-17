package com.fbi.plugins.reportbtn.docs;

import com.evnt.common.AccessRights;
import com.fbi.plugins.reportbtn.WorkspaceHost;

import javax.swing.JOptionPane;
import java.awt.Component;
import java.awt.Frame;
import java.awt.KeyboardFocusManager;
import java.awt.Window;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Shared state and helpers of the documents and email proof of concept (the docs
 * package). Nothing outside this package refers to it: deleting docs/ (or building
 * with --no-docs) removes the feature, and -Dreportbtn.docs=off turns it off.
 */
final class Docs {

    static final String TITLE = "Documents (PoC)";
    private static final Pattern HEAD = Pattern.compile("<head(\\s[^>]*)?>", Pattern.CASE_INSENSITIVE);

    /** Set by DocsFeature.install when the Apps (beta) module starts; null before that. */
    static volatile WorkspaceHost host;

    private Docs() {
    }

    static boolean off() {
        return "off".equalsIgnoreCase(System.getProperty("reportbtn.docs", ""));
    }

    /** The Apps (beta) module's host, or an explanation the caller can show. */
    static WorkspaceHost hostOrExplain(Component parent) {
        WorkspaceHost h = host;
        if (h == null) {
            error(parent, "The documents PoC starts with the Apps (beta) module, which hasn't loaded for this login.");
        }
        return h;
    }

    /** May set which app a module prints and emails: admin, or Reports-Company Edit (as Fishbowl's report tree). */
    static boolean mayEditDefaults(WorkspaceHost h) {
        if (h == null) {
            return false;
        }
        try {
            if (h.userId() == 1 || "admin".equalsIgnoreCase(h.userName())) {
                return true;
            }
        } catch (RuntimeException ignored) {
            // fall through to the right
        }
        try {
            return AccessRights.REPORTS_COMPANY_EDIT.hasAccess();
        } catch (RuntimeException | LinkageError e) {
            return false;
        }
    }

    /** The window to put dialogs over. */
    static Window window(Component c) {
        Window w = c == null ? null : (c instanceof Window ? (Window) c : javax.swing.SwingUtilities.getWindowAncestor(c));
        if (w == null) {
            w = KeyboardFocusManager.getCurrentKeyboardFocusManager().getActiveWindow();
        }
        if (w == null) {
            for (Frame f : Frame.getFrames()) {
                if (f.isShowing()) {
                    return f;
                }
            }
        }
        return w;
    }

    static void error(Component parent, String message) {
        JOptionPane.showMessageDialog(window(parent), message, TITLE, JOptionPane.ERROR_MESSAGE);
    }

    static void info(Component parent, String message) {
        JOptionPane.showMessageDialog(window(parent), message, TITLE, JOptionPane.INFORMATION_MESSAGE);
    }

    static void log(String message, Throwable error) {
        WorkspaceHost h = host;
        if (h != null) {
            h.log("Documents PoC: " + message, error);
        } else {
            System.err.println("[report_btn docs] " + message + (error == null ? "" : ": " + error));
        }
    }

    /** SELECT rows as column maps (lower-case keys, every value a string or null). Never null. */
    static List<Map<String, String>> rows(String sql, String... columns) {
        List<Map<String, String>> out = new ArrayList<>();
        WorkspaceHost h = host;
        if (h == null) {
            return out;
        }
        for (Object row : h.query(sql)) {
            Map<String, String> m = new LinkedHashMap<>();
            for (String c : columns) {
                m.put(c, h.column(row, c));
            }
            out.add(m);
        }
        return out;
    }

    /** The first row's column, or null. */
    static String one(String sql, String column) {
        List<Map<String, String>> r = rows(sql, column);
        return r.isEmpty() ? null : r.get(0).get(column);
    }

    /** A SQL string literal (single quotes doubled, backslashes doubled for MySQL). */
    static String lit(String s) {
        return "'" + (s == null ? "" : s.replace("\\", "\\\\").replace("'", "''")) + "'";
    }

    /** A JSON string, safe inside a script tag and against Fishbowl's setting-token substitution. */
    static String json(String s) {
        if (s == null) {
            return "null";
        }
        StringBuilder out = new StringBuilder(s.length() + 2).append('"');
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"': out.append("\\\""); break;
                case '\\': out.append("\\\\"); break;
                case '<': out.append("\\u003c"); break;
                case '$': out.append("\\u0024"); break;
                default:
                    if (c < 0x20 || c == 0x2028 || c == 0x2029) {
                        out.append(String.format("\\u%04x", (int) c));
                    } else {
                        out.append(c);
                    }
            }
        }
        return out.append('"').toString();
    }

    /** html with window.&lt;name&gt; = json set by a script after the first real head tag. */
    static String insertScript(String html, String name, String json) {
        String tag = "<script>window." + name + "=" + json + ";</script>";
        Matcher m = HEAD.matcher(html);
        while (m.find()) {
            if (html.lastIndexOf("<!--", m.start()) <= html.lastIndexOf("-->", m.start())) {
                return html.substring(0, m.end()) + tag + html.substring(m.end());
            }
        }
        return tag + html;
    }

    static boolean blank(String s) {
        return s == null || s.trim().isEmpty();
    }

    static javax.swing.Icon icon(String path, int size) {
        java.net.URL url = Docs.class.getResource(path);
        if (url == null) {
            return null;
        }
        javax.swing.ImageIcon ii = new javax.swing.ImageIcon(url);
        return size == ii.getIconWidth() ? ii
            : new javax.swing.ImageIcon(ii.getImage().getScaledInstance(size, size, java.awt.Image.SCALE_SMOOTH));
    }

    // ---------------------------------------------------------------- client internals (reflection)
    /** A field's value, looked up the class chain (private ones too). */
    static Object field(Object target, String name) throws ReflectiveOperationException {
        for (Class<?> c = target.getClass(); c != null; c = c.getSuperclass()) {
            try {
                java.lang.reflect.Field f = c.getDeclaredField(name);
                f.setAccessible(true);
                return f.get(target);
            } catch (NoSuchFieldException ignored) {
                // up the chain
            }
        }
        throw new NoSuchFieldException(name);
    }

    /** Calls a method looked up the class chain (private ones too); its exception is unwrapped. */
    static Object call(Object target, String name, Class<?>[] types, Object... args) throws Exception {
        for (Class<?> c = target.getClass(); c != null; c = c.getSuperclass()) {
            try {
                java.lang.reflect.Method m = c.getDeclaredMethod(name, types);
                m.setAccessible(true);
                try {
                    return m.invoke(target, args);
                } catch (java.lang.reflect.InvocationTargetException e) {
                    Throwable t = e.getCause();
                    throw t instanceof Exception ? (Exception) t : new Exception(String.valueOf(t), t);
                }
            } catch (NoSuchMethodException ignored) {
                // up the chain
            }
        }
        throw new NoSuchMethodException(name);
    }

    // ---------------------------------------------------------------- a "preparing" note
    /** A small window saying what is being prepared; close() it when done. Event thread only. */
    static final class Busy {
        private final javax.swing.JDialog dialog;

        Busy(Component parent, String text) {
            Window owner = window(parent);
            dialog = new javax.swing.JDialog(owner, TITLE, java.awt.Dialog.ModalityType.MODELESS);
            javax.swing.JPanel p = new javax.swing.JPanel(new java.awt.BorderLayout(0, 8));
            p.setBorder(javax.swing.BorderFactory.createEmptyBorder(14, 18, 14, 18));
            p.add(new javax.swing.JLabel(text), java.awt.BorderLayout.NORTH);
            javax.swing.JProgressBar bar = new javax.swing.JProgressBar();
            bar.setIndeterminate(true);
            p.add(bar, java.awt.BorderLayout.CENTER);
            dialog.setContentPane(p);
            dialog.setDefaultCloseOperation(javax.swing.WindowConstants.DO_NOTHING_ON_CLOSE);
            dialog.pack();
            dialog.setLocationRelativeTo(owner);
            dialog.setVisible(true);
        }

        void close() {
            dialog.dispose();
        }
    }
}
