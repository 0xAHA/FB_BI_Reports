package com.fbi.plugins.reportbtn.editor;

import com.fbi.sdk.constants.bi.QueryParamTypeConst;

import javax.swing.BorderFactory;
import javax.swing.JCheckBox;
import javax.swing.JEditorPane;
import javax.swing.JLabel;
import javax.swing.JMenuItem;
import javax.swing.JPanel;
import javax.swing.JPopupMenu;
import javax.swing.JScrollPane;
import javax.swing.JSplitPane;
import javax.swing.JTextField;
import javax.swing.JTree;
import javax.swing.KeyStroke;
import javax.swing.event.DocumentEvent;
import javax.swing.event.DocumentListener;
import javax.swing.tree.DefaultMutableTreeNode;
import javax.swing.tree.DefaultTreeModel;
import javax.swing.tree.TreePath;
import java.awt.BorderLayout;
import java.awt.Dimension;
import java.awt.event.ActionEvent;
import java.awt.event.KeyEvent;
import java.awt.event.MouseAdapter;
import java.awt.event.MouseEvent;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Collections;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * The script selector beside the code: what the page can include, its report
 * settings, Fishbowl's bridge functions, and the functions of the modules the
 * page includes (or of every module). Double-click or Enter inserts; the pane
 * below shows the signature and docs.
 */
final class InsertPanel extends JPanel {

    /** What inserting does; implemented by the editor tab. */
    interface Actions {
        void insertInclude(ScriptService.Includable include);

        /** Asks for a new report setting (type preselected when given) and inserts its token. */
        void addSetting(QueryParamTypeConst type);

        void insertBridge(Bridge.Fn fn);

        void insertSymbol(JsIndex.Module module, JsIndex.Symbol symbol);

        void openScript(ScriptService.Includable include);

        /** The user ticked "every module": index them all. */
        void wantAllModules();
    }

    private enum Kind { SECTION, INCLUDE, SETTING_TYPE, SETTING_USED, BRIDGE, MODULE, SYMBOL }

    private static final String SETTINGS = "Report settings";
    private static final String USED = "In this app";

    private static final class Item {
        final Kind kind;
        final String label;
        final Object payload;
        final JsIndex.Module module;

        Item(Kind kind, String label, Object payload, JsIndex.Module module) {
            this.kind = kind;
            this.label = label;
            this.payload = payload;
            this.module = module;
        }

        @Override
        public String toString() {
            return label;
        }
    }

    private final Actions actions;
    private final JTextField filter = new JTextField();
    private final JCheckBox everyModule = new JCheckBox("Every module");
    private final DefaultMutableTreeNode root = new DefaultMutableTreeNode("Insert");
    private final DefaultTreeModel model = new DefaultTreeModel(root);
    private final JTree tree = new JTree(model);
    private final JEditorPane doc = new JEditorPane("text/html", "");

    private List<ScriptService.Includable> includables = Collections.emptyList();
    private Set<String> included = Collections.emptySet();
    private Map<String, Integer> tokens = Collections.emptyMap();
    private List<JsIndex.Module> pageModules = Collections.emptyList();
    private Map<String, JsIndex.Module> allModules = new LinkedHashMap<>();
    private boolean editable = true;

