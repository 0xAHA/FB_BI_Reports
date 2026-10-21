package com.fbi.plugins.reportbtn.editor;

import com.evnt.client.modules.biscripteditor.panel.BiAccessRightsPanel;
import com.fbi.fbdata.QueryParameter;
import com.fbi.fbdata.bi.BiReportAccessFpo;
import com.fbi.fbdata.bi.BiScriptFpo;
import com.fbi.plugins.reportbtn.WorkspaceHost;
import com.fbi.plugins.reportbtn.WorkspaceTab;
import com.fbi.sdk.constants.bi.BiScriptTypeConst;
import com.fbi.sdk.constants.bi.QueryParamTypeConst;
import org.fife.ui.rsyntaxtextarea.ErrorStrip;
import org.fife.ui.rsyntaxtextarea.RSyntaxTextArea;
import org.fife.ui.rtextarea.RTextScrollPane;

import javax.swing.AbstractAction;
import javax.swing.BorderFactory;
import javax.swing.Box;
import javax.swing.DefaultListCellRenderer;
import javax.swing.ImageIcon;
import javax.swing.JButton;
import javax.swing.JCheckBox;
import javax.swing.JComboBox;
import javax.swing.JComponent;
import javax.swing.JLabel;
import javax.swing.JList;
import javax.swing.JOptionPane;
import javax.swing.JPanel;
import javax.swing.JSplitPane;
import javax.swing.JTextField;
import javax.swing.JToolBar;
import javax.swing.KeyStroke;
import javax.swing.SwingUtilities;
import javax.swing.Timer;
import javax.swing.event.DocumentEvent;
import javax.swing.event.DocumentListener;
import java.awt.BorderLayout;
import java.awt.Color;
import java.awt.Component;
import java.awt.Cursor;
import java.awt.FlowLayout;
import java.awt.GridBagConstraints;
import java.awt.GridBagLayout;
import java.awt.Insets;
import java.awt.event.ActionEvent;
import java.awt.event.InputEvent;
import java.awt.event.KeyEvent;
import java.net.URL;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Consumer;
import java.util.function.Supplier;

/**
 * One page, script or style being edited: RSyntaxTextArea with the native insert
 * buttons, a selector of includes / settings / functions, a live preview, history,
 * report access, and a save that follows the native editor's rules plus the
 * checks the server doesn't make (rights, conflicts, shared-use warnings).
 */
final class EditorTab extends JPanel implements WorkspaceTab, InsertPanel.Actions, PreviewPane.Owner {

    private final EditorFeature feature;
    /** Panel sizes and choices, shared by the editor tabs and remembered for the user. */
    private final EditorLayout layout;
    private final WorkspaceHost host;
    private final ScriptService service;
    private final int typeId;
    /** The report this tab was opened from (0 for a script, a style or a new page). */
    private final int fromReport;

    private BiScriptFpo fpo;
    private List<AccessPolicy.Report> reports;
    private AccessPolicy.Decision decision;
    /** Access rows for a page saved for the first time. */
    private List<BiReportAccessFpo> firstAccess;

    private String savedText;
    private String savedName;
    private String savedDescription;
    private boolean savedActive;
    private boolean savedPublished;
    /** Every report of the page is a dashboard gadget (bireport.widget). */
    private boolean savedGadget;
    /** The saved page is a system app (fb-origin system): its code is locked; a new record never is one. */
    private boolean savedSystem;

    private final RSyntaxTextArea code;
    private final FindBar findBar;
    private final InsertPanel insertPanel;
    private final PreviewPane preview;
    private final JSplitPane codeSplit;
    private final JSplitPane mainSplit;
    /** The explorer (shared by every editor tab) on the left. */
    private final JPanel explorerSlot = new JPanel(new BorderLayout());
    private final JSplitPane outerSplit;
    private final JCheckBox showApps = new JCheckBox("Apps panel", true);
    private final Completions completions;
    private final DirectiveParser directives;
    private final JTextField name = new JTextField(24);
    private final JTextField description = new JTextField(36);
    private final JCheckBox active = new JCheckBox("Active");
    private final JCheckBox published = new JCheckBox("Published");
    private final JCheckBox gadget = new JCheckBox("Dashboard gadget");
    private final JLabel builtIn = new JLabel();
    private final JLabel banner = new JLabel();
    private final JLabel status = new JLabel(" ");
    private final JCheckBox reloadOnSave = new JCheckBox("Reload app on save", true);
    private final JCheckBox sandbox = new JCheckBox("Sandbox preview");
    private final List<JComponent> editOnly = new ArrayList<>();
    /** Active, Published and Save: also usable on a system app, whose code is locked. */
    private final List<JComponent> flagsOnly = new ArrayList<>();
    private final Timer reparse;
    private List<JsIndex.Module> pageModules = new ArrayList<>();
    private int indexGeneration;

    EditorTab(EditorFeature feature, BiScriptFpo fpo, List<AccessPolicy.Report> reports, int fromReport,
              List<BiReportAccessFpo> firstAccess) {
        super(new BorderLayout());
        this.feature = feature;
        this.layout = feature.layout();
        this.host = feature.host();
        this.service = feature.service();
        this.fpo = fpo;
        this.typeId = fpo.getTypeId();
        this.reports = reports;
        this.fromReport = fromReport;
        this.firstAccess = firstAccess;

        code = CodeArea.create(typeId);
        code.setText(fpo.getData() == null ? "" : fpo.getData());
        code.setCaretPosition(0);
        code.discardAllEdits();
        // A file dropped from Explorer loads into the code, as in the BI Editor; text drags work as before.
        code.setTransferHandler(new DroppedFile.Handler(code.getTransferHandler(), this::dropFiles));
        findBar = new FindBar(code);
        completions = new Completions(code);
        directives = new DirectiveParser();
        code.addParser(directives);
        insertPanel = new InsertPanel(this);
        preview = new PreviewPane(host.plugin(), this, layout.previewRight);

        RTextScrollPane scroll = new RTextScrollPane(code);
        scroll.setFoldIndicatorEnabled(true);
        JPanel codePanel = new JPanel(new BorderLayout());
        codePanel.add(scroll, BorderLayout.CENTER);
        // Beside the scroll bar: every Find all match, marked occurrences and margin warnings.
        ErrorStrip strip = new ErrorStrip(code);
        strip.setShowMarkAll(true);
        strip.setShowMarkedOccurrences(true);
        codePanel.add(strip, BorderLayout.EAST);
        codePanel.add(findBar, BorderLayout.SOUTH);
        codeSplit = new JSplitPane(layout.previewRight ? JSplitPane.HORIZONTAL_SPLIT : JSplitPane.VERTICAL_SPLIT, codePanel, preview);
        codeSplit.setResizeWeight(0.5);
        codeSplit.setBorder(null);
        preview.setVisible(false);
        mainSplit = new JSplitPane(JSplitPane.HORIZONTAL_SPLIT, codeSplit, insertPanel);
        mainSplit.setResizeWeight(1.0);
        mainSplit.setBorder(null);
        explorerSlot.setMinimumSize(new java.awt.Dimension(0, 0));
        outerSplit = new JSplitPane(JSplitPane.HORIZONTAL_SPLIT, explorerSlot, mainSplit);
        outerSplit.setResizeWeight(0);
        explorerSlot.setVisible(layout.showApps);
        showApps.setSelected(layout.showApps);
        outerSplit.setDividerLocation(layout.showApps ? layout.appsWidth : 0);
        outerSplit.setBorder(null);

        JPanel north = new JPanel(new BorderLayout());
        north.add(header(), BorderLayout.NORTH);
        north.add(toolbar(), BorderLayout.SOUTH);
        add(north, BorderLayout.NORTH);
        add(outerSplit, BorderLayout.CENTER);
        status.setBorder(BorderFactory.createEmptyBorder(2, 6, 2, 6));
        add(status, BorderLayout.SOUTH);

        captureSaved();
        loadFields();
        keys();

        reparse = new Timer(600, e -> refreshPage());
        reparse.setRepeats(false);
        DocumentListener changed = new DocumentListener() {
            public void insertUpdate(DocumentEvent e) { edited(); }
            public void removeUpdate(DocumentEvent e) { edited(); }
            public void changedUpdate(DocumentEvent e) { edited(); }
        };
        code.getDocument().addDocumentListener(changed);
        name.getDocument().addDocumentListener(changed);
        description.getDocument().addDocumentListener(changed);
        active.addActionListener(e -> updateTitle());
        published.addActionListener(e -> {
            gadgetEnabled();
            updateTitle();
        });
        gadget.addActionListener(e -> updateTitle());

        decide();
        insertPanel.setIncludables(feature.includables());
        refreshPage();
        insertPanel.setVisible(layout.showInsert);
        SwingUtilities.invokeLater(() -> mainSplit.setDividerLocation(layout.showInsert
            ? Math.max(400, mainSplit.getWidth() - layout.insertWidth) : mainSplit.getWidth()));
        rememberLayout();
    }

