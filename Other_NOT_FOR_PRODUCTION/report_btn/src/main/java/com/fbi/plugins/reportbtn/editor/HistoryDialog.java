package com.fbi.plugins.reportbtn.editor;

import com.fbi.fbdata.AuditRecord;
import com.fbi.fbdata.bi.BiScriptFpo;

import javax.swing.BorderFactory;
import javax.swing.JButton;
import javax.swing.JDialog;
import javax.swing.JOptionPane;
import javax.swing.JPanel;
import javax.swing.JScrollPane;
import javax.swing.JTable;
import javax.swing.ListSelectionModel;
import javax.swing.SwingUtilities;
import javax.swing.table.DefaultTableModel;
import java.awt.BorderLayout;
import java.awt.Component;
import java.awt.Dimension;
import java.awt.FlowLayout;
import java.awt.Window;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Consumer;

/**
 * A script's saved versions (Fishbowl's audit history): compare any two, or a
 * version with the editor, and restore one into the editor. The native history
 * dialog can only compare; restoring here is an undoable edit, never a save.
 */
final class HistoryDialog {

    private HistoryDialog() {
    }

    static void show(Component parent, ScriptService service, BiScriptFpo fpo, int typeId, String current, Consumer<String> restore) {
        List<AuditRecord> versions;
        try {
            versions = service.history(fpo.getId());
        } catch (ScriptService.ServiceException e) {
            JOptionPane.showMessageDialog(parent, e.getMessage(), "History", JOptionPane.ERROR_MESSAGE);
            return;
        }
        List<String> texts = new ArrayList<>();
        List<String> labels = new ArrayList<>();
        Map<Integer, String> users = new HashMap<>();
        SimpleDateFormat fmt = new SimpleDateFormat("yyyy-MM-dd HH:mm:ss");
        DefaultTableModel model = new DefaultTableModel(new Object[]{"#", "Saved", "By", "Change", "Size"}, 0) {
            @Override
            public boolean isCellEditable(int row, int column) {
                return false;
            }
        };
        int i = 0;
        for (AuditRecord r : versions) {
            String text = textOf(r);
            if (text == null) {
                continue;
            }
            Integer uid = r.getModifiedUserId();
            String user = uid == null ? "" : users.computeIfAbsent(uid, service::userName);
            String when = r.getTimestamp() == null ? "" : fmt.format(r.getTimestamp());
            texts.add(text);
            labels.add(when + (user.isEmpty() ? "" : " (" + user + ")"));
            model.addRow(new Object[]{++i, when, user, r.getRevisionType() == null ? "" : r.getRevisionType().name(),
                text.length() / 1024 + " KB"});
        }
        if (texts.isEmpty()) {
            JOptionPane.showMessageDialog(parent, "Fishbowl has no saved versions of this record.", "History",
                JOptionPane.INFORMATION_MESSAGE);
            return;
        }

        Window owner = SwingUtilities.getWindowAncestor(parent);
        JDialog d = new JDialog(owner, "History: " + fpo.getName(), java.awt.Dialog.ModalityType.APPLICATION_MODAL);
        JTable table = new JTable(model);
        table.setSelectionMode(ListSelectionModel.MULTIPLE_INTERVAL_SELECTION);
        table.getColumnModel().getColumn(0).setMaxWidth(40);
        int last = model.getRowCount() - 1;
        table.setRowSelectionInterval(last, last);
        JButton withEditor = new JButton("Compare with the editor");
        JButton two = new JButton("Compare the two selected");
        JButton restoreBtn = new JButton("Restore into the editor");
        JButton close = new JButton("Close");
        withEditor.addActionListener(e -> {
            int r = table.getSelectedRow();
            if (r >= 0) {
                Diff.show(d, typeId, labels.get(r), texts.get(r), "The editor (unsaved)", current);
            }
        });
        two.addActionListener(e -> {
            int[] rows = table.getSelectedRows();
            if (rows.length != 2) {
                JOptionPane.showMessageDialog(d, "Select exactly two versions (Ctrl+click).", "History", JOptionPane.INFORMATION_MESSAGE);
                return;
            }
            Diff.show(d, typeId, labels.get(rows[0]), texts.get(rows[0]), labels.get(rows[1]), texts.get(rows[1]));
        });
        restoreBtn.addActionListener(e -> {
            int r = table.getSelectedRow();
            if (r >= 0 && JOptionPane.showConfirmDialog(d, "Replace the editor's text with the version saved " + labels.get(r)
                + "? It isn't saved until you save (Ctrl+Z undoes it).", "Restore", JOptionPane.OK_CANCEL_OPTION) == JOptionPane.OK_OPTION) {
                restore.accept(texts.get(r));
                d.dispose();
            }
        });
        close.addActionListener(e -> d.dispose());
        JPanel buttons = new JPanel(new FlowLayout(FlowLayout.RIGHT));
        buttons.add(withEditor);
        buttons.add(two);
        buttons.add(restoreBtn);
        buttons.add(close);
        JPanel content = new JPanel(new BorderLayout(0, 6));
        content.setBorder(BorderFactory.createEmptyBorder(8, 8, 8, 8));
        content.add(new JScrollPane(table), BorderLayout.CENTER);
        content.add(buttons, BorderLayout.SOUTH);
        d.setContentPane(content);
        d.setSize(new Dimension(680, 420));
        d.setLocationRelativeTo(parent);
        d.setVisible(true);
    }

    private static String textOf(AuditRecord r) {
        Object rec = r.getRecord();
        if (rec instanceof BiScriptFpo) {
            return ((BiScriptFpo) rec).getData();
        }
        try {
            return new com.fbi.row.audit.data.BiScriptAuditRowData(r).getValue();
        } catch (RuntimeException e) {
            return null;
        }
    }
}