    InsertPanel(Actions actions) {
        super(new BorderLayout(0, 4));
        this.actions = actions;
        setBorder(BorderFactory.createEmptyBorder(4, 4, 4, 4));
        setPreferredSize(new Dimension(320, 300));

        JPanel top = new JPanel(new BorderLayout(4, 0));
        top.add(new JLabel("Filter"), BorderLayout.WEST);
        top.add(filter, BorderLayout.CENTER);
        everyModule.setToolTipText("List the functions of every script, not just the ones this app includes");
        top.add(everyModule, BorderLayout.EAST);
        add(top, BorderLayout.NORTH);

        tree.setRootVisible(false);
        tree.setShowsRootHandles(true);
        tree.setToolTipText("Double-click or Enter to insert at the caret");
        doc.setEditable(false);
        doc.putClientProperty(JEditorPane.HONOR_DISPLAY_PROPERTIES, Boolean.TRUE);
        JSplitPane split = new JSplitPane(JSplitPane.VERTICAL_SPLIT, new JScrollPane(tree), new JScrollPane(doc));
        split.setResizeWeight(0.7);
        split.setBorder(null);
        add(split, BorderLayout.CENTER);

        filter.getDocument().addDocumentListener(new DocumentListener() {
            public void insertUpdate(DocumentEvent e) { rebuild(); }
            public void removeUpdate(DocumentEvent e) { rebuild(); }
            public void changedUpdate(DocumentEvent e) { rebuild(); }
        });
        everyModule.addActionListener(e -> {
            if (everyModule.isSelected()) {
                actions.wantAllModules();
            }
            rebuild();
        });
        tree.addTreeSelectionListener(e -> showDoc(selected()));
        tree.addMouseListener(new MouseAdapter() {
            @Override
            public void mouseClicked(MouseEvent e) {
                if (e.getClickCount() == 2 && !e.isPopupTrigger()) {
                    activate(selected());
                }
            }

            @Override
            public void mousePressed(MouseEvent e) {
                popup(e);
            }

            @Override
            public void mouseReleased(MouseEvent e) {
                popup(e);
            }
        });
        tree.getInputMap().put(KeyStroke.getKeyStroke(KeyEvent.VK_ENTER, 0), "insert");
        tree.getActionMap().put("insert", new javax.swing.AbstractAction() {
            @Override
            public void actionPerformed(ActionEvent e) {
                activate(selected());
            }
        });
        rebuild();
    }

    void setEditable(boolean editable) {
        this.editable = editable;
        showDoc(selected());
    }

    void setIncludables(List<ScriptService.Includable> list) {
        includables = list == null ? Collections.emptyList() : list;
        rebuild();
    }

    /** What the page includes now (type:name keys, lower case) and its setting tokens. */
    void setPage(Set<String> includedKeys, Map<String, Integer> settingTokens) {
        if (includedKeys.equals(included) && settingTokens.equals(tokens)) {
            return;
        }
        included = includedKeys;
        tokens = settingTokens;
        rebuild();
    }

    void setPageModules(List<JsIndex.Module> modules) {
        pageModules = modules;
        rebuild();
    }

    void addModule(JsIndex.Module module) {
        allModules.put(module.scriptName, module);
        if (everyModule.isSelected()) {
            rebuild();
        }
    }