    /** A divider the user moves is remembered (for every editor tab, and the next session). */
    private void rememberLayout() {
        outerSplit.addPropertyChangeListener(JSplitPane.DIVIDER_LOCATION_PROPERTY, e -> {
            int loc = outerSplit.getDividerLocation();
            if (outerSplit.isShowing() && showApps.isSelected() && loc > 0) {
                layout.appsWidth = loc;
                layout.saveSoon();
            }
        });
        mainSplit.addPropertyChangeListener(JSplitPane.DIVIDER_LOCATION_PROPERTY, e -> {
            int w = mainSplit.getWidth();
            int loc = mainSplit.getDividerLocation();
            if (mainSplit.isShowing() && insertPanel.isVisible() && w > 0 && loc > 0 && loc < w) {
                layout.insertWidth = w - loc;
                layout.saveSoon();
            }
        });
        codeSplit.addPropertyChangeListener(JSplitPane.DIVIDER_LOCATION_PROPERTY, e -> {
            int size = codeSplit.getOrientation() == JSplitPane.HORIZONTAL_SPLIT ? codeSplit.getWidth() : codeSplit.getHeight();
            int loc = codeSplit.getDividerLocation();
            if (codeSplit.isShowing() && preview.isVisible() && size > 0 && loc > 0 && loc < size) {
                layout.codeRatio = Math.max(0.1, Math.min(0.9, loc / (double) size));
                layout.saveSoon();
            }
        });
    }

    // ---------------------------------------------------------------- identity
    int scriptId() {
        return fpo.getId();
    }

    boolean showsReport(int reportId) {
        for (AccessPolicy.Report r : reports) {
            if (r.id == reportId) {
                return true;
            }
        }
        return false;
    }

    String title() {
        String n = name.getText().trim().isEmpty() ? "New " + kindName().toLowerCase() : name.getText().trim();
        return "✎ " + (n.length() > 36 ? n.substring(0, 35) + "…" : n) + (isDirty() ? " *" : "");
    }

    String tip() {
        return kindName() + (fpo.getId() > 0 ? " #" + fpo.getId() : " (not saved yet)") + ": " + name.getText().trim();
    }

    boolean isDirty() {
        return !code.getText().equals(savedText) || !name.getText().trim().equals(savedName)
            || !description.getText().trim().equals(savedDescription) || active.isSelected() != savedActive
            || (typeId == 10 && published.isSelected() != savedPublished)
            || (typeId == 10 && published.isSelected() && gadget.isSelected() != savedGadget) || fpo.getId() <= 0;
    }

    // ---------------------------------------------------------------- layout
    private JPanel header() {
        JPanel p = new JPanel(new GridBagLayout());
        p.setBorder(BorderFactory.createEmptyBorder(4, 6, 2, 6));
        GridBagConstraints c = new GridBagConstraints();
        c.insets = new Insets(2, 3, 2, 3);
        c.anchor = GridBagConstraints.WEST;
        p.add(new JLabel(kindName() + " name"), c);
        c.fill = GridBagConstraints.HORIZONTAL;
        c.weightx = 0.4;
        p.add(name, c);
        c.weightx = 0;
        c.fill = GridBagConstraints.NONE;
        p.add(new JLabel("Description"), c);
        c.fill = GridBagConstraints.HORIZONTAL;
        c.weightx = 0.6;
        p.add(description, c);
        c.weightx = 0;
        c.fill = GridBagConstraints.NONE;
        p.add(active, c);
        if (typeId == 10) {
            published.setToolTipText("Published apps are listed for users; unpublishing deletes the listing with its settings and access");
            p.add(published, c);
            p.add(gadget, c);
        }
        p.add(builtIn, c);
        editOnly.add(name);
        editOnly.add(description);
        flagsOnly.add(active);
        flagsOnly.add(published);

        banner.setOpaque(true);
        banner.setBackground(new Color(0xFBEDC4));
        banner.setForeground(new Color(0x6B5208));
        banner.setBorder(BorderFactory.createEmptyBorder(4, 8, 4, 8));
        banner.setVisible(false);
        JPanel wrap = new JPanel(new BorderLayout());
        wrap.add(p, BorderLayout.CENTER);
        wrap.add(banner, BorderLayout.SOUTH);
        return wrap;
    }

    // ---------------------------------------------------------------- folder and module association (pages)
    private JButton folderButton;
    private JButton menusButton;

    /**
     * Folder (fb-folder) and Apps menus (fb-launch): each button opens its picker, and
     * the choice edits the tag in the code, undoably, like typing would; Save keeps it.
     */
    private void chooseFolder() {
        if (!editableNow()) {
            return;
        }
        String now = AppGroups.folderContent(code.getText());
        String f = FolderPicker.ask(this, "Folder: " + name.getText().trim(), now, feature.folderNames());
        if (f != null && !f.equals(now)) {
            applyText(AppGroups.setFolder(code.getText(), f));
            status((f.isEmpty() ? "Now unfiled" : "Folder: " + f) + ". Save to keep it.");
        }
    }

    private void chooseMenus() {
        if (savedSystem && fpo.getId() > 0) {
            chooseSystemMenus();
            return;
        }
        if (!editableNow()) {
            return;
        }
        String now = AppGroups.launchContent(code.getText());
        String content = ModulePicker.ask(this, "Apps menus: " + name.getText().trim(), now);
        if (content != null && !content.equals(now)) {
            applyText(AppGroups.rewrite(code.getText(), content));
            status("Apps menus: " + (content.isEmpty() ? "none" : AppGroups.describe(content)) + ". Save to keep it.");
        }
    }

    /**
     * A system app's Apps menus: its code is locked, so the choice is saved at once as
     * the company's (MenuOverrides), and wins over the app's own fb-launch tag.
     */
    private void chooseSystemMenus() {
        if (!decision.canEditFlags) {
            JOptionPane.showMessageDialog(this, "Read only: " + decision.reason, "App editor", JOptionPane.INFORMATION_MESSAGE);
            return;
        }
        String now = systemMenus();
        String content = ModulePicker.ask(this, "Apps menus: " + savedName, now);
        if (content == null || content.equals(now)) {
            return;
        }
        try {
            com.fbi.plugins.reportbtn.MenuOverrides.save(savedName, content);
        } catch (Exception e) {
            JOptionPane.showMessageDialog(this, e.getMessage(), "App editor", JOptionPane.ERROR_MESSAGE);
            return;
        }
        host.invalidateCatalog();
        feature.reloadCatalog();
        syncPlacement();
        status("Apps menus: " + (content.isEmpty() ? "none" : AppGroups.describe(content)) + ". Saved.");
    }

