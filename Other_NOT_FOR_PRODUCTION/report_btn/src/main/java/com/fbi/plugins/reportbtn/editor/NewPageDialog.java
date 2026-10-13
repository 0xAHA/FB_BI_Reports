package com.fbi.plugins.reportbtn.editor;

import com.evnt.client.modules.biscripteditor.panel.BiAccessRightsPanel;
import com.fbi.fbdata.bi.BiReportAccessFpo;

import javax.swing.BorderFactory;
import javax.swing.Box;
import javax.swing.JButton;
import javax.swing.JCheckBox;
import javax.swing.JComboBox;
import javax.swing.JComponent;
import javax.swing.JLabel;
import javax.swing.JOptionPane;
import javax.swing.JPanel;
import javax.swing.JTextField;
import java.awt.BorderLayout;
import java.awt.Component;
import java.awt.Dimension;
import java.awt.FlowLayout;
import java.awt.GridBagConstraints;
import java.awt.GridBagLayout;
import java.awt.Insets;
import java.util.List;

/** Asks what a new app is called, where it belongs, what it starts from and who sees it. */
final class NewPageDialog {

    static final class Spec {
        final String name;
        final String description;
        final String launchTag;
        /** The folder (fb-folder); "" for Unfiled. */
        final String folder;
        final ScriptService.Includable template;
        final boolean published;
        final boolean gadget;
        final List<BiReportAccessFpo> access;

        Spec(String name, String description, String launchTag, String folder, ScriptService.Includable template,
             boolean published, boolean gadget, List<BiReportAccessFpo> access) {
            this.name = name;
            this.description = description;
            this.launchTag = launchTag;
            this.folder = folder;
            this.template = template;
            this.published = published;
            this.gadget = gadget;
            this.access = access;
        }
    }

    private NewPageDialog() {
    }

    /** canGadget: the user may make the new app a dashboard gadget (BI Report-Edit, or admin). */
    static Spec ask(Component parent, List<ScriptService.Includable> templates, boolean canGadget, List<String> folders) {
        JTextField name = new JTextField();
        JTextField description = new JTextField();
        // The Apps menus are picked, never typed: the field shows module names.
        String[] keys = {""};
        JTextField tag = new JTextField("none");
        tag.setEditable(false);
        tag.setToolTipText("Which modules' Reports › Apps menus list the app");
        JButton pick = new JButton("Choose…");
        pick.addActionListener(e -> {
            String c = ModulePicker.ask(parent, "Apps menus", keys[0]);
            if (c != null) {
                keys[0] = c;
                tag.setText(c.isEmpty() ? "none" : AppGroups.describe(c));
                tag.setCaretPosition(0);
            }
        });
        JPanel tagRow = new JPanel(new BorderLayout(4, 0));
        tagRow.add(tag, BorderLayout.CENTER);
        tagRow.add(pick, BorderLayout.EAST);
        JComboBox<String> folder = new JComboBox<>();
        folder.addItem("");
        for (String f : folders) {
            folder.addItem(f);
        }
        folder.setEditable(true);
        folder.setToolTipText("Where the app sits in the Apps panel and the App Library (blank: Unfiled)");
        JComboBox<String> template = new JComboBox<>();
        template.addItem("(blank)");
        for (ScriptService.Includable t : templates) {
            template.addItem(t.name + (t.typeId == 40 ? "  (template)" : ""));
        }
        if (templates.size() > 0) {
            template.setSelectedIndex(1);
        }
        JCheckBox published = new JCheckBox("Published", true);
        JCheckBox gadget = new JCheckBox("Dashboard gadget");
        gadget.setEnabled(canGadget);
        gadget.setToolTipText(canGadget ? "Offer the app as a gadget on the Fishbowl home dashboard"
            : "Needs the BI Report-Edit right");
        BiAccessRightsPanel access = new BiAccessRightsPanel();
        try {
            access.init();   // the default groups, as the BI Editor's New does
        } catch (RuntimeException ignored) {
            // an empty list: admin only
        }
        access.setPreferredSize(new Dimension(520, 220));

        // One column of equally wide fields.
        JPanel form = new JPanel(new GridBagLayout());
        GridBagConstraints c = new GridBagConstraints();
        c.insets = new Insets(3, 3, 3, 3);
        String[] labels = {"Name", "Description", "Folder", "Apps menus", "Start from"};
        JComponent[] fields = {name, description, folder, tagRow, template};
        for (int i = 0; i < labels.length; i++) {
            c.gridy = i;
            c.gridx = 0;
            c.weightx = 0;
            c.fill = GridBagConstraints.NONE;
            c.anchor = GridBagConstraints.WEST;
            form.add(new JLabel(labels[i]), c);
            c.gridx = 1;
            c.weightx = 1;
            c.fill = GridBagConstraints.HORIZONTAL;
            form.add(fields[i], c);
        }
        JPanel flags = new JPanel(new FlowLayout(FlowLayout.LEFT, 0, 0));
        flags.add(published);
        flags.add(Box.createHorizontalStrut(16));
        flags.add(gadget);
        c.gridy = labels.length;
        c.gridx = 1;
        form.add(flags, c);
        form.setPreferredSize(new Dimension(520, form.getPreferredSize().height));

        JPanel content = new JPanel(new BorderLayout(0, 8));
        content.add(form, BorderLayout.NORTH);
        JPanel acc = new JPanel(new BorderLayout());
        acc.setBorder(BorderFactory.createTitledBorder("Who can open it"));
        acc.add(access, BorderLayout.CENTER);
        content.add(acc, BorderLayout.CENTER);
        published.addActionListener(e -> {
            access.setEnabled(published.isSelected());
            gadget.setEnabled(canGadget && published.isSelected());
        });

        while (true) {
            if (JOptionPane.showConfirmDialog(parent, content, "New App", JOptionPane.OK_CANCEL_OPTION,
                JOptionPane.PLAIN_MESSAGE) != JOptionPane.OK_OPTION) {
                return null;
            }
            String problem = AccessPolicy.validateName(name.getText().trim(), description.getText().trim());
            String t = keys[0].trim();
            String fo = folder.getSelectedItem() == null ? "" : String.valueOf(folder.getSelectedItem()).trim();
            if (problem.isEmpty() && !fo.isEmpty() && !AppGroups.folderProblem(fo).isEmpty()) {
                problem = AppGroups.folderProblem(fo);
            }
            if (problem.isEmpty()) {
                int i = template.getSelectedIndex();
                return new Spec(name.getText().trim(), description.getText().trim(), t.toUpperCase(), fo,
                    i <= 0 ? null : templates.get(i - 1), published.isSelected(),
                    published.isSelected() && gadget.isEnabled() && gadget.isSelected(),
                    published.isSelected() ? access.getAccessList() : null);
            }
            JOptionPane.showMessageDialog(parent, problem, "New App", JOptionPane.WARNING_MESSAGE);
        }
    }
}
