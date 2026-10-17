package com.fbi.plugins.reportbtn.editor;

import com.fbi.sdk.constants.bi.BiScriptTypeConst;

import javax.swing.AbstractAction;
import javax.swing.BorderFactory;
import javax.swing.DropMode;
import javax.swing.Icon;
import javax.swing.JButton;
import javax.swing.JCheckBox;
import javax.swing.JComboBox;
import javax.swing.JComponent;
import javax.swing.JLabel;
import javax.swing.JMenu;
import javax.swing.JMenuItem;
import javax.swing.JPanel;
import javax.swing.JPopupMenu;
import javax.swing.JScrollPane;
import javax.swing.JTextField;
import javax.swing.JTree;
import javax.swing.KeyStroke;
import javax.swing.SwingUtilities;
import javax.swing.ToolTipManager;
import javax.swing.TransferHandler;
import javax.swing.event.DocumentEvent;
import javax.swing.event.DocumentListener;
import javax.swing.tree.DefaultMutableTreeNode;
import javax.swing.tree.DefaultTreeCellRenderer;
import javax.swing.tree.DefaultTreeModel;
import javax.swing.tree.TreePath;
import javax.swing.tree.TreeSelectionModel;
import java.awt.BorderLayout;
import java.awt.Color;
import java.awt.Component;
import java.awt.FlowLayout;
import java.awt.Insets;
import java.awt.datatransfer.StringSelection;
import java.awt.datatransfer.Transferable;
import java.awt.event.ActionEvent;
import java.awt.event.KeyEvent;
import java.awt.event.MouseAdapter;
import java.awt.event.MouseEvent;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * The editor's left panel, in two views:
 * - Folders: every app in its folder (the fb-folder tag; one level: Fishbowl's own
 *   Company report folders plus the ones apps use or users create), apps without
 *   one under Unfiled, then the shared scripts, styles and templates.
 * - Apps menus: the module association (fb-launch): each menu group, its "All ...
 *   modules" node and its modules, with the apps each Apps menu lists, so apps can
 *   be taken out of (or dragged between) Apps menus in bulk.
 *
 * Filter as you type; select several (Ctrl/Shift+click) and right-click to publish,
 * activate, make dashboard gadgets, change access, duplicate, download or delete.
 * Drag apps onto a folder (or use Move to folder) to refile them. One instance,
 * owned by EditorFeature, moves into whichever editor tab is showing.
 */
final class AppExplorer extends JPanel {

    /** A folder with its count. A target folder takes dropped apps; its name is null for Unfiled. */
    private static final class Folder {
        final String label;
        final boolean target;
        final String name;
        final boolean isNative;
        /** An Apps-menu node: name is its key (module or menu group); null for "In no Apps menu". */
        final boolean menu;
        int count;

        Folder(String label) {
            this(label, false, null, false, false);
        }

        Folder(String label, boolean target, String name, boolean isNative) {
            this(label, target, name, isNative, false);
        }

        Folder(String label, boolean target, String name, boolean isNative, boolean menu) {
            this.label = label;
            this.target = target;
            this.name = name;
            this.isNative = isNative;
            this.menu = menu;
        }

        @Override
        public String toString() {
            return label + "  (" + count + ")";
        }
    }

    private final EditorFeature feature;
    private final AppActions actions;
    private final JTextField filter = new JTextField();
    private final JCheckBox showInactive = new JCheckBox("Inactive", true);
    private final JCheckBox showEmpty = new JCheckBox("Empty", true);
    private final JComboBox<String> viewBox = new JComboBox<>(new String[] {"Folders", "Apps menus"});
    /** The view chosen last, for the next editor session. */
    private static int lastView;
    private final DefaultMutableTreeNode root = new DefaultMutableTreeNode("Apps");
    private final DefaultTreeModel model = new DefaultTreeModel(root);
    private final JTree tree = new JTree(model);
    private final JLabel status = new JLabel(" ");
    private List<ScriptService.Entry> entries = Collections.emptyList();
    private List<String> nativeFolders = Collections.emptyList();
    private List<String> createdFolders = Collections.emptyList();
    private boolean everBuilt;
    /** What is being dragged, from createTransferable to exportDone. */
    private List<ScriptService.Entry> dragging;