    /** A system app's Apps menus now: the company's stored choice, else its own tag. */
    private String systemMenus() {
        String stored = com.fbi.plugins.reportbtn.MenuOverrides.of(com.fbi.plugins.reportbtn.MenuOverrides.read(host.plugin()), savedName);
        return stored != null ? stored : AppGroups.launchContent(savedText);
    }

    /** The buttons' tooltips say where the app is now (the code's tags are the truth). */
    private void syncPlacement() {
        if (folderButton == null) {
            return;
        }
        String text = code.getText();
        String folder = AppGroups.folderContent(text);
        folderButton.setToolTipText("<html>Folder: <b>" + Completions.esc(folder.isEmpty() ? AppGroups.UNFILED : folder)
            + "</b><br>Where the app sits in the Apps panel and the App Library</html>");
        String launch = savedSystem && fpo.getId() > 0 ? systemMenus() : AppGroups.launchContent(text);
        menusButton.setToolTipText("<html>Apps menus: <b>" + Completions.esc(launch.isEmpty() ? "none" : AppGroups.describe(launch))
            + "</b><br>Which modules' Reports › Apps menus list this app</html>");
    }

    /** Replaces only what changed between the code and next, as one undoable edit. */
    private void applyText(String next) {
        String now = code.getText();
        if (next == null || next.equals(now)) {
            return;
        }
        int start = 0;
        int max = Math.min(now.length(), next.length());
        while (start < max && now.charAt(start) == next.charAt(start)) {
            start++;
        }
        int endNow = now.length(), endNext = next.length();
        while (endNow > start && endNext > start && now.charAt(endNow - 1) == next.charAt(endNext - 1)) {
            endNow--;
            endNext--;
        }
        code.replaceRange(next.substring(start, endNext), start, endNow);
        refreshPage();
    }

    private JToolBar toolbar() {
        JToolBar t = new JToolBar();
        t.setFloatable(false);
        t.setBorder(BorderFactory.createEmptyBorder(0, 4, 2, 4));
        JButton save = tool(t, "Save", "/toolbar/save24.png", "Save (Ctrl+S)", this::save);
        flagsOnly.add(save);
        JButton prev = tool(t, "Preview", "/side_toolbar/media_play_green24.png",
            "Show the unsaved app as users would see it (F5)", this::preview);
        prev.setEnabled(typeId == 10);
        separator(t);
        tool(t, "Find", "/toolbar/find24.png", "Find and replace (Ctrl+F, Ctrl+H) · Go to line (Ctrl+G)", () -> findBar.open(false));
        tool(t, "History", "/toolbar/history24.png", "Saved versions: compare and restore", this::history);
        separator(t);
        tool(t, "Download", "/side_toolbar/download_blue16.png",
            "Download this (and what it includes) as files that Import, here or in the BI Editor, reads back", this::download);
        tool(t, "Duplicate…", "/toolbar/duplicate24.png", "Make a copy under a new name: a custom "
            + kindName().toLowerCase() + " you can edit", this::duplicate);
        if (typeId == 10) {
            separator(t);
            folderButton = tool(t, "Folder…", "/toolbar/folder24.png", null, this::chooseFolder);
            menusButton = tool(t, "Apps menus…", "/toolbar/custom_lists24.png", null, this::chooseMenus);
            editOnly.add(folderButton);
            editOnly.add(menusButton);
            tool(t, "Access…", "/toolbar/group24.png", "Which user groups can open this app or change its settings", this::access);
            tool(t, "Open app", "/toolbar/popup24.png", "Open this app in a new tab", this::openReport);
        }
        separator(t);
        tool(t, "Reload", "/toolbar/refresh24.png", "Discard unsaved changes and load the saved version", this::reloadFromServer);
        separator(t);
        if (typeId == 10) {
            reloadOnSave.setToolTipText("After saving, reload the open tabs that show this app");
            t.add(reloadOnSave);
            sandbox.setToolTipText("Preview without the app's id and settings, as the native editor does");
            t.add(sandbox);
        }
        // In the order of the panels on screen: Apps on the left, Insert on the right.
        showApps.setToolTipText("The list of every app, script and style on the left");
        showApps.addActionListener(e -> {
            explorerSlot.setVisible(showApps.isSelected());
            layout.showApps = showApps.isSelected();
            layout.saveSoon();
            outerSplit.setDividerLocation(showApps.isSelected() ? layout.appsWidth : 0);
            outerSplit.revalidate();
        });
        t.add(showApps);
        JCheckBox showInsert = new JCheckBox("Insert panel", layout.showInsert);
        showInsert.setToolTipText("Includes, app settings, Fishbowl functions and module functions on the right");
        showInsert.addActionListener(e -> {
            insertPanel.setVisible(showInsert.isSelected());
            layout.showInsert = showInsert.isSelected();
            layout.saveSoon();
            mainSplit.setDividerLocation(showInsert.isSelected() ? Math.max(400, mainSplit.getWidth() - layout.insertWidth)
                : mainSplit.getWidth());
        });
        t.add(showInsert);
        return t;
    }

    /** A visible divider between groups of buttons (the client's toolbar buttons have no borders). */
    private static void separator(JToolBar t) {
        javax.swing.JSeparator s = new javax.swing.JSeparator(javax.swing.SwingConstants.VERTICAL);
        java.awt.Dimension d = new java.awt.Dimension(9, 22);
        s.setPreferredSize(d);
        s.setMaximumSize(d);
        t.add(Box.createHorizontalStrut(3));
        t.add(s);
        t.add(Box.createHorizontalStrut(1));
    }

    private JButton tool(JToolBar t, String text, String icon, String tip, Runnable action) {
        JButton b = new JButton(text);
        URL url = icon == null ? null : EditorTab.class.getResource(icon);
        if (url != null) {
            ImageIcon ii = new ImageIcon(url);
            b.setIcon(new ImageIcon(ii.getImage().getScaledInstance(16, 16, java.awt.Image.SCALE_SMOOTH)));
        }
        b.setToolTipText(tip);
        b.setFocusable(false);
        b.addActionListener(e -> action.run());
        t.add(b);
        return b;
    }

    private void keys() {
        bind(KeyStroke.getKeyStroke(KeyEvent.VK_S, InputEvent.CTRL_DOWN_MASK), "pe.save", this::save);
        bind(KeyStroke.getKeyStroke(KeyEvent.VK_F5, 0), "pe.preview", this::preview);
        bind(KeyStroke.getKeyStroke(KeyEvent.VK_F, InputEvent.CTRL_DOWN_MASK), "pe.find", () -> findBar.open(false));
        bind(KeyStroke.getKeyStroke(KeyEvent.VK_H, InputEvent.CTRL_DOWN_MASK), "pe.replace", () -> findBar.open(true));
        bind(KeyStroke.getKeyStroke(KeyEvent.VK_F3, 0), "pe.next", () -> findBar.find(true));
        bind(KeyStroke.getKeyStroke(KeyEvent.VK_F3, InputEvent.SHIFT_DOWN_MASK), "pe.prev", () -> findBar.find(false));
        bind(KeyStroke.getKeyStroke(KeyEvent.VK_G, InputEvent.CTRL_DOWN_MASK), "pe.goto", () -> FindBar.goToLine(code));
    }

