package com.fbi.plugins.reportbtn.editor;

import javax.swing.BorderFactory;
import javax.swing.BoxLayout;
import javax.swing.JCheckBox;
import javax.swing.JLabel;
import javax.swing.JOptionPane;
import javax.swing.JPanel;
import javax.swing.JScrollPane;
import javax.swing.JTextField;
import java.awt.BorderLayout;
import java.awt.Component;
import java.awt.Dimension;
import java.awt.GridLayout;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * The module association as checkboxes: per client menu group, "every module in the
 * group" (the group key) and each module (its key). The result is the fb-launch
 * tag's content, so nobody types keys. Keys report_btn doesn't know are kept in a
 * text field rather than dropped.
 */
final class ModulePicker {

    private ModulePicker() {
    }

    /** The new content, or null when cancelled. */
    static String ask(Component parent, String title, String content) {
        List<String> current = new ArrayList<>();
        for (String k : AppGroups.keys(content)) {
            current.add(k.toUpperCase(Locale.ROOT));
        }
        Map<String, JCheckBox> boxes = new LinkedHashMap<>();
        JPanel grid = new JPanel(new GridLayout(0, 3, 8, 8));
        for (String g : AppGroups.GROUPS.keySet()) {
            if (AppGroups.NONE.equals(g)) {
                continue;
            }
            JPanel box = new JPanel();
            box.setLayout(new BoxLayout(box, BoxLayout.Y_AXIS));
            box.setBorder(BorderFactory.createTitledBorder(AppGroups.groupLabel(g)));
            String gk = g.toUpperCase(Locale.ROOT);
            JCheckBox all = new JCheckBox(AppGroups.keyLabel(gk));
            all.setToolTipText("Listed in the Apps menu of every module in the " + AppGroups.groupLabel(g) + " menu");
            all.setSelected(current.contains(gk));
            boxes.put(gk, all);
            box.add(all);
            for (Map.Entry<String, String> m : AppGroups.MODULE_GROUP.entrySet()) {
                if (m.getValue().equals(g)) {
                    JCheckBox cb = new JCheckBox(AppGroups.moduleLabel(m.getKey()));
                    cb.setToolTipText("Listed in the " + AppGroups.moduleLabel(m.getKey()) + " module's Apps menu");
                    cb.setSelected(current.contains(m.getKey()));
                    boxes.put(m.getKey(), cb);
                    box.add(cb);
                }
            }
            grid.add(box);
        }
        List<String> unknown = new ArrayList<>();
        for (String k : AppGroups.keys(content)) {
            if (!AppGroups.knownKey(k)) {
                unknown.add(k);
            }
        }
        JTextField other = new JTextField(String.join(", ", unknown));
        other.setToolTipText("Entries that don't match a module, kept as they are");
        JPanel south = new JPanel(new BorderLayout(6, 0));
        south.setVisible(!unknown.isEmpty());
        south.add(new JLabel("Not recognised"), BorderLayout.WEST);
        south.add(other, BorderLayout.CENTER);
        JPanel content2 = new JPanel(new BorderLayout(0, 8));
        content2.add(new JLabel("<html>Which modules' <b>Reports › Apps</b> menu lists this app. "
            + "This doesn't move it between folders.</html>"), BorderLayout.NORTH);
        JScrollPane scroll = new JScrollPane(grid);
        scroll.setBorder(null);
        scroll.setPreferredSize(new Dimension(760, 430));
        scroll.getVerticalScrollBar().setUnitIncrement(16);
        content2.add(scroll, BorderLayout.CENTER);
        content2.add(south, BorderLayout.SOUTH);
        if (JOptionPane.showConfirmDialog(parent, content2, title, JOptionPane.OK_CANCEL_OPTION, JOptionPane.PLAIN_MESSAGE)
            != JOptionPane.OK_OPTION) {
            return null;
        }
        List<String> keys = new ArrayList<>();
        for (Map.Entry<String, JCheckBox> b : boxes.entrySet()) {
            if (b.getValue().isSelected()) {
                keys.add(b.getKey());
            }
        }
        for (String k : AppGroups.keys(other.getText())) {
            if (keys.stream().noneMatch(x -> x.equalsIgnoreCase(k))) {
                keys.add(k);
            }
        }
        return String.join(", ", keys);
    }
}