    AppExplorer(EditorFeature feature) {
        super(new BorderLayout(0, 3));
        this.feature = feature;
        this.actions = new AppActions(feature);
        setBorder(BorderFactory.createEmptyBorder(4, 4, 2, 2));

        filter.setToolTipText("Filter by name, description, folder, Apps menu or type");
        filter.getDocument().addDocumentListener(new DocumentListener() {
            public void insertUpdate(DocumentEvent e) { rebuild(); }
            public void removeUpdate(DocumentEvent e) { rebuild(); }
            public void changedUpdate(DocumentEvent e) { rebuild(); }
        });
        for (JCheckBox b : new JCheckBox[] {showInactive, showEmpty}) {
            b.setFocusable(false);
            b.addActionListener(e -> rebuild());
        }
        showInactive.setToolTipText("Show inactive records (greyed)");
        showEmpty.setToolTipText("Show folders (or Apps menus) with no apps, to drop apps into");
        viewBox.setSelectedIndex(lastView);
        viewBox.setFocusable(false);
        viewBox.setToolTipText("Folders: where apps are filed. Apps menus: which modules' Reports › Apps menu lists each app.");
        viewBox.addActionListener(e -> {
            lastView = viewBox.getSelectedIndex();
            rebuild();
        });
        JButton refresh = tool("↻", "Reload the list from Fishbowl", feature::reloadCatalog);
        JButton menu = tool("Actions ▾", "What to do with the selected records (or right-click them)", null);
        menu.addActionListener(e -> showMenu(menu, 0, menu.getHeight()));

        JPanel top = new JPanel(new BorderLayout(0, 2));
        JPanel find = new JPanel(new BorderLayout(4, 0));
        find.add(new JLabel("Filter"), BorderLayout.WEST);
        find.add(filter, BorderLayout.CENTER);
        top.add(find, BorderLayout.NORTH);
        JPanel bar = new JPanel(new FlowLayout(FlowLayout.LEFT, 2, 0));
        bar.add(viewBox);
        bar.add(menu);
        bar.add(refresh);
        bar.add(showInactive);
        bar.add(showEmpty);
        top.add(bar, BorderLayout.SOUTH);
        add(top, BorderLayout.NORTH);

        tree.setRootVisible(false);
        tree.setShowsRootHandles(true);
        tree.getSelectionModel().setSelectionMode(TreeSelectionModel.DISCONTIGUOUS_TREE_SELECTION);
        tree.setCellRenderer(new Renderer());
        tree.setToggleClickCount(0);
        tree.setDragEnabled(true);
        tree.setDropMode(DropMode.ON);
        tree.setTransferHandler(new Dnd());
        ToolTipManager.sharedInstance().registerComponent(tree);
        tree.addMouseListener(new MouseAdapter() {
            @Override
            public void mouseClicked(MouseEvent e) {
                if (e.getClickCount() == 2 && !e.isPopupTrigger()) {
                    TreePath p = tree.getPathForLocation(e.getX(), e.getY());
                    if (p != null && entryOf(p.getLastPathComponent()) != null) {
                        feature.openEntry(entryOf(p.getLastPathComponent()));
                    } else if (p != null) {
                        if (tree.isExpanded(p)) {
                            tree.collapsePath(p);
                        } else {
                            tree.expandPath(p);
                        }
                    }
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
        bind(KeyStroke.getKeyStroke(KeyEvent.VK_ENTER, 0), "ax.open", () -> {
            List<ScriptService.Entry> sel = selected();
            if (sel.size() == 1) {
                feature.openEntry(sel.get(0));
            }
        });
        bind(KeyStroke.getKeyStroke(KeyEvent.VK_DELETE, 0), "ax.delete", () -> {
            if (!selected().isEmpty()) {
                actions.delete(this, selected());
            }
        });
        add(new JScrollPane(tree), BorderLayout.CENTER);
        status.setBorder(BorderFactory.createEmptyBorder(2, 2, 0, 0));
        add(status, BorderLayout.SOUTH);
    }

    void setEntries(List<ScriptService.Entry> list, List<String> nativeList, List<String> created) {
        entries = list == null ? Collections.emptyList() : list;
        nativeFolders = nativeList == null ? Collections.emptyList() : nativeList;
        createdFolders = created == null ? Collections.emptyList() : created;
        rebuild();
    }

    AppActions actions() {
        return actions;
    }

    void setLoading() {
        status.setText("Loading…");
    }

    /** Every folder name: Fishbowl's, created, and used by apps (case-insensitively unique), in folder order. */
    List<String> folderNames() {
        Map<String, String> byKey = new LinkedHashMap<>();
        for (String f : nativeFolders) {
            byKey.putIfAbsent(f.toLowerCase(Locale.ROOT), f);
        }
        for (String f : createdFolders) {
            byKey.putIfAbsent(f.toLowerCase(Locale.ROOT), f);
        }
        for (ScriptService.Entry e : entries) {
            if (e.typeId == 10 && !e.folder.isEmpty()) {
                byKey.putIfAbsent(e.folder.toLowerCase(Locale.ROOT), e.folder);
            }
        }
        List<String> out = new ArrayList<>(byKey.values());
        out.sort(AppGroups::compareFolders);
        return out;
    }

    // ---------------------------------------------------------------- tree
    private boolean menusView() {
        return viewBox.getSelectedIndex() == 1;
    }

    private void rebuild() {
        Set<String> expanded = expandedLabels();
        Set<Integer> selectedIds = new HashSet<>();
        for (ScriptService.Entry e : selected()) {
            selectedIds.add(e.id);
        }
        String q = filter.getText().trim().toLowerCase(Locale.ROOT);
        root.removeAllChildren();
        if (menusView()) {
            int[] counts = buildMenus(q);
            finish(expanded, selectedIds, q, counts[0], counts[1]);
            return;
        }

        Set<String> nativeKeys = new HashSet<>();
        for (String f : nativeFolders) {
            nativeKeys.add(f.toLowerCase(Locale.ROOT));
        }
        Map<String, DefaultMutableTreeNode> folders = new LinkedHashMap<>();
        for (String f : folderNames()) {
            folders.put(f.toLowerCase(Locale.ROOT), node(new Folder(f, true, f, nativeKeys.contains(f.toLowerCase(Locale.ROOT)))));
        }
        DefaultMutableTreeNode unfiled = node(new Folder(AppGroups.UNFILED, true, null, false));
        Map<Integer, DefaultMutableTreeNode> shared = new LinkedHashMap<>();
        shared.put(20, folder("Scripts"));
        shared.put(30, folder("Styles"));
        shared.put(40, folder("Templates"));

        int apps = 0, shown = 0;
        for (ScriptService.Entry e : entries) {
            if (!showInactive.isSelected() && !e.active) {
                continue;
            }
            if (!q.isEmpty() && !matches(e, q)) {
                continue;
            }
            shown++;
            DefaultMutableTreeNode f;
            if (e.typeId != 10) {
                f = shared.get(e.typeId);
            } else {
                apps++;
                f = e.folder.isEmpty() ? unfiled : folders.get(e.folder.toLowerCase(Locale.ROOT));
            }
            if (f != null) {
                f.add(leaf(e));
                ((Folder) f.getUserObject()).count++;
            }
        }
        boolean empties = showEmpty.isSelected() && q.isEmpty();
        for (DefaultMutableTreeNode f : folders.values()) {
            if (f.getChildCount() > 0 || empties) {
                root.add(f);
            }
        }
        if (unfiled.getChildCount() > 0) {
            root.add(unfiled);
        }
        DefaultMutableTreeNode sharedNode = folder("Shared");
        for (DefaultMutableTreeNode f : shared.values()) {
            if (f.getChildCount() > 0) {
                sharedNode.add(f);
                ((Folder) sharedNode.getUserObject()).count += ((Folder) f.getUserObject()).count;
            }
        }
        if (sharedNode.getChildCount() > 0) {
            root.add(sharedNode);
        }
        finish(expanded, selectedIds, q, shown, apps);
    }

    private void finish(Set<String> expanded, Set<Integer> selectedIds, String q, int shown, int apps) {
        model.reload();
        if (!q.isEmpty()) {
            for (int i = 0; i < tree.getRowCount(); i++) {
                tree.expandRow(i);
            }
        } else if (everBuilt || entries.isEmpty()) {
            restore(expanded);
        }
        everBuilt |= !entries.isEmpty();
        reselect(selectedIds);
        status.setText(entries.isEmpty() ? "No records" : shown + " shown · " + apps + " app" + (apps == 1 ? "" : "s")
            + (q.isEmpty() ? "" : " match"));
    }

    /**
     * The Apps menus view: each menu group with its "All ... modules" node and its
     * modules, holding the apps each lists; then the apps in no Apps menu. An app
     * appears under every node its association names. Returns {shown, apps}.
     */
    private int[] buildMenus(String q) {
        boolean empties = showEmpty.isSelected() && q.isEmpty();
        int apps = 0;
        Map<String, DefaultMutableTreeNode> nodes = new LinkedHashMap<>();
        for (String g : AppGroups.GROUPS.keySet()) {
            if (AppGroups.NONE.equals(g)) {
                continue;
            }
            String gk = g.toUpperCase(Locale.ROOT);
            nodes.put(gk, node(new Folder(AppGroups.keyLabel(gk), true, gk, false, true)));
            for (Map.Entry<String, String> m : AppGroups.MODULE_GROUP.entrySet()) {
                if (m.getValue().equals(g)) {
                    nodes.put(m.getKey(), node(new Folder(AppGroups.moduleLabel(m.getKey()), true, m.getKey(), false, true)));
                }
            }
        }
        DefaultMutableTreeNode none = node(new Folder("In no Apps menu", true, null, false, true));
        for (ScriptService.Entry e : entries) {
            if (e.typeId != 10 || (!showInactive.isSelected() && !e.active) || (!q.isEmpty() && !matches(e, q))) {
                continue;
            }
            apps++;
            boolean placed = false;
            for (String k : AppGroups.keys(e.launchTag)) {
                DefaultMutableTreeNode n = nodes.get(k.toUpperCase(Locale.ROOT));
                if (n != null) {
                    n.add(leaf(e));
                    ((Folder) n.getUserObject()).count++;
                    placed = true;
                }
            }
            if (!placed) {
                none.add(leaf(e));
                ((Folder) none.getUserObject()).count++;
            }
        }
        for (String g : AppGroups.GROUPS.keySet()) {
            if (AppGroups.NONE.equals(g)) {
                continue;
            }
            DefaultMutableTreeNode group = folder(AppGroups.groupLabel(g));
            Folder gf = (Folder) group.getUserObject();
            DefaultMutableTreeNode all = nodes.get(g.toUpperCase(Locale.ROOT));
            if (all.getChildCount() > 0 || empties) {
                group.add(all);
                gf.count += ((Folder) all.getUserObject()).count;
            }
            for (Map.Entry<String, String> m : AppGroups.MODULE_GROUP.entrySet()) {
                DefaultMutableTreeNode n = nodes.get(m.getKey());
                if (m.getValue().equals(g) && (n.getChildCount() > 0 || empties)) {
                    group.add(n);
                    gf.count += ((Folder) n.getUserObject()).count;
                }
            }
            if (group.getChildCount() > 0) {
                root.add(group);
            }
        }
        if (none.getChildCount() > 0) {
            root.add(none);
        }
        return new int[] {apps, apps};
    }

    /** In the Apps menus view: the selected apps with the node each was selected under. */
    private List<AppActions.KeyMove> selectedKeyMoves() {
        Map<String, AppActions.KeyMove> out = new LinkedHashMap<>();
        TreePath[] paths = tree.getSelectionPaths();
        if (paths != null) {
            for (TreePath p : paths) {
                ScriptService.Entry e = entryOf(p.getLastPathComponent());
                Folder parent = p.getParentPath() == null ? null : folderOf(p.getParentPath().getLastPathComponent());
                if (e != null && e.typeId == 10 && parent != null && parent.menu) {
                    out.putIfAbsent(e.id + "/" + parent.name, new AppActions.KeyMove(e, parent.name));
                }
            }
        }
        return new ArrayList<>(out.values());
    }

    private static boolean matches(ScriptService.Entry e, String q) {
        StringBuilder hay = new StringBuilder(e.name).append(' ').append(e.description).append(' ').append(e.kind())
            .append(' ').append(e.folder.isEmpty() && e.typeId == 10 ? AppGroups.UNFILED : e.folder)
            .append(' ').append(e.launchTag).append(' ').append(AppGroups.describe(e.launchTag));
        if (!e.active) {
            hay.append(" inactive");
        }
        if (e.typeId == 10 && !e.published) {
            hay.append(" unpublished");
        }
        if (e.typeId == 10) {
            hay.append(e.system ? " system" : " custom");
        }
        if (e.gadget()) {
            hay.append(" gadget");
        }
        return hay.toString().toLowerCase(Locale.ROOT).contains(q);
    }

    private static DefaultMutableTreeNode folder(String label) {
        return node(new Folder(label));
    }

    private static DefaultMutableTreeNode node(Folder f) {
        return new DefaultMutableTreeNode(f);
    }

    private static DefaultMutableTreeNode leaf(ScriptService.Entry e) {
        return new DefaultMutableTreeNode(e, false);
    }

    private static ScriptService.Entry entryOf(Object node) {
        Object u = node instanceof DefaultMutableTreeNode ? ((DefaultMutableTreeNode) node).getUserObject() : null;
        return u instanceof ScriptService.Entry ? (ScriptService.Entry) u : null;
    }

    private static Folder folderOf(Object node) {
        Object u = node instanceof DefaultMutableTreeNode ? ((DefaultMutableTreeNode) node).getUserObject() : null;
        return u instanceof Folder ? (Folder) u : null;
    }

    /** The selected records, once each; a folder selects what it holds. */
    List<ScriptService.Entry> selected() {
        Map<Integer, ScriptService.Entry> out = new LinkedHashMap<>();
        TreePath[] paths = tree.getSelectionPaths();
        if (paths == null) {
            return new ArrayList<>();
        }
        for (TreePath p : paths) {
            collect((DefaultMutableTreeNode) p.getLastPathComponent(), out);
        }
        return new ArrayList<>(out.values());
    }

    /** The selected apps (pages), for moving: only leaves, not what a selected folder holds. */
    private List<ScriptService.Entry> selectedApps() {
        Map<Integer, ScriptService.Entry> out = new LinkedHashMap<>();
        TreePath[] paths = tree.getSelectionPaths();
        if (paths != null) {
            for (TreePath p : paths) {
                ScriptService.Entry e = entryOf(p.getLastPathComponent());
                if (e != null && e.typeId == 10) {
                    out.putIfAbsent(e.id, e);
                }
            }
        }
        return new ArrayList<>(out.values());
    }

    /** The one selected folder node (for folder actions), or null. */
    private DefaultMutableTreeNode selectedFolderNode() {
        TreePath[] paths = tree.getSelectionPaths();
        if (paths == null || paths.length != 1) {
            return null;
        }
        DefaultMutableTreeNode n = (DefaultMutableTreeNode) paths[0].getLastPathComponent();
        Folder f = folderOf(n);
        return f != null && f.target && f.name != null ? n : null;
    }

    private static void collect(DefaultMutableTreeNode n, Map<Integer, ScriptService.Entry> out) {
        ScriptService.Entry e = entryOf(n);
        if (e != null) {
            out.putIfAbsent(e.id, e);
            return;
        }
        for (int i = 0; i < n.getChildCount(); i++) {
            collect((DefaultMutableTreeNode) n.getChildAt(i), out);
        }
    }

    private Set<String> expandedLabels() {
        Set<String> out = new LinkedHashSet<>();
        for (int i = 0; i < tree.getRowCount(); i++) {
            TreePath p = tree.getPathForRow(i);
            if (tree.isExpanded(p)) {
                out.add(key(p));
            }
        }
        return out;
    }

    private void restore(Set<String> expanded) {
        for (int i = 0; i < tree.getRowCount(); i++) {
            if (expanded.contains(key(tree.getPathForRow(i)))) {
                tree.expandRow(i);
            }
        }
    }

    /** A folder's path by labels without counts, so it survives a count change. */
    private static String key(TreePath p) {
        StringBuilder b = new StringBuilder();
        for (Object o : p.getPath()) {
            Object u = ((DefaultMutableTreeNode) o).getUserObject();
            b.append('/').append(u instanceof Folder ? ((Folder) u).label : String.valueOf(u));
        }
        return b.toString();
    }

    /**
     * Shows the record being edited: its folder opened, the record selected and
     * scrolled to. Kept as it is when the record is already selected (an app listed
     * in several Apps menus stays where it was picked); nothing happens when it isn't
     * in the tree (not saved yet, filtered out, or inactive and hidden).
     */
    void reveal(int scriptId) {
        if (scriptId <= 0) {
            return;
        }
        TreePath[] sel = tree.getSelectionPaths();
        if (sel != null && sel.length == 1) {
            ScriptService.Entry e = entryOf(sel[0].getLastPathComponent());
            if (e != null && e.id == scriptId) {
                tree.scrollPathToVisible(sel[0]);
                return;
            }
        }
        java.util.Enumeration<javax.swing.tree.TreeNode> all = root.depthFirstEnumeration();
        while (all.hasMoreElements()) {
            DefaultMutableTreeNode n = (DefaultMutableTreeNode) all.nextElement();
            ScriptService.Entry e = entryOf(n);
            if (e != null && e.id == scriptId) {
                TreePath p = new TreePath(n.getPath());
                tree.expandPath(p.getParentPath());
                tree.setSelectionPath(p);
                tree.scrollPathToVisible(p);
                return;
            }
        }
    }

    private void reselect(Set<Integer> ids) {
        if (ids.isEmpty()) {
            return;
        }
        List<TreePath> paths = new ArrayList<>();
        Set<Integer> done = new HashSet<>();
        for (int i = 0; i < tree.getRowCount(); i++) {
            TreePath p = tree.getPathForRow(i);
            ScriptService.Entry e = entryOf(p.getLastPathComponent());
            if (e != null && ids.contains(e.id) && done.add(e.id)) {
                paths.add(p);
            }
        }
        if (!paths.isEmpty()) {
            tree.setSelectionPaths(paths.toArray(new TreePath[0]));
        }
    }

    // ---------------------------------------------------------------- drag and drop
    /** Apps drag onto a folder (or an app in one); the move runs after the drop, with a confirm. */
    private final class Dnd extends TransferHandler {
        @Override
        public int getSourceActions(JComponent c) {
            return menusView() ? COPY_OR_MOVE : MOVE;
        }

        @Override
        protected Transferable createTransferable(JComponent c) {
            draggingKeys = menusView() ? selectedKeyMoves() : null;
            dragging = selectedApps();
            if (dragging.isEmpty()) {
                return null;
            }
            StringBuilder names = new StringBuilder();
            for (ScriptService.Entry e : dragging) {
                names.append(names.length() == 0 ? "" : "\n").append(e.name);
            }
            return new StringSelection(names.toString());
        }

        @Override
        protected void exportDone(JComponent source, Transferable data, int action) {
            dragging = null;
        }

        @Override
        public boolean canImport(TransferSupport s) {
            return s.isDrop() && dragging != null && !dragging.isEmpty() && dropFolder(s) != null;
        }

        @Override
        public boolean importData(TransferSupport s) {
            Folder f = dropFolder(s);
            if (f == null || dragging == null) {
                return false;
            }
            List<ScriptService.Entry> list = new ArrayList<>(dragging);
            if (f.menu) {
                List<AppActions.KeyMove> moves = draggingKeys == null ? new ArrayList<>() : new ArrayList<>(draggingKeys);
                boolean copy = s.getDropAction() == COPY;
                SwingUtilities.invokeLater(() -> actions.moveModule(AppExplorer.this, moves, f.name, copy));
            } else {
                SwingUtilities.invokeLater(() -> actions.moveToFolder(AppExplorer.this, list, f.name));
            }
            return true;
        }

        private Folder dropFolder(TransferSupport s) {
            if (!(s.getDropLocation() instanceof JTree.DropLocation)) {
                return null;
            }
            TreePath p = ((JTree.DropLocation) s.getDropLocation()).getPath();
            if (p == null) {
                return null;
            }
            DefaultMutableTreeNode n = (DefaultMutableTreeNode) p.getLastPathComponent();
            if (entryOf(n) != null) {
                n = (DefaultMutableTreeNode) n.getParent();
            }
            Folder f = folderOf(n);
            return f != null && f.target && f.menu == menusView() ? f : null;
        }
    }

    /** In the Apps menus view, the dragged apps with the node each came from. */
    private List<AppActions.KeyMove> draggingKeys;

    // ---------------------------------------------------------------- menu
    private void popup(MouseEvent e) {
        if (!e.isPopupTrigger()) {
            return;
        }
        TreePath p = tree.getPathForLocation(e.getX(), e.getY());
        if (p != null && !tree.isPathSelected(p)) {
            tree.setSelectionPath(p);
        }
        showMenu(tree, e.getX(), e.getY());
    }

    private void showMenu(Component at, int x, int y) {
        List<ScriptService.Entry> sel = selected();
        List<ScriptService.Entry> apps = selectedApps();
        DefaultMutableTreeNode folderNode = selectedFolderNode();
        JPopupMenu m = new JPopupMenu();
        boolean one = sel.size() == 1;
        boolean anyPublished = false, anyUnpublished = false, anyActive = false, anyInactive = false, anyPage = false;
        for (ScriptService.Entry e : sel) {
            anyActive |= e.active;
            anyInactive |= !e.active;
            if (e.typeId == 10) {
                anyPage = true;
                anyPublished |= e.published;
                anyUnpublished |= !e.published;
            }
        }
        String what = folderNode != null ? ((Folder) folderNode.getUserObject()).label
            : sel.isEmpty() ? "" : one ? sel.get(0).name : sel.size() + " selected";
        item(m, "Open", one, () -> feature.openEntry(sel.get(0)));
        item(m, "Run the app", one && sel.get(0).typeId == 10 && !sel.get(0).reports.isEmpty(), () -> feature.runEntry(sel.get(0)));
        m.addSeparator();
        if (menusView()) {
            List<AppActions.KeyMove> keyed = selectedKeyMoves();
            String from = keyed.stream().map(k -> k.fromKey == null ? "" : k.fromKey.toUpperCase(Locale.ROOT)).distinct().count() == 1
                && !keyed.isEmpty() && keyed.get(0).fromKey != null ? AppGroups.keyLabel(keyed.get(0).fromKey) : null;
            item(m, from != null ? "Remove from " + from : "Remove from its Apps menu",
                keyed.stream().anyMatch(k -> k.fromKey != null), () -> actions.removeFromModule(this, keyed));
            m.add(addMenu(apps));
        }
        item(m, "Apps menus…", anyPage, () -> actions.setModules(this, sel));
        m.add(moveMenu(apps));
        m.addSeparator();
        item(m, "Publish…", anyUnpublished, () -> actions.setPublished(this, sel, true));
        item(m, "Unpublish…", anyPublished, () -> actions.setPublished(this, sel, false));
        item(m, "Activate", anyInactive, () -> actions.setActive(this, sel, true));
        item(m, "Deactivate…", anyActive, () -> actions.setActive(this, sel, false));
        item(m, "Make dashboard gadget", anyPublished, () -> actions.setGadget(this, sel, true));
        item(m, "Remove dashboard gadget", anyPublished, () -> actions.setGadget(this, sel, false));
        item(m, "Access…", anyPublished, () -> actions.access(this, sel));
        m.addSeparator();
        item(m, sel.size() == 1 ? "Duplicate…" : "Duplicate", !sel.isEmpty(), () -> actions.duplicate(this, sel));
        item(m, "Download…", !sel.isEmpty(), () -> actions.download(this, sel));
        m.addSeparator();
        item(m, "Delete…", !sel.isEmpty(), () -> actions.delete(this, sel));
        m.addSeparator();
        boolean manage = ClientRights.mayManageFolders(feature.host());
        if (!menusView()) {
            item(m, "New folder…", manage, () -> actions.newFolder(this, folderNames()));
        }
        if (folderNode != null && !menusView()) {
            Folder f = (Folder) folderNode.getUserObject();
            item(m, "Rename folder…", manage && !f.isNative, () -> actions.renameFolder(this, f.name, pagesIn(folderNode), folderNames(), f.isNative));
            item(m, "Delete folder", manage && !f.isNative && folderNode.getChildCount() == 0,
                () -> actions.deleteFolder(this, f.name, folderNode.getChildCount(), f.isNative));
        }
        item(m, "Refresh", true, feature::reloadCatalog);
        if (!what.isEmpty()) {
            JLabel head = new JLabel(what);
            head.setBorder(BorderFactory.createEmptyBorder(2, 8, 2, 8));
            head.setForeground(Color.GRAY);
            m.insert(head, 0);
        }
        m.show(at, x, y);
    }

    private static List<ScriptService.Entry> pagesIn(DefaultMutableTreeNode folder) {
        List<ScriptService.Entry> out = new ArrayList<>();
        for (int i = 0; i < folder.getChildCount(); i++) {
            ScriptService.Entry e = entryOf(folder.getChildAt(i));
            if (e != null) {
                out.add(e);
            }
        }
        return out;
    }

    /** Every Apps menu, to add the selected apps to. */
    private JMenu addMenu(List<ScriptService.Entry> apps) {
        JMenu menu = new JMenu("Add to Apps menu");
        menu.setEnabled(!apps.isEmpty());
        for (String g : AppGroups.GROUPS.keySet()) {
            if (AppGroups.NONE.equals(g)) {
                continue;
            }
            JMenu sub = new JMenu(AppGroups.groupLabel(g));
            String gk = g.toUpperCase(Locale.ROOT);
            JMenuItem all = new JMenuItem(AppGroups.keyLabel(gk));
            all.addActionListener(e -> actions.addToModule(this, apps, gk));
            sub.add(all);
            sub.addSeparator();
            for (Map.Entry<String, String> mg : AppGroups.MODULE_GROUP.entrySet()) {
                if (mg.getValue().equals(g)) {
                    JMenuItem i = new JMenuItem(AppGroups.moduleLabel(mg.getKey()));
                    String key = mg.getKey();
                    i.addActionListener(e -> actions.addToModule(this, apps, key));
                    sub.add(i);
                }
            }
            menu.add(sub);
        }
        return menu;
    }

    /** Every folder (empty ones too) and Unfiled, plus New folder… when allowed. */
    private JMenu moveMenu(List<ScriptService.Entry> apps) {
        JMenu menu = new JMenu("Move to folder");
        menu.setEnabled(!apps.isEmpty());
        for (String f : folderNames()) {
            JMenuItem i = new JMenuItem(f);
            i.addActionListener(e -> actions.moveToFolder(this, apps, f));
            menu.add(i);
        }
        menu.addSeparator();
        JMenuItem unfiled = new JMenuItem(AppGroups.UNFILED + " (no folder)");
        unfiled.addActionListener(e -> actions.moveToFolder(this, apps, null));
        menu.add(unfiled);
        if (ClientRights.mayManageFolders(feature.host())) {
            JMenuItem created = new JMenuItem("New folder…");
            created.addActionListener(e -> {
                String name = actions.newFolder(this, folderNames());
                if (name != null) {
                    actions.moveToFolder(this, apps, name);
                }
            });
            menu.add(created);
        }
        return menu;
    }

    private static void item(JPopupMenu m, String text, boolean enabled, Runnable r) {
        JMenuItem i = new JMenuItem(text);
        i.setEnabled(enabled);
        i.addActionListener(e -> r.run());
        m.add(i);
    }

    private static JButton tool(String text, String tip, Runnable r) {
        JButton b = new JButton(text);
        b.setToolTipText(tip);
        b.setFocusable(false);
        b.setMargin(new Insets(1, 6, 1, 6));
        if (r != null) {
            b.addActionListener(e -> r.run());
        }
        return b;
    }

    private void bind(KeyStroke k, String id, Runnable r) {
        tree.getInputMap().put(k, id);
        tree.getActionMap().put(id, new AbstractAction() {
            @Override
            public void actionPerformed(ActionEvent e) {
                r.run();
            }
        });
    }

    // ---------------------------------------------------------------- rendering
    private static final class Renderer extends DefaultTreeCellRenderer {
        @Override
        public Component getTreeCellRendererComponent(JTree tree, Object value, boolean sel, boolean expanded, boolean leaf,
                                                      int row, boolean focus) {
            super.getTreeCellRendererComponent(tree, value, sel, expanded, leaf, row, focus);
            setToolTipText(null);
            Folder folder = folderOf(value);
            if (folder != null) {
                setIcon(expanded ? getOpenIcon() : getClosedIcon());   // a folder even when empty
                if (folder.count == 0 && !sel) {
                    setForeground(AppIcons.MUTED);
                }
                setToolTipText(folder.menu ? (folder.name == null ? "Apps that no module's Apps menu lists"
                        : "Listed in the Reports › Apps menu of " + folder.label)
                    : folder.name == null && folder.target ? "Apps that aren't in a folder yet"
                    : folder.isNative ? "One of Fishbowl's report folders (Reporting › Reports)" : folder.target ? "Folder" : null);
                return this;
            }
            ScriptService.Entry e = entryOf(value);
            if (e == null) {
                return this;
            }
            // As Fishbowl's report tree: black for a system app, green for a custom one, grey when inactive.
            Icon icon = e.typeId == 10 ? AppIcons.app(e.system, e.active) : null;
            if (icon == null) {
                icon = e.active ? icon(e.typeId) : AppIcons.greyed(icon(e.typeId));
            }
            if (icon != null) {
                setIcon(icon);
            }
            // Inactive (grey icon) and unpublished (grey text) show by colour alone.
            StringBuilder tags = new StringBuilder();
            if (e.gadget()) {
                tags.append(" · gadget");
            }
            if (e.builtIn) {
                tags.append(" · built in");
            }
            setText(tags.length() == 0 ? e.name : "<html>" + Completions.esc(e.name) + "<font color='#8a8a8a'>"
                + Completions.esc(tags.toString()) + "</font></html>");
            if (e.typeId == 10 && !e.published && !sel) {
                setForeground(AppIcons.MUTED);   // unpublished: listed nowhere, as an empty folder is greyed
            }
            StringBuilder tip = new StringBuilder("<html><b>").append(Completions.esc(e.name)).append("</b> &nbsp;<small>")
                .append(e.typeId == 10 ? (e.system ? "System app" : "Custom app") : e.kind()).append(" #").append(e.id)
                .append("</small>");
            if (e.system) {
                tip.append("<br><i>Ships with Fishbowl, so it can't be changed: duplicate it to make your own.</i>");
            }
            if (!e.description.isEmpty()) {
                tip.append("<br><div style='width:320px'>").append(Completions.esc(e.description)).append("</div>");
            }
            if (e.typeId == 10) {
                tip.append("<br>Folder: ").append(Completions.esc(e.folder.isEmpty() ? AppGroups.UNFILED : e.folder));
                tip.append("<br>Apps menus: ").append(e.launchTag.isEmpty() ? "<i>none</i>"
                    : Completions.esc(AppGroups.describe(e.launchTag)));
            }
            tip.append("<br><i>Double-click to open; drag to move; right-click for more.</i></html>");
            setToolTipText(tip.toString());
            return this;
        }

        private static Icon icon(int typeId) {
            try {
                BiScriptTypeConst t = BiScriptTypeConst.getConst(typeId);
                return t == null ? null : t.getIcon16();
            } catch (RuntimeException | LinkageError ex) {
                return null;
            }
        }
    }
}
