package com.fbi.plugins.reportbtn.docs;

import com.fbi.plugins.reportbtn.WorkspaceHost;

import javax.swing.BorderFactory;
import javax.swing.DefaultComboBoxModel;
import javax.swing.DefaultListCellRenderer;
import javax.swing.JButton;
import javax.swing.JCheckBox;
import javax.swing.JComboBox;
import javax.swing.JDialog;
import javax.swing.JLabel;
import javax.swing.JList;
import javax.swing.JPanel;
import javax.swing.JScrollPane;
import javax.swing.JSeparator;
import javax.swing.UIManager;
import java.awt.BorderLayout;
import java.awt.Component;
import java.awt.Dialog;
import java.awt.Dimension;
import java.awt.FlowLayout;
import java.awt.Font;
import java.awt.GridBagConstraints;
import java.awt.GridBagLayout;
import java.awt.Insets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Apps (beta) › Documents: which app each module prints and emails as its document
 * (company-wide; admin or Reports-Company Edit), and, for the user, whether emails
 * open in their own email program. Each document row shows the Jasper report
 * Module Options sets for it, which still applies when no app is chosen.
 */
final class DefaultsDialog extends JDialog {

    private static final Pattern LAUNCH = Pattern.compile("name=\"fb-launch\"[^>]*content=\"([^\"]*)\"|content=\"([^\"]*)\"[^>]*name=\"fb-launch\"");
    private static final String NONE = "";

    /** An app in the pickers: tagged for the slot's module or not. */
    private static final class Choice {
        final String name;
        final boolean suggested;

        Choice(String name, boolean suggested) {
            this.name = name;
            this.suggested = suggested;
        }

        @Override
        public String toString() {
            return name;
        }
    }

    private final WorkspaceHost host;
    private final boolean mayEdit;
    private final Map<DocSlots.Slot, JComboBox<Object>> pickers = new LinkedHashMap<>();
    private final Map<String, String> stored;
    private final JCheckBox own = new JCheckBox("Open emails in my own email program (classic Outlook, or the program for .eml files) "
        + "instead of the email window");

    private DefaultsDialog(Component parent, WorkspaceHost host) {
        super(Docs.window(parent), "Documents (proof of concept)", Dialog.ModalityType.APPLICATION_MODAL);
        this.host = host;
        this.mayEdit = Docs.mayEditDefaults(host);
        this.stored = DocDefaults.apps();

        JPanel top = new JPanel(new BorderLayout(0, 6));
        top.setBorder(BorderFactory.createEmptyBorder(12, 14, 6, 14));
        JLabel intro = new JLabel("<html>An app can stand in for a module's document: <b>Print (App)</b> and <b>Email (rich)</b> in that "
            + "module then use it. Without one, Email (rich) attaches the Jasper report that Reporting › Module Options sets."
            + (mayEdit ? "" : "<br><i>Only an admin, or a user who may edit company reports, can change these.</i>") + "</html>");
        top.add(intro, BorderLayout.NORTH);
        own.setSelected(DocDefaults.usesMailProgram(host.userId()));
        top.add(own, BorderLayout.SOUTH);

        Map<String, String> jasper = jasperDefaults();
        List<String[]> apps = apps();
        JPanel grid = new JPanel(new GridBagLayout());
        grid.setBorder(BorderFactory.createEmptyBorder(4, 14, 4, 14));
        int y = 0;
        header(grid, y++, "Module", "Document", "Fishbowl default (Jasper)", "App", "");
        String lastModule = null;
        for (DocSlots.Slot s : DocSlots.all()) {
            if (lastModule != null && !lastModule.equals(s.module.name)) {
                GridBagConstraints c = cell(0, y++, 5);
                c.fill = GridBagConstraints.HORIZONTAL;
                c.insets = new Insets(3, 0, 3, 0);
                grid.add(new JSeparator(), c);
            }
            grid.add(new JLabel(s.module.name.equals(lastModule) ? "" : s.module.name), cell(0, y, 1));
            lastModule = s.module.name;
            grid.add(new JLabel(s.title), cell(1, y, 1));
            JLabel j = new JLabel(Docs.blank(jasper.get(s.name)) ? "(none)" : jasper.get(s.name));
            j.setForeground(UIManager.getColor("Label.disabledForeground"));
            grid.add(j, cell(2, y, 1));
            JComboBox<Object> box = picker(s, apps);
            box.setEnabled(mayEdit);
            pickers.put(s, box);
            GridBagConstraints bc = cell(3, y, 1);
            bc.fill = GridBagConstraints.HORIZONTAL;
            bc.weightx = 1;
            grid.add(box, bc);
            JButton test = new JButton("Test");
            test.setToolTipText("Open the chosen app on the newest " + s.module.noun);
            test.addActionListener(e -> test(s, box));
            grid.add(test, cell(4, y, 1));
            y++;
        }
        GridBagConstraints filler = cell(0, y, 5);
        filler.weighty = 1;
        grid.add(new JPanel(), filler);

        JPanel buttons = new JPanel(new FlowLayout(FlowLayout.RIGHT, 6, 8));
        JButton cancel = new JButton("Cancel");
        cancel.addActionListener(e -> dispose());
        JButton save = new JButton("Save");
        save.addActionListener(e -> save());
        buttons.add(cancel);
        buttons.add(save);

        getContentPane().setLayout(new BorderLayout());
        getContentPane().add(top, BorderLayout.NORTH);
        getContentPane().add(new JScrollPane(grid), BorderLayout.CENTER);
        getContentPane().add(buttons, BorderLayout.SOUTH);
        setSize(new Dimension(980, 640));
        setLocationRelativeTo(getOwner());
    }

