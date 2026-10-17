package com.fbi.plugins.reportbtn.editor;

import javax.swing.DefaultListModel;
import javax.swing.JDialog;
import javax.swing.JLabel;
import javax.swing.JList;
import javax.swing.JOptionPane;
import javax.swing.JPanel;
import javax.swing.JScrollPane;
import javax.swing.JTextField;
import javax.swing.ListSelectionModel;
import javax.swing.event.DocumentEvent;
import javax.swing.event.DocumentListener;
import java.awt.BorderLayout;
import java.awt.Component;
import java.awt.Dimension;
import java.awt.event.MouseAdapter;
import java.awt.event.MouseEvent;
import java.util.List;

/**
 * The editor's Folder button: pick the app's folder (or Unfiled) from the list, or
 * type a new one. Double-click picks. The result is the fb-folder tag's content.
 */
final class FolderPicker {

    private FolderPicker() {
    }

    /** The folder ("" for Unfiled), or null when cancelled. */
    static String ask(Component parent, String title, String current, List<String> folders) {
        DefaultListModel<String> model = new DefaultListModel<>();
        model.addElement(AppGroups.UNFILED);
        for (String f : folders) {
            model.addElement(f);
        }
        if (!current.isEmpty() && folders.stream().noneMatch(f -> f.equalsIgnoreCase(current))) {
            model.addElement(current);
        }
        JList<String> list = new JList<>(model);
        list.setSelectionMode(ListSelectionModel.SINGLE_SELECTION);
        list.setVisibleRowCount(14);
        for (int i = 0; i < model.size(); i++) {
            if (i == 0 ? current.isEmpty() : model.get(i).equalsIgnoreCase(current)) {
                list.setSelectedIndex(i);
                list.ensureIndexIsVisible(i);
                break;
            }
        }
        JTextField other = new JTextField();
        other.setToolTipText("A folder that isn't in the list yet");
        other.getDocument().addDocumentListener(new DocumentListener() {
            public void insertUpdate(DocumentEvent e) { typed(); }
            public void removeUpdate(DocumentEvent e) { typed(); }
            public void changedUpdate(DocumentEvent e) { typed(); }

            private void typed() {
                if (!other.getText().trim().isEmpty()) {
                    list.clearSelection();
                }
            }
        });
        list.addListSelectionListener(e -> {
            if (!list.isSelectionEmpty() && !other.getText().isEmpty()) {
                other.setText("");
            }
        });

        JScrollPane scroll = new JScrollPane(list);
        scroll.setPreferredSize(new Dimension(320, 300));
        JPanel south = new JPanel(new BorderLayout(6, 0));
        south.add(new JLabel("New folder"), BorderLayout.WEST);
        south.add(other, BorderLayout.CENTER);
        JPanel content = new JPanel(new BorderLayout(0, 8));
        content.add(new JLabel("<html>Where the app sits in the Apps panel and the App Library.<br>"
            + "This doesn't change which Apps menus list it.</html>"), BorderLayout.NORTH);
        content.add(scroll, BorderLayout.CENTER);
        content.add(south, BorderLayout.SOUTH);

        JOptionPane pane = new JOptionPane(content, JOptionPane.PLAIN_MESSAGE, JOptionPane.OK_CANCEL_OPTION);
        list.addMouseListener(new MouseAdapter() {
            @Override
            public void mouseClicked(MouseEvent e) {
                if (e.getClickCount() == 2 && list.locationToIndex(e.getPoint()) >= 0) {
                    pane.setValue(JOptionPane.OK_OPTION);   // closes the dialog
                }
            }
        });
        while (true) {
            JDialog d = pane.createDialog(parent, title);
            d.setResizable(true);
            d.setVisible(true);
            d.dispose();
            Object v = pane.getValue();
            if (!(v instanceof Integer) || (Integer) v != JOptionPane.OK_OPTION) {
                return null;
            }
            String typed = other.getText().trim();
            if (typed.isEmpty()) {
                int i = list.getSelectedIndex();
                return i < 0 ? null : i == 0 ? "" : model.get(i);
            }
            for (String f : folders) {
                if (f.equalsIgnoreCase(typed)) {
                    return f;   // an existing folder, as it is spelled
                }
            }
            String problem = AppGroups.folderProblem(typed);
            if (problem.isEmpty()) {
                return typed;
            }
            JOptionPane.showMessageDialog(parent, problem, title, JOptionPane.ERROR_MESSAGE);
            pane.setValue(JOptionPane.UNINITIALIZED_VALUE);
        }
    }
}