    private void bind(KeyStroke key, String id, Runnable action) {
        AbstractAction a = new AbstractAction() {
            @Override
            public void actionPerformed(ActionEvent e) {
                action.run();
            }
        };
        getInputMap(WHEN_ANCESTOR_OF_FOCUSED_COMPONENT).put(key, id);
        getActionMap().put(id, a);
        code.getInputMap().put(key, id);   // the code area's own map comes first
        code.getActionMap().put(id, a);
    }

    // ---------------------------------------------------------------- state
    private String kindName() {
        switch (typeId) {
            case 20: return "Script";
            case 30: return "Style";
            case 40: return "Template";
            case 50: return "Image";
            default: return "App";
        }
    }

    private void captureSaved() {
        savedText = fpo.getData() == null ? "" : fpo.getData();
        savedName = fpo.getName() == null ? "" : fpo.getName().trim();
        savedDescription = fpo.getDescription() == null ? "" : fpo.getDescription().trim();
        savedActive = fpo.isActive();
        savedPublished = fpo.isPublished();
        savedGadget = !reports.isEmpty() && reports.stream().allMatch(r -> r.widget);
        savedSystem = typeId == 10 && fpo.getId() > 0 && AppGroups.isSystem(savedText);
    }

    private void loadFields() {
        name.setText(savedName);
        description.setText(savedDescription);
        active.setSelected(savedActive);
        published.setSelected(savedPublished);
        gadget.setSelected(savedGadget);
        name.setCaretPosition(0);
        description.setCaretPosition(0);
        boolean isBuiltIn = fpo.getFbName() != null && !fpo.getFbName().trim().isEmpty();
        builtIn.setText(isBuiltIn ? "Built in (" + fpo.getFbName() + ")" : "");
        builtIn.setToolTipText(isBuiltIn ? "A Fishbowl-shipped record: saving keeps the original as '(FB) name' and saves yours as a new record" : null);
    }

    /** Re-reads the user's rights and applies them (read-only when they don't allow editing). */
    private void decide() {
        decision = AccessPolicy.decide(AccessPolicy.target(typeId), reports, ClientRights.current(host, service), savedSystem);
        boolean can = decision.canEdit;
        code.setEditable(can);
        for (JComponent c : editOnly) {
            c.setEnabled(can);
        }
        for (JComponent c : flagsOnly) {
            c.setEnabled(decision.canEditFlags);
        }
        if (menusButton != null && savedSystem) {
            menusButton.setEnabled(decision.canEditFlags);   // a system app's Apps menus are the company's choice, not its code
        }
        insertPanel.setEditable(can);
        gadgetEnabled();
        banner.setText(can ? "" : "Read only: " + decision.reason + (decision.canEditFlags && typeId == 10
            ? " Active, Published, Apps menus and Access can still be changed." : ""));
        banner.setVisible(!can);
        updateTitle();
    }

    /** Gadget: a published page, with the right to change its report. */
    private void gadgetEnabled() {
        boolean on = decision != null && decision.canEditGadget && published.isSelected();
        gadget.setEnabled(on);
        gadget.setToolTipText(decision != null && !decision.canEditGadget ? decision.gadgetReason
            : !published.isSelected() ? "Only a published app can be a dashboard gadget"
            : "Offer this app as a gadget on the Fishbowl home dashboard");
    }

    /** A new page asks for the gadget up front; its first save applies it. */
    void setGadget(boolean on) {
        gadget.setSelected(on);
        updateTitle();
    }

    private void edited() {
        updateTitle();
        reparse.restart();
    }

    private void updateTitle() {
        host.retitle(this, title(), tip());
    }

    /** Re-reads the page's includes and tokens; indexes the scripts it includes. */
    private void refreshPage() {
        String text = code.getText();
        List<PageIncludes.Include> incs = PageIncludes.find(text);
        Set<String> keys = new HashSet<>();
        for (PageIncludes.Include inc : incs) {
            keys.add(inc.key());
        }
        Map<String, Integer> tokens = PageIncludes.settingTokens(text, QueryParamTypeConst.getRegex());
        insertPanel.setPage(keys, tokens);
        directives.setKnown(feature.includableKeys());
        syncPlacement();

        // Index each included script (deduped, in page order); newest request wins.
        int gen = ++indexGeneration;
        Set<ScriptService.Includable> scripts = new LinkedHashSet<>();
        for (PageIncludes.Include inc : incs) {
            if ("Script".equals(inc.type)) {
                ScriptService.Includable s = feature.findIncludable("script", inc.name);
                if (s != null) {
                    scripts.add(s);
                }
            }
        }
        if (typeId == 20 && fpo.getId() > 0) {
            ScriptService.Includable self = feature.findIncludable("script", PageIncludes.includeName(savedName));
            if (self != null) {
                scripts.add(self);   // a script's own exports, so its tab completes them too
            }
        }
        List<JsIndex.Module> result = new ArrayList<>();
        if (scripts.isEmpty()) {
            pageModules = result;
            insertPanel.setPageModules(result);
            completions.update(result);
            return;
        }
        int[] remaining = {scripts.size()};
        for (ScriptService.Includable s : scripts) {
            feature.index(s, m -> {
                if (gen != indexGeneration) {
                    return;   // a newer parse superseded this one
                }
                result.add(m);
                if (--remaining[0] == 0) {
                    pageModules = result;
                    insertPanel.setPageModules(result);
                    completions.update(result);
                }
            });
        }
    }

    void includablesChanged() {
        insertPanel.setIncludables(feature.includables());
        refreshPage();
    }

    void moduleIndexed(JsIndex.Module m) {
        insertPanel.addModule(m);
    }

    // ---------------------------------------------------------------- inserts
    @Override
    public void insertInclude(ScriptService.Includable inc) {
        if (!editableNow()) {
            return;
        }
        String type = inc.typeName();
        if (PageIncludes.contains(code.getText(), type, PageIncludes.includeName(inc.name))) {
            info(inc.name + " is already included. Fishbowl replaces every copy of a directive, so it is written once.");
            return;
        }
        insertAtCaret(Inserts.include(type, inc.name, textBeforeCaret(), eol()), false);
    }