    // ---------------------------------------------------------------- tree
    private void rebuild() {
        String q = filter.getText().trim().toLowerCase(Locale.ROOT);
        Set<String> expanded = expandedLabels();
        root.removeAllChildren();

        DefaultMutableTreeNode inc = section("Includes");
        for (int type : new int[]{20, 30, 40, 50}) {
            DefaultMutableTreeNode group = section(typeLabel(type));
            for (ScriptService.Includable s : includables) {
                if (s.typeId != type) {
                    continue;
                }
                boolean in = included.contains(key(s));
                String label = (in ? "✓ " : "") + s.name;
                if (matches(q, s.name + " " + s.description)) {
                    group.add(leaf(Kind.INCLUDE, label, s, null));
                }
            }
            addIfAny(inc, group);
        }

        DefaultMutableTreeNode settings = section(SETTINGS);
        if (!tokens.isEmpty()) {
            DefaultMutableTreeNode used = section(USED);
            for (Map.Entry<String, Integer> t : tokens.entrySet()) {
                if (matches(q, t.getKey())) {
                    used.add(leaf(Kind.SETTING_USED, t.getKey() + (t.getValue() > 1 ? "   ×" + t.getValue() + " (write it once)" : ""), t.getKey(), null));
                }
            }
            addIfAny(settings, used);
        }
        for (QueryParamTypeConst t : QueryParamTypeConst.values()) {
            String label = "$" + t.getCode() + "   " + t.getName();
            if (matches(q, label + " " + t.getDescription())) {
                settings.add(leaf(Kind.SETTING_TYPE, label, t, null));
            }
        }

        DefaultMutableTreeNode bridge = section("Fishbowl functions");
        for (Bridge.Fn f : Bridge.all()) {
            if (matches(q, f.call() + " " + f.doc)) {
                bridge.add(leaf(Kind.BRIDGE, f.call(), f, null));
            }
        }

        DefaultMutableTreeNode modules = section(everyModule.isSelected() ? "Modules (all)" : "Modules in this app");
        Collection<JsIndex.Module> shown = everyModule.isSelected() ? merged() : pageModules;
        for (JsIndex.Module m : shown) {
            DefaultMutableTreeNode mod = new DefaultMutableTreeNode(new Item(Kind.MODULE,
                m.scriptName + (m.roots.isEmpty() ? "  (" + m.note + ")" : "  (" + rootNames(m) + ")"), m, m));
            for (JsIndex.Symbol r : m.roots) {
                addSymbol(mod, m, r, q);
            }
            if (q.isEmpty() || mod.getChildCount() > 0) {
                modules.add(mod);
            }
        }
        if (modules.getChildCount() == 0 && q.isEmpty()) {
            modules.add(leaf(Kind.SECTION, everyModule.isSelected() ? "Indexing…" : "This app includes no indexed script", null, null));
        }
        // Most used first: the page's own modules, then what it can include.
        root.add(modules);
        addIfAny(root, inc);
        addIfAny(root, bridge);
        addIfAny(root, settings);

        model.reload();
        if (!q.isEmpty()) {
            for (int i = 0; i < tree.getRowCount() && i < 400; i++) {
                tree.expandRow(i);
            }
        } else {
            restore(expanded);
        }
    }

    private Collection<JsIndex.Module> merged() {
        Map<String, JsIndex.Module> out = new LinkedHashMap<>();
        for (JsIndex.Module m : pageModules) {
            out.put(m.scriptName, m);
        }
        out.putAll(allModules);
        return out.values();
    }

    private void addSymbol(DefaultMutableTreeNode parent, JsIndex.Module m, JsIndex.Symbol s, String q) {
        String label = s.kind == JsIndex.Kind.FUNCTION ? s.name + "(" + s.params + ")"
            : s.kind == JsIndex.Kind.GETTER ? s.name + "  (getter)" : s.name;
        DefaultMutableTreeNode node = new DefaultMutableTreeNode(new Item(Kind.SYMBOL, label, s, m));
        for (JsIndex.Symbol c : s.children.values()) {
            addSymbol(node, m, c, q);
        }
        if (q.isEmpty() || node.getChildCount() > 0 || matches(q, s.path + " " + s.doc)) {
            parent.add(node);
        }
    }

    private static String rootNames(JsIndex.Module m) {
        List<String> names = new ArrayList<>();
        for (JsIndex.Symbol r : m.roots) {
            names.add(r.name);
        }
        return String.join(", ", names);
    }

    private static DefaultMutableTreeNode section(String label) {
        return new DefaultMutableTreeNode(new Item(Kind.SECTION, label, null, null));
    }

    private static DefaultMutableTreeNode leaf(Kind kind, String label, Object payload, JsIndex.Module m) {
        return new DefaultMutableTreeNode(new Item(kind, label, payload, m), false);
    }

    private static void addIfAny(DefaultMutableTreeNode parent, DefaultMutableTreeNode child) {
        if (child.getChildCount() > 0) {
            parent.add(child);
        }
    }

    private static boolean matches(String q, String text) {
        return q.isEmpty() || (text != null && text.toLowerCase(Locale.ROOT).contains(q));
    }

    static String key(ScriptService.Includable s) {
        return s.typeName().toLowerCase(Locale.ROOT) + ":" + PageIncludes.includeName(s.name).toLowerCase(Locale.ROOT);
    }

    private static String typeLabel(int type) {
        switch (type) {
            case 20: return "Scripts";
            case 30: return "Styles";
            case 40: return "Templates";
            default: return "Images";
        }
    }