    static void open(Component parent) {
        WorkspaceHost h = Docs.hostOrExplain(parent);
        if (h != null) {
            new DefaultsDialog(parent, h).setVisible(true);
        }
    }

    private JComboBox<Object> picker(DocSlots.Slot s, List<String[]> apps) {
        DefaultComboBoxModel<Object> model = new DefaultComboBoxModel<>();
        model.addElement(NONE);
        List<Choice> suggested = new ArrayList<>(), others = new ArrayList<>();
        for (String[] a : apps) {
            boolean match = a[1].contains("," + s.module.code + ",");
            (match ? suggested : others).add(new Choice(a[0], match));
        }
        String current = stored.get(s.name);
        boolean found = current == null;
        for (Choice c : suggested) {
            model.addElement(c);
            found |= c.name.equalsIgnoreCase(Objects.toString(current, ""));
        }
        for (Choice c : others) {
            model.addElement(c);
            found |= c.name.equalsIgnoreCase(Objects.toString(current, ""));
        }
        if (!found) {
            model.addElement(new Choice(current, false));   // set, but not an app this user can see
        }
        JComboBox<Object> box = new JComboBox<>(model);
        box.setRenderer(new DefaultListCellRenderer() {
            @Override
            public Component getListCellRendererComponent(JList<?> list, Object value, int index, boolean sel, boolean focus) {
                Component c = super.getListCellRendererComponent(list, value, index, sel, focus);
                if (NONE.equals(value)) {
                    setText("Jasper default (no app)");
                    setFont(getFont().deriveFont(Font.ITALIC));
                } else if (value instanceof Choice && ((Choice) value).suggested) {
                    setFont(getFont().deriveFont(Font.BOLD));
                }
                return c;
            }
        });
        box.setToolTipText("Bold: apps listed in this module's Apps menu");
        for (int i = 0; i < model.getSize(); i++) {
            Object o = model.getElementAt(i);
            if (current != null && o instanceof Choice && ((Choice) o).name.equalsIgnoreCase(current)) {
                box.setSelectedIndex(i);
            }
        }
        return box;
    }

    private static String chosen(JComboBox<Object> box) {
        Object o = box.getSelectedItem();
        return o instanceof Choice ? ((Choice) o).name : null;
    }