    @Override
    public void addSetting(QueryParamTypeConst preset) {
        if (!editableNow()) {
            return;
        }
        JComboBox<QueryParamTypeConst> type = new JComboBox<>(QueryParamTypeConst.values());
        type.setRenderer(new DefaultListCellRenderer() {
            @Override
            public Component getListCellRendererComponent(JList<?> list, Object value, int index, boolean selected,
                                                          boolean focus) {
                super.getListCellRendererComponent(list, value, index, selected, focus);
                if (value instanceof QueryParamTypeConst) {
                    QueryParamTypeConst q = (QueryParamTypeConst) value;
                    setText(q.getName() + "   ($" + q.getCode() + ")");
                    setToolTipText(q.getDescription());
                }
                return this;
            }
        });
        type.setSelectedItem(preset == null ? QueryParamTypeConst.values()[0] : preset);
        QueryParamTypeConst first = (QueryParamTypeConst) type.getSelectedItem();
        JTextField title = new JTextField(first.getName(), 26);
        JTextField def = new JTextField(26);
        JTextField tab = new JTextField(first.getTabName(), 26);
        JCheckBox required = new JCheckBox("Required");
        required.setEnabled(Inserts.canBeRequired(first));
        JCheckBox holder = new JCheckBox("Put it in a <script type=\"text/plain\"> holder (read it with getElementById)");
        JLabel about = new JLabel();
        about.setForeground(Color.GRAY);
        Consumer<QueryParamTypeConst> describe = q -> about.setText("<html><div style='width:300px'>"
            + Completions.esc(q.getDescription()) + "</div></html>");
        describe.accept(first);
        QueryParamTypeConst[] last = {first};
        type.addActionListener(e -> {
            QueryParamTypeConst q = (QueryParamTypeConst) type.getSelectedItem();
            if (q == null) {
                return;
            }
            // Follow the type while the title and tab are still the previous type's defaults.
            if (title.getText().trim().isEmpty() || title.getText().equals(last[0].getName())) {
                title.setText(q.getName());
            }
            if (tab.getText().trim().isEmpty() || tab.getText().equals(last[0].getTabName())) {
                tab.setText(q.getTabName());
            }
            required.setEnabled(Inserts.canBeRequired(q));
            describe.accept(q);
            last[0] = q;
        });
        JPanel p = new JPanel(new GridBagLayout());
        GridBagConstraints c = new GridBagConstraints();
        c.anchor = GridBagConstraints.WEST;
        c.insets = new Insets(3, 3, 3, 3);
        String[] labels = {"Type", "Title", "Default", "Tab"};
        JComponent[] fields = {type, title, def, tab};
        for (int i = 0; i < labels.length; i++) {
            c.gridy = i;
            c.gridx = 0;
            c.fill = GridBagConstraints.NONE;
            c.weightx = 0;
            p.add(new JLabel(labels[i]), c);
            c.gridx = 1;
            c.fill = GridBagConstraints.HORIZONTAL;
            c.weightx = 1;
            p.add(fields[i], c);
        }
        c.gridx = 1;
        c.fill = GridBagConstraints.NONE;
        c.gridy = 4;
        p.add(about, c);
        c.gridy = 5;
        p.add(required, c);
        c.gridy = 6;
        p.add(holder, c);
        if (JOptionPane.showConfirmDialog(this, p, "Add app setting", JOptionPane.OK_CANCEL_OPTION,
            JOptionPane.PLAIN_MESSAGE) != JOptionPane.OK_OPTION || title.getText().trim().isEmpty()) {
            return;
        }
        QueryParamTypeConst q = (QueryParamTypeConst) type.getSelectedItem();
        String token = Inserts.setting(q, title.getText().trim(), def.getText().trim(), tab.getText().trim(),
            required.isSelected() && required.isEnabled());
        if (code.getText().contains(token)) {
            info(token + " is already in the app. Fishbowl substitutes every copy, so write it once and reuse its value.");
            return;
        }
        insertAtCaret(holder.isSelected() ? Inserts.settingHolder(token, title.getText(), eol()) : token, false);
    }

    @Override
    public void insertBridge(Bridge.Fn fn) {
        if (editableNow()) {
            insertAtCaret(fn.call(), true);
        }
    }

    @Override
    public void insertSymbol(JsIndex.Module module, JsIndex.Symbol symbol) {
        if (!editableNow()) {
            return;
        }
        if (typeId == 10 && !pageModules.contains(module)) {
            ScriptService.Includable s = feature.findIncludable("script", PageIncludes.includeName(module.scriptName));
            if (s != null && !PageIncludes.contains(code.getText(), "Script", PageIncludes.includeName(s.name))) {
                int a = JOptionPane.showConfirmDialog(this, module.scriptName + " isn't included in this app. Add its include too?",
                    "App editor", JOptionPane.YES_NO_CANCEL_OPTION);
                if (a == JOptionPane.CANCEL_OPTION || a == JOptionPane.CLOSED_OPTION) {
                    return;
                }
                if (a == JOptionPane.YES_OPTION) {
                    addIncludeToHead(s);
                }
            }
        }
        insertAtCaret(Inserts.call(symbol), symbol.kind == JsIndex.Kind.FUNCTION);
    }

    @Override
    public void openScript(ScriptService.Includable include) {
        feature.openScript(include);
    }

    @Override
    public void wantAllModules() {
        feature.indexAll(this);
    }

    /** The include, in its own block, after the page's last include (else before </head>). */
    private void addIncludeToHead(ScriptService.Includable s) {
        String text = code.getText();
        int at = -1;
        for (PageIncludes.Include inc : PageIncludes.find(text)) {
            if ("Script".equals(inc.type) && !inc.holder) {
                int close = text.toLowerCase().indexOf("</script>", inc.end);
                at = close < 0 ? inc.end : close + "</script>".length();
            }
        }
        if (at < 0) {
            at = text.toLowerCase().indexOf("</head>");
        }
        if (at < 0) {
            at = 0;
        }
        String block = eol() + "<script>" + eol() + Inserts.directive("Script", s.name) + eol() + "</script>";
        code.insert(block, at);
        status("Added the " + s.name + " include.");
    }

    private void insertAtCaret(String text, boolean selectFirstParam) {
        int start = code.getSelectionStart();
        code.replaceSelection(text);
        if (selectFirstParam) {
            int open = text.indexOf('('), close = text.lastIndexOf(')');
            if (open >= 0 && close > open + 1) {
                String inner = text.substring(open + 1, close);
                int comma = inner.indexOf(',');
                int end = comma < 0 ? inner.length() : comma;
                code.select(start + open + 1, start + open + 1 + end);
            }
        }
        code.requestFocusInWindow();
    }

    private String textBeforeCaret() {
        return code.getText().substring(0, Math.min(code.getCaretPosition(), code.getText().length()));
    }

    private String eol() {
        return code.getText().contains("\r\n") ? "\r\n" : "\n";
    }

    private boolean editableNow() {
        if (!decision.canEdit) {
            JOptionPane.showMessageDialog(this, "Read only: " + decision.reason, "App editor", JOptionPane.INFORMATION_MESSAGE);
            return false;
        }
        return true;
    }

    // ---------------------------------------------------------------- save
    /** Saves after the checks; true when it saved (or there was nothing to save). */
    boolean save() {
        decide();
        boolean contentChanged = !code.getText().equals(savedText) || !name.getText().trim().equals(savedName)
            || !description.getText().trim().equals(savedDescription);
        if (!decision.canEdit && (contentChanged || fpo.getId() <= 0 || !decision.canEditFlags)) {
            error("Can't save. " + decision.reason);   // a system app saves only its Active and Published
            return false;
        }
        if (typeId == 10 && !savedSystem && AppGroups.isSystem(code.getText())) {
            // Only Fishbowl ships system apps (the repo's deploy writes them straight to Fishbowl).
            if (JOptionPane.showConfirmDialog(this, "<html><body style='width:380px'>Only apps that ship with Fishbowl "
                + "can be system apps. Save this one as a custom app?</body></html>", "Save", JOptionPane.YES_NO_OPTION,
                JOptionPane.QUESTION_MESSAGE) != JOptionPane.YES_OPTION) {
                return false;
            }
            applyText(AppGroups.setOrigin(code.getText(), AppGroups.CUSTOM));
        }
        String nm = name.getText().trim(), ds = description.getText().trim();
        String invalid = AccessPolicy.validateName(nm, ds);
        if (!invalid.isEmpty()) {
            error(invalid);
            return false;
        }
        if (code.getText().trim().isEmpty()) {
            error("There's no code to save.");
            return false;
        }
        if (fpo.getId() > 0 && !isDirty()) {
            status("Nothing to save.");
            return true;
        }
        if (fpo.getId() > 0 && onlyGadgetChanged()) {
            return busy(() -> {
                applyGadget();
                return true;
            });
        }
        return busy(() -> doSave(nm, ds));
    }