    private Set<String> expandedLabels() {
        Set<String> out = new HashSet<>();
        for (int i = 0; i < tree.getRowCount(); i++) {
            TreePath p = tree.getPathForRow(i);
            if (tree.isExpanded(p)) {
                out.add(p.toString());
            }
        }
        return out;
    }

    private final Set<String> seenModules = new HashSet<>();

    private void restore(Set<String> expanded) {
        for (int i = 0; i < tree.getRowCount(); i++) {
            if (expanded.contains(tree.getPathForRow(i).toString())) {
                tree.expandRow(i);
            }
        }
        // First sight: open Modules, each newly indexed module and its namespace, and Includes > Scripts.
        for (int i = 0; i < root.getChildCount(); i++) {
            DefaultMutableTreeNode section = (DefaultMutableTreeNode) root.getChildAt(i);
            String label = String.valueOf(section.getUserObject());
            boolean first = expanded.isEmpty();
            if (label.startsWith("Modules")) {
                if (first) {
                    expand(section);
                }
                for (int j = 0; j < section.getChildCount(); j++) {
                    DefaultMutableTreeNode mod = (DefaultMutableTreeNode) section.getChildAt(j);
                    Object u = mod.getUserObject();
                    if (u instanceof Item && ((Item) u).kind == Kind.MODULE && seenModules.add(((Item) u).module.scriptName)) {
                        expand(section);
                        expand(mod);
                        if (mod.getChildCount() > 0) {
                            expand((DefaultMutableTreeNode) mod.getChildAt(0));
                        }
                    }
                }
            } else if (first && label.equals("Includes")) {
                expand(section);
                if (section.getChildCount() > 0) {
                    expand((DefaultMutableTreeNode) section.getChildAt(0));
                }
            }
        }
    }

    private void expand(DefaultMutableTreeNode node) {
        tree.expandPath(new TreePath(node.getPath()));
    }

    private Item selected() {
        TreePath p = tree.getSelectionPath();
        Object n = p == null ? null : p.getLastPathComponent();
        Object u = n instanceof DefaultMutableTreeNode ? ((DefaultMutableTreeNode) n).getUserObject() : null;
        return u instanceof Item ? (Item) u : null;
    }

    // ---------------------------------------------------------------- actions
    private void activate(Item it) {
        if (it == null || !editable) {
            return;
        }
        switch (it.kind) {
            case INCLUDE:
                actions.insertInclude((ScriptService.Includable) it.payload);
                break;
            case SETTING_TYPE:
                actions.addSetting((QueryParamTypeConst) it.payload);
                break;
            case BRIDGE:
                actions.insertBridge((Bridge.Fn) it.payload);
                break;
            case SYMBOL:
                actions.insertSymbol(it.module, (JsIndex.Symbol) it.payload);
                break;
            default:
                break;
        }
    }

    private void popup(MouseEvent e) {
        if (!e.isPopupTrigger()) {
            return;
        }
        TreePath p = tree.getPathForLocation(e.getX(), e.getY());
        if (p == null) {
            return;
        }
        tree.setSelectionPath(p);
        Item it = selected();
        if (it != null && isSetting(it)) {
            QueryParamTypeConst type = it.kind == Kind.SETTING_TYPE ? (QueryParamTypeConst) it.payload : null;
            JPopupMenu menu = new JPopupMenu();
            JMenuItem add = new JMenuItem(type == null ? "Add setting…" : "Add $" + type.getCode() + " setting…");
            add.setEnabled(editable);
            add.addActionListener(ev -> actions.addSetting(type));
            menu.add(add);
            menu.show(tree, e.getX(), e.getY());
            return;
        }
        ScriptService.Includable target = null;
        if (it != null && it.kind == Kind.INCLUDE) {
            target = (ScriptService.Includable) it.payload;
        } else if (it != null && (it.kind == Kind.MODULE || it.kind == Kind.SYMBOL) && it.module != null) {
            for (ScriptService.Includable s : includables) {
                if (s.name.equals(it.module.scriptName)) {
                    target = s;
                }
            }
        }
        if (target == null) {
            return;
        }
        ScriptService.Includable open = target;
        JPopupMenu menu = new JPopupMenu();
        JMenuItem item = new JMenuItem("Open " + open.name + " in the editor");
        item.addActionListener(ev -> actions.openScript(open));
        menu.add(item);
        menu.show(tree, e.getX(), e.getY());
    }