    private void test(DocSlots.Slot s, JComboBox<Object> box) {
        String app = chosen(box);
        if (app == null) {
            Docs.info(this, "Choose an app to test. (The Jasper default prints from the module as usual.)");
            return;
        }
        String id = Docs.one("SELECT MAX(id) AS id FROM " + s.module.table, "id");
        int recordId;
        try {
            recordId = Integer.parseInt(String.valueOf(id).trim());
        } catch (NumberFormatException e) {
            Docs.info(this, "There is no " + s.module.noun + " to test with.");
            return;
        }
        String num = Docs.one("SELECT num AS num FROM " + s.module.table + " WHERE id = " + recordId, "num");
        DocumentWindow.open(this, null, s, app, recordId, num);
    }

    private void save() {
        try {
            boolean wasOwn = DocDefaults.usesMailProgram(host.userId());
            if (own.isSelected() != wasOwn) {
                DocDefaults.setUsesMailProgram(host.userId(), own.isSelected());
            }
            if (mayEdit) {
                Map<DocSlots.Slot, String> changes = new HashMap<>();
                for (Map.Entry<DocSlots.Slot, JComboBox<Object>> e : pickers.entrySet()) {
                    String now = chosen(e.getValue());
                    String before = stored.get(e.getKey().name);
                    if (!Objects.equals(now, before)) {
                        changes.put(e.getKey(), now);
                    }
                }
                if (!changes.isEmpty()) {
                    DocDefaults.setApps(changes);
                    DocButtons.apps(true);
                }
            }
            dispose();
        } catch (Exception e) {
            Docs.log("saving the document settings failed", e);
            Docs.error(this, e.getMessage());
        }
    }

    /** slot name -> its Jasper report's name, from the module table. */
    private static Map<String, String> jasperDefaults() {
        Map<String, String> out = new HashMap<>();
        for (Map<String, String> r : Docs.rows("SELECT m.name AS slot, r.name AS report FROM module m "
                + "LEFT JOIN report r ON r.id = m.reportId", "slot", "report")) {
            if (r.get("slot") != null) {
                out.put(r.get("slot").trim(), r.get("report"));
            }
        }
        return out;
    }

    /** [name, ",TAGS,"] for every active, published app, by name. */
    private static List<String[]> apps() {
        List<String[]> out = new ArrayList<>();
        for (Map<String, String> r : Docs.rows("SELECT b.name AS name, "
                + "SUBSTRING(s.data, GREATEST(1, LOCATE('name=\"fb-launch\"', s.data) - 120), 360) AS tag "
                + "FROM bireport b JOIN biscript s ON s.id = b.biScriptId "
                + "WHERE s.active+0 = 1 AND s.published+0 = 1 ORDER BY b.name", "name", "tag")) {
            String name = r.get("name");
            if (Docs.blank(name)) {
                continue;
            }
            Set<String> tags = new LinkedHashSet<>();
            String tag = r.get("tag");
            Matcher m = tag == null ? null : LAUNCH.matcher(tag);
            if (m != null && m.find()) {
                String content = m.group(1) != null ? m.group(1) : m.group(2);
                for (String k : content.split("[,\\s]+")) {
                    if (!k.trim().isEmpty()) {
                        tags.add(k.trim().toUpperCase());
                    }
                }
            }
            out.add(new String[] {name.trim(), "," + String.join(",", tags) + ","});
        }
        return out;
    }

    private static void header(JPanel grid, int y, String... labels) {
        for (int i = 0; i < labels.length; i++) {
            JLabel l = new JLabel(labels[i]);
            l.setFont(l.getFont().deriveFont(Font.BOLD));
            grid.add(l, cell(i, y, 1));
        }
    }

    private static GridBagConstraints cell(int x, int y, int span) {
        GridBagConstraints c = new GridBagConstraints();
        c.gridx = x;
        c.gridy = y;
        c.gridwidth = span;
        c.anchor = GridBagConstraints.WEST;
        c.insets = new Insets(2, 0, 2, 10);
        return c;
    }

}