    private boolean doSave(String nm, String ds) {
        if (service.nameTaken(nm, typeId, fpo.getId())) {
            error("Another " + kindName().toLowerCase() + " is already named \"" + nm + "\".");
            return false;
        }
        boolean unpublishing = typeId == 10 && fpo.getId() > 0 && savedPublished && !published.isSelected() && !reports.isEmpty();
        if (unpublishing && !decision.canUnpublish) {
            error("Unpublishing deletes " + names(reports) + ", which needs the BI Report-Delete right.");
            return false;
        }
        List<String> warn = new ArrayList<>();
        boolean dataChanged = !code.getText().equals(savedText);
        if (fpo.getFbName() != null && !fpo.getFbName().trim().isEmpty() && dataChanged) {
            warn.add("This is a built-in Fishbowl " + kindName().toLowerCase() + ". Fishbowl keeps the original, inactive, as \"(FB) "
                + savedName + "\" and saves yours as a new record, which later Fishbowl updates won't change.");
        }
        if ((typeId == 20 || typeId == 30) && fpo.getId() > 0 && dataChanged) {
            int n = service.pagesUsing(kindName(), savedName);
            if (n > 0) {
                warn.add(n + " active app" + (n == 1 ? " includes" : "s include") + " " + savedName + "; they all get this change.");
            }
        }
        if (typeId == 10 && reports.size() > 1) {
            warn.add("This page is used by " + reports.size() + " apps: " + names(reports) + ".");
        }
        if (unpublishing) {
            warn.add("Unpublishing deletes " + names(reports) + ", with their settings and access.");
        }
        if (fpo.getId() > 0 && !nm.equals(savedName)) {
            warn.add("Renaming: links, imports and the published copies find an app by its name.");
        }
        if (!warn.isEmpty()) {
            String text = "<html><body style='width:420px'>" + String.join("<br><br>", warn) + "<br><br>Save anyway?</body></html>";
            if (JOptionPane.showConfirmDialog(this, text, "Save " + nm, JOptionPane.YES_NO_OPTION, JOptionPane.WARNING_MESSAGE)
                != JOptionPane.YES_OPTION) {
                return false;
            }
        }
        try {
            BiScriptFpo target = fpo;
            boolean wantGadget = gadget.isSelected();
            if (fpo.getId() > 0) {
                BiScriptFpo fresh = service.getScript(fpo.getId());
                if (time(fresh.getDateLastModified()) != time(fpo.getDateLastModified())) {
                    // Locked code (a system app saving its flags) has nothing of ours to lose: take theirs.
                    target = decision.canEdit ? resolveConflict(fresh) : fresh;
                    if (target == null) {
                        return false;
                    }
                }
            }
            boolean lockedCode = !decision.canEdit;
            if (!lockedCode) {
                target.setName(nm);
                target.setDescription(ds);
                target.setData(code.getText());
            }
            target.setActive(active.isSelected());
            if (typeId == 10) {
                target.setPublished(published.isSelected());
            }
            int oldId = fpo.getId();
            List<AccessPolicy.Report> before = reports;
            List<BiReportAccessFpo> access = oldId <= 0 ? firstAccess : null;
            if (typeId == 10 && oldId > 0 && !savedPublished && published.isSelected()) {
                access = publishAccess();   // as the BI Editor asks when Published is ticked
                if (access == null) {
                    return false;
                }
            }
            BiScriptFpo saved = service.save(target, access);
            fpo = saved;
            captureSaved();
            if (lockedCode && !code.getText().equals(savedText)) {
                code.setText(savedText);   // the newer saved code, taken above
                code.setCaretPosition(0);
            }
            loadFields();
            firstAccess = null;
            reports = service.reportsFor(saved.getId());
            if (typeId == 10 && saved.isPublished() && !reports.isEmpty()) {
                gadget.setSelected(wantGadget);   // loadFields reset it to the old state
                applyGadget();
            }
            feature.saved(this, oldId, saved);
            host.invalidateCatalog();
            decide();
            String done = "Saved " + new SimpleDateFormat("HH:mm:ss").format(new Date()) + (oldId > 0 && saved.getId() != oldId
                ? " as a new record (#" + saved.getId() + ")" : "") + deployNote(nm);
            if (typeId == 10 && preview.isVisible()) {
                preview();   // the open preview shows what was saved
                done += " · preview reloaded";
            }
            status(done);
            afterSave(oldId, before);
            return true;
        } catch (ScriptService.ServiceException e) {
            error(e.getMessage());
            return false;
        }
    }

    private boolean onlyGadgetChanged() {
        return typeId == 10 && code.getText().equals(savedText) && name.getText().trim().equals(savedName)
            && description.getText().trim().equals(savedDescription) && active.isSelected() == savedActive
            && published.isSelected() == savedPublished && published.isSelected() && gadget.isSelected() != savedGadget;
    }

    /**
     * Sets bireport.widget on every report of the page that differs from the box:
     * a fresh BI_REPORT_LOAD, then BI_REPORT_SAVE with its access unchanged.
     */
    private void applyGadget() {
        boolean want = gadget.isSelected();
        if (!decision.canEditGadget) {
            if (want != savedGadget) {
                error("The dashboard gadget wasn't changed. " + decision.gadgetReason);
            }
            return;
        }
        try {
            boolean changed = false;
            for (AccessPolicy.Report r : reports) {
                if (r.widget != want) {
                    ScriptService.ReportBundle b = service.loadReport(r.id);
                    b.report.setWidget(want);
                    service.saveReport(b.report, b.access);
                    changed = true;
                }
            }
            if (changed) {
                reports = service.reportsFor(fpo.getId());
                host.invalidateCatalog();
                status((want ? "Now a" : "No longer a") + " dashboard gadget.");
            }
        } catch (ScriptService.ServiceException e) {
            error("The dashboard gadget couldn't be changed: " + e.getMessage());
        }
        savedGadget = !reports.isEmpty() && reports.stream().allMatch(r -> r.widget);
        gadget.setSelected(savedGadget);
        updateTitle();
    }

    private void afterSave(int oldId, List<AccessPolicy.Report> before) {
        if (typeId == 10) {
            if (!before.isEmpty() && reports.isEmpty() && fpo.isPublished()) {
                info("The app" + (before.size() > 1 ? "s" : "") + " " + names(before) + " still use the earlier page: "
                    + "Fishbowl saved this built-in page as a new record. Point the app at it in the BI Report module.");
            }
            if (reloadOnSave.isSelected() && !reports.isEmpty()) {
                List<Integer> ids = new ArrayList<>();
                for (AccessPolicy.Report r : reports) {
                    ids.add(r.id);
                }
                host.reloadReports(ids);
            }
            if (oldId <= 0 && !reports.isEmpty()) {
                if (JOptionPane.showConfirmDialog(this, "Published as \"" + reports.get(0).name + "\". Open it?", "App editor",
                    JOptionPane.YES_NO_OPTION) == JOptionPane.YES_OPTION) {
                    host.openReport(reports.get(0).id, true);
                }
            }
        } else if (typeId == 20 || typeId == 30) {
            if (JOptionPane.showConfirmDialog(this, "Reload the open tabs, so they use the saved " + savedName + "?",
                "App editor", JOptionPane.YES_NO_OPTION) == JOptionPane.YES_OPTION) {
                host.reloadReports(null);
            }
        }
    }