    /** The Report settings section, its "In this app" group, or one of their items. */
    private boolean isSetting(Item it) {
        return it.kind == Kind.SETTING_TYPE || it.kind == Kind.SETTING_USED
            || (it.kind == Kind.SECTION && (SETTINGS.equals(it.label) || USED.equals(it.label)));
    }

    private void showDoc(Item it) {
        String html;
        if (it != null && it.kind == Kind.SECTION && SETTINGS.equals(it.label)) {
            html = "<b>Report settings</b><br>Values set from the app's Settings button, substituted into the page as tokens."
                + "<br><br>Double-click a type to add one, or right-click and <b>Add setting…</b> to choose the type in the dialog.";
        } else if (it == null || it.kind == Kind.SECTION) {
            html = "<i>Select an item to see what it inserts. Double-click or Enter inserts it at the caret.</i>";
        } else if (it.kind == Kind.INCLUDE) {
            ScriptService.Includable s = (ScriptService.Includable) it.payload;
            boolean in = included.contains(key(s));
            html = "<b>" + Completions.esc(s.name) + "</b> &nbsp;<small>" + s.typeName() + (s.builtIn ? " · built in" : "") + "</small>"
                + (s.description.isEmpty() ? "" : "<br>" + Completions.esc(s.description))
                + "<br><br><code>" + Completions.esc(Inserts.directive(s.typeName(), s.name)) + "</code>"
                + "<br><br>" + (in ? "Already included: Fishbowl replaces every copy of a directive, so it is written once."
                : "Inserts the directive at the caret, in its own &lt;" + ("Style".equals(s.typeName()) ? "style" : "script")
                + "&gt; block when the caret isn't in one.")
                + "<br><i>Right-click to open it in the editor.</i>";
        } else if (it.kind == Kind.SETTING_TYPE) {
            QueryParamTypeConst t = (QueryParamTypeConst) it.payload;
            html = "<b>$" + t.getCode() + "</b> &nbsp;" + Completions.esc(t.getName())
                + "<br>" + Completions.esc(t.getDescription())
                + "<br><br>Double-click (or right-click, Add) asks for a title, default and tab, then inserts e.g. <code>"
                + Completions.esc(t.buildCode("Title", "", t.getTabName(), false)) + "</code>"
                + "<br><br>Fishbowl substitutes every copy of a token: write each once.";
        } else if (it.kind == Kind.SETTING_USED) {
            html = "<code>" + Completions.esc((String) it.payload) + "</code><br><br>A setting this app already uses.";
        } else if (it.kind == Kind.BRIDGE) {
            Bridge.Fn f = (Bridge.Fn) it.payload;
            html = Completions.html(f.call(), f.doc, "Fishbowl bridge function: every app has it");
        } else if (it.kind == Kind.MODULE) {
            JsIndex.Module m = (JsIndex.Module) it.payload;
            html = "<b>" + Completions.esc(m.scriptName) + "</b>" + (m.note.isEmpty() ? "" : " <i>(" + Completions.esc(m.note) + ")</i>")
                + "<br><br>" + Completions.esc(m.summary).replace("\n", "<br>");
        } else {
            JsIndex.Symbol s = (JsIndex.Symbol) it.payload;
            boolean inPage = pageModules.contains(it.module);
            html = Completions.html(s.signature(), s.doc, it.module.scriptName + (s.line > 0 ? ", line " + s.line : "")
                + (s.async ? " · async (returns a Promise)" : ""))
                + (inPage ? "" : "<br><br><b>Not included in this app:</b> inserting offers to add its include.");
        }
        if (!editable) {
            html += "<br><br><i>Read-only: nothing can be inserted.</i>";
        }
        doc.setText("<html><body style='font-family:sans-serif;font-size:11px'>" + html + "</body></html>");
        doc.setCaretPosition(0);
    }
}