    /** The saved copy changed since this tab loaded it: compare, overwrite, or take theirs. Null cancels. */
    private BiScriptFpo resolveConflict(BiScriptFpo fresh) {
        String[] options = {"Compare", "Overwrite with mine", "Load theirs", "Cancel"};
        while (true) {
            int c = JOptionPane.showOptionDialog(this, "<html><body style='width:380px'>\"" + savedName + "\" was saved by someone "
                    + "else (or in the BI Editor) after you opened it.</body></html>", "Save conflict",
                JOptionPane.DEFAULT_OPTION, JOptionPane.WARNING_MESSAGE, null, options, options[0]);
            if (c == 0) {
                Diff.show(this, typeId, "Saved (theirs)", fresh.getData(), "This editor (mine)", code.getText());
            } else if (c == 1) {
                return fresh;   // keeps the newer version stamp, so the server accepts it
            } else if (c == 2) {
                fpo = fresh;
                captureSaved();
                code.setText(savedText);
                loadFields();
                updateTitle();
                return null;
            } else {
                return null;
            }
        }
    }

    private static long time(Date d) {
        return d == null ? 0 : d.getTime();
    }

    private static String names(List<AccessPolicy.Report> list) {
        List<String> n = new ArrayList<>();
        for (AccessPolicy.Report r : list) {
            n.add("\"" + r.name + "\"");
        }
        return String.join(", ", n);
    }

    private static String deployNote(String nm) {
        return "";
    }

    // ---------------------------------------------------------------- preview, history, access
    private void preview() {
        if (typeId != 10) {
            info("Scripts, styles and templates are previewed through an app that includes them.");
            return;
        }
        busy(() -> {
            try {
                BiScriptFpo tmp = new BiScriptFpo();
                tmp.setType(BiScriptTypeConst.PAGE);
                tmp.setName(name.getText().trim());
                tmp.setActive(true);
                tmp.setData(code.getText());
                String html = service.expand(tmp);
                int rid = sandbox.isSelected() ? -1 : fromReport > 0 ? fromReport : reports.isEmpty() ? -1 : reports.get(0).id;
                Set<QueryParameter> params = new HashSet<>();
                if (rid > 0) {
                    params = host.savedParams(service.loadReport(rid).report);
                }
                preview.show(html, rid, name.getText().trim(), params, rid > 0
                    ? "Preview with the app's id and settings: saveReportData writes real data."
                    : "Sandbox preview: no app id, so saved app data isn't available.");
                if (!preview.isVisible()) {
                    preview.setVisible(true);
                    halfSplit();
                }
                status("Previewed " + new SimpleDateFormat("HH:mm:ss").format(new Date()) + " (unsaved text).");
            } catch (ScriptService.ServiceException e) {
                error(e.getMessage());
            }
            return true;
        });
    }

    @Override
    public void closePreview() {
        preview.stop();
        preview.setVisible(false);
        codeSplit.revalidate();
        code.requestFocusInWindow();
    }

    @Override
    public void dockPreview(boolean right) {
        layout.previewRight = right;
        layout.saveSoon();
        preview.setDock(right);
        int want = right ? JSplitPane.HORIZONTAL_SPLIT : JSplitPane.VERTICAL_SPLIT;
        if (codeSplit.getOrientation() != want) {
            codeSplit.setOrientation(want);
            halfSplit();
        }
    }

    /** Code and preview share the space as the user last left it; deferred so the split has its new size. */
    private void halfSplit() {
        codeSplit.revalidate();
        SwingUtilities.invokeLater(() -> codeSplit.setDividerLocation(layout.codeRatio));
    }

    private void history() {
        if (fpo.getId() <= 0) {
            info("There's no history until the first save.");
            return;
        }
        HistoryDialog.show(this, service, fpo, typeId, code.getText(), text -> {
            if (!decision.canEdit) {
                error("Read only: " + decision.reason);
                return;
            }
            code.selectAll();
            code.replaceSelection(text);   // undoable; saving is up to the user
            code.setCaretPosition(0);
            status("Restored an earlier version into the editor. Save to keep it.");
        });
    }

    private void access() {
        if (reports.isEmpty()) {
            info("This app isn't published yet: publish and save it first.");
            return;
        }
        AccessPolicy.Report target = reports.get(0);
        if (reports.size() > 1) {
            JComboBox<String> pick = new JComboBox<>();
            for (AccessPolicy.Report r : reports) {
                pick.addItem(r.name);
            }
            if (JOptionPane.showConfirmDialog(this, pick, "Which report?", JOptionPane.OK_CANCEL_OPTION) != JOptionPane.OK_OPTION) {
                return;
            }
            target = reports.get(pick.getSelectedIndex());
        }
        AccessPolicy.Report chosen = target;
        busy(() -> {
            try {
                ScriptService.ReportBundle b = service.loadReport(chosen.id);
                BiAccessRightsPanel panel = new BiAccessRightsPanel();
                panel.init(b.access);
                panel.setEnabled(decision.canEditAccess);
                panel.setPreferredSize(new java.awt.Dimension(520, 320));
                JPanel wrap = new JPanel(new BorderLayout(0, 6));
                wrap.add(panel, BorderLayout.CENTER);
                if (!decision.canEditAccess) {
                    wrap.add(new JLabel("Read only: " + decision.accessReason), BorderLayout.SOUTH);
                }
                int ok = JOptionPane.showConfirmDialog(this, wrap, "Access to " + chosen.name, decision.canEditAccess
                    ? JOptionPane.OK_CANCEL_OPTION : JOptionPane.DEFAULT_OPTION, JOptionPane.PLAIN_MESSAGE);
                if (ok != JOptionPane.OK_OPTION || !decision.canEditAccess) {
                    return true;
                }
                @SuppressWarnings("unchecked")
                List<BiReportAccessFpo> list = panel.getAccessList();
                if (!keepsMyEditLevel(list) && JOptionPane.showConfirmDialog(this, "None of your groups would keep "
                    + AccessPolicy.EDIT_LEVEL.getName() + " "
                    + "on this app, so you couldn't edit it afterwards. Save anyway?", "App access", JOptionPane.YES_NO_OPTION,
                    JOptionPane.WARNING_MESSAGE) != JOptionPane.YES_OPTION) {
                    return true;
                }
                service.saveReport(b.report, list);
                host.invalidateCatalog();
                status("Saved access to " + chosen.name + ".");
            } catch (ScriptService.ServiceException e) {
                error(e.getMessage());
            }
            return true;
        });
    }

    private boolean keepsMyEditLevel(List<BiReportAccessFpo> list) {
        if (ClientRights.isAdmin(host)) {
            return true;
        }
        int uid = host.userId();
        Set<Integer> mine = service.myGroupIds(uid);
        for (BiReportAccessFpo a : list) {
            if (mine.contains(a.getUserGroupId()) && a.getAccessLevel() == AccessPolicy.EDIT_LEVEL) {
                return true;
            }
        }
        return false;
    }

    private void openReport() {
        if (reports.isEmpty()) {
            info("This app isn't published yet: publish and save it first.");
            return;
        }
        host.openReport(fromReport > 0 && showsReport(fromReport) ? fromReport : reports.get(0).id, true);
    }

    /** Who can open the app once it is published: the native panel with the default groups. Null cancels. */
    @SuppressWarnings("unchecked")
    private List<BiReportAccessFpo> publishAccess() {
        BiAccessRightsPanel panel = new BiAccessRightsPanel();
        try {
            panel.init();
        } catch (RuntimeException ignored) {
            // an empty list: admin only
        }
        panel.setPreferredSize(new java.awt.Dimension(520, 320));
        if (JOptionPane.showConfirmDialog(this, panel, "Publish " + name.getText().trim() + ": who can open it?",
            JOptionPane.OK_CANCEL_OPTION, JOptionPane.PLAIN_MESSAGE) != JOptionPane.OK_OPTION) {
            return null;
        }
        List<BiReportAccessFpo> list = panel.getAccessList();
        return list == null ? new ArrayList<>() : list;
    }

    /** The BI Editor's Download: save first if asked, then this record and what it includes, to a folder. */
    private void download() {
        if (fpo.getId() <= 0) {
            info("Save it first: Fishbowl has nothing to download yet.");
            return;
        }
        if (isDirty()) {
            int a = JOptionPane.showConfirmDialog(this, "Save your changes before downloading? (No downloads the saved version.)",
                "Download", JOptionPane.YES_NO_CANCEL_OPTION, JOptionPane.QUESTION_MESSAGE);
            if (a == JOptionPane.CANCEL_OPTION || a == JOptionPane.CLOSED_OPTION || (a == JOptionPane.YES_OPTION && !save())) {
                return;
            }
        }
        busy(() -> {
            try {
                Exporter.write(this, service.exportData(fpo.getId()));
            } catch (ScriptService.ServiceException e) {
                error(e.getMessage());
            }
            return true;
        });
    }

    /** A copy of the saved version under a new name (custom, unpublished), opened in its own tab. */
    private void duplicate() {
        if (fpo.getId() <= 0) {
            info("Save it first: there's nothing saved to copy yet.");
            return;
        }
        if (isDirty() && decision.canEdit && JOptionPane.showConfirmDialog(this, "The copy is made from the saved version, "
            + "without your unsaved changes. Continue?", "Duplicate", JOptionPane.OK_CANCEL_OPTION) != JOptionPane.OK_OPTION) {
            return;
        }
        feature.duplicate(this, fpo.getId());
    }

    /** Puts the shared explorer in this tab's left slot. */
    void attachExplorer(AppExplorer explorer) {
        if (explorer.getParent() != explorerSlot) {
            explorerSlot.removeAll();
            explorerSlot.add(explorer, BorderLayout.CENTER);
            explorerSlot.revalidate();
            explorerSlot.repaint();
        }
    }

    /** After an explorer action changed this record: the saved version, without asking (the tab is clean). */
    void reloadQuietly() {
        if (fpo.getId() <= 0 || isDirty()) {
            return;
        }
        try {
            fpo = service.getScript(fpo.getId());
            reports = service.reportsFor(fpo.getId());
            captureSaved();
            if (!code.getText().equals(savedText)) {
                code.setText(savedText);
                code.setCaretPosition(0);
            }
            loadFields();
            decide();
        } catch (ScriptService.ServiceException e) {
            status(e.getMessage());
        }
    }

    /** After Import wrote this record: the imported version (asking first when there are unsaved changes). */
    void reloadImported() {
        if (isDirty()) {
            reloadFromServer();
        } else {
            reloadQuietly();
            status("Reloaded the imported version.");
        }
    }

    /**
     * Files dropped on the code: the first one's text replaces the code (Ctrl+Z undoes it). A
     * Fishbowl export (.json) also fills in the name and description. Nothing is saved.
     */
    private void dropFiles(java.util.List<java.io.File> files) {
        if (files == null || files.isEmpty()) {
            return;
        }
        if (files.size() > 1 && files.stream().allMatch(f -> f.getName().toLowerCase(java.util.Locale.ROOT).endsWith(".json"))) {
            feature.importDropped(files);   // several exports: the Import dialog, with Publish and access
            return;
        }
        java.io.File f = files.get(0);
        applyDropped(DroppedFile.read(f, typeId), f.getName(), files.size());
    }

    /**
     * A dropped file's content into this tab (from its own code area, or a file dropped on
     * the App Library that matches this record): the code, and an export's name and
     * description. Ctrl+Z undoes the code; nothing is saved.
     */
    void applyDropped(DroppedFile d, String fileName, int fileCount) {
        if (!decision.canEdit) {
            info("This can't be changed here: " + decision.reason);
            return;
        }
        if (d.error != null) {
            error(d.error);
            return;
        }
        if (d.confirm != null && JOptionPane.showConfirmDialog(this, d.confirm, "Load " + fileName,
            JOptionPane.YES_NO_OPTION) != JOptionPane.YES_OPTION) {
            return;
        }
        // The record's own line endings, so only the content shows as changed.
        String text = d.text.replace("\r\n", "\n").replace('\r', '\n');
        if (savedText != null && savedText.contains("\r\n")) {
            text = text.replace("\n", "\r\n");
        }
        code.setText(text);
        code.setCaretPosition(0);
        boolean fields = false;
        if (d.name != null && !d.name.isEmpty()) {
            name.setText(d.name);
            name.setCaretPosition(0);
            fields = true;
        }
        if (d.description != null) {
            description.setText(d.description);
            description.setCaretPosition(0);
            fields = true;
        }
        updateTitle();
        status("Loaded " + fileName + (fields ? " (code, name and description)" : "") + ". Not saved yet; Ctrl+Z undoes the code."
            + (fileCount > 1 ? " Only the first of the " + fileCount + " files was used." : ""));
    }

    private void reloadFromServer() {
        if (fpo.getId() <= 0) {
            return;
        }
        if (isDirty() && JOptionPane.showConfirmDialog(this, "Discard your unsaved changes?", "Reload",
            JOptionPane.YES_NO_OPTION) != JOptionPane.YES_OPTION) {
            return;
        }
        busy(() -> {
            try {
                fpo = service.getScript(fpo.getId());
                captureSaved();
                code.setText(savedText);
                code.setCaretPosition(0);
                loadFields();
                reports = service.reportsFor(fpo.getId());
                decide();
                status("Reloaded the saved version.");
            } catch (ScriptService.ServiceException e) {
                error(e.getMessage());
            }
            return true;
        });
    }

    // ---------------------------------------------------------------- WorkspaceTab
    @Override
    public boolean confirmClose() {
        if (!isDirty() || !decision.canEdit) {
            return true;
        }
        host.select(this);
        int a = JOptionPane.showConfirmDialog(this, "Save the changes to " + (name.getText().trim().isEmpty() ? "the new app"
            : "\"" + name.getText().trim() + "\"") + "?", "App editor", JOptionPane.YES_NO_CANCEL_OPTION, JOptionPane.QUESTION_MESSAGE);
        if (a == JOptionPane.YES_OPTION) {
            return save();
        }
        return a == JOptionPane.NO_OPTION;
    }

    @Override
    public void dispose() {
        reparse.stop();
        completions.dispose();
        preview.dispose();
        feature.closed(this);
    }

    // ---------------------------------------------------------------- helpers
    private boolean busy(Supplier<Boolean> work) {
        Cursor before = getCursor();
        setCursor(Cursor.getPredefinedCursor(Cursor.WAIT_CURSOR));
        try {
            return work.get();
        } finally {
            setCursor(before);
        }
    }

    private void status(String text) {
        status.setText(text);
    }

    private void info(String text) {
        JOptionPane.showMessageDialog(this, "<html><body style='width:380px'>" + Completions.esc(text) + "</body></html>",
            "App editor", JOptionPane.INFORMATION_MESSAGE);
    }

    private void error(String text) {
        JOptionPane.showMessageDialog(this, "<html><body style='width:380px'>" + Completions.esc(text) + "</body></html>",
            "App editor", JOptionPane.ERROR_MESSAGE);
    }

    static JPanel row(JComponent... cs) {
        JPanel p = new JPanel(new FlowLayout(FlowLayout.LEFT, 4, 0));
        for (JComponent c : cs) {
            p.add(c);
        }
        return p;
    }
}
