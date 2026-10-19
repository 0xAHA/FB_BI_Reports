package com.fbi.plugins.reportbtn.docs.mail;

import javax.swing.BorderFactory;
import javax.swing.JButton;
import javax.swing.JDialog;
import javax.swing.JLabel;
import javax.swing.JPanel;
import javax.swing.JScrollPane;
import javax.swing.JTable;
import javax.swing.JTextField;
import javax.swing.ListSelectionModel;
import javax.swing.RowFilter;
import javax.swing.event.DocumentEvent;
import javax.swing.event.DocumentListener;
import javax.swing.table.AbstractTableModel;
import javax.swing.table.TableRowSorter;
import java.awt.BorderLayout;
import java.awt.Dimension;
import java.awt.FlowLayout;
import java.awt.Window;
import java.awt.event.KeyEvent;
import java.awt.event.MouseAdapter;
import java.awt.event.MouseEvent;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * The To, Cc and Bcc buttons: a list of the record's customer or vendor contacts
 * and the Fishbowl users, ticked where the field already has the address. OK puts the
 * ticked ones in the field and takes out the ones unticked; addresses typed by hand
 * that aren't in the list stay.
 */
final class AddressPicker extends JDialog {

    private final boolean[] ticked;
    private boolean ok;

    private AddressPicker(Window owner, String field, List<EmailAddresses.Address> list, List<String> current) {
        super(owner, "Choose " + field + " addresses", ModalityType.DOCUMENT_MODAL);
        this.ticked = new boolean[list.size()];
        Set<String> have = lower(current);
        for (int i = 0; i < list.size(); i++) {
            ticked[i] = have.contains(list.get(i).email.toLowerCase(Locale.ROOT));
        }

        AbstractTableModel model = new AbstractTableModel() {
            private final String[] cols = {"", "Name", "Email", "From"};

            @Override
            public int getRowCount() {
                return list.size();
            }

            @Override
            public int getColumnCount() {
                return cols.length;
            }

            @Override
            public String getColumnName(int c) {
                return cols[c];
            }

            @Override
            public Class<?> getColumnClass(int c) {
                return c == 0 ? Boolean.class : String.class;
            }

            @Override
            public boolean isCellEditable(int r, int c) {
                return c == 0;
            }

            @Override
            public Object getValueAt(int r, int c) {
                EmailAddresses.Address a = list.get(r);
                return c == 0 ? ticked[r] : c == 1 ? a.name : c == 2 ? a.email : a.source;
            }

            @Override
            public void setValueAt(Object v, int r, int c) {
                if (c == 0) {
                    ticked[r] = Boolean.TRUE.equals(v);
                    fireTableCellUpdated(r, c);
                }
            }
        };
        JTable table = new JTable(model);
        table.setSelectionMode(ListSelectionModel.MULTIPLE_INTERVAL_SELECTION);
        table.getColumnModel().getColumn(0).setMaxWidth(30);
        table.getColumnModel().getColumn(1).setPreferredWidth(170);
        table.getColumnModel().getColumn(2).setPreferredWidth(230);
        table.getColumnModel().getColumn(3).setPreferredWidth(170);
        TableRowSorter<AbstractTableModel> sorter = new TableRowSorter<>(model);
        table.setRowSorter(sorter);
        // A click anywhere on a row ticks it; double-click ticks it and closes.
        table.addMouseListener(new MouseAdapter() {
            @Override
            public void mouseClicked(MouseEvent e) {
                int view = table.rowAtPoint(e.getPoint());
                if (view < 0 || table.columnAtPoint(e.getPoint()) == 0) {
                    return;
                }
                int r = table.convertRowIndexToModel(view);
                if (e.getClickCount() == 2) {
                    ticked[r] = true;
                    finish(true);
                } else {
                    model.setValueAt(!ticked[r], r, 0);
                }
            }
        });

        JTextField find = new JTextField();
        find.setToolTipText("Type part of a name, address or company");
        find.getDocument().addDocumentListener(new DocumentListener() {
            private void go() {
                String t = find.getText().trim();
                sorter.setRowFilter(t.isEmpty() ? null : RowFilter.regexFilter("(?i)" + java.util.regex.Pattern.quote(t), 1, 2, 3));
            }

            @Override
            public void insertUpdate(DocumentEvent e) {
                go();
            }

            @Override
            public void removeUpdate(DocumentEvent e) {
                go();
            }

            @Override
            public void changedUpdate(DocumentEvent e) {
                go();
            }
        });
        JPanel top = new JPanel(new BorderLayout(6, 0));
        top.setBorder(BorderFactory.createEmptyBorder(8, 10, 6, 10));
        top.add(new JLabel("Find"), BorderLayout.WEST);
        top.add(find, BorderLayout.CENTER);

        JPanel south = new JPanel(new BorderLayout());
        south.setBorder(BorderFactory.createEmptyBorder(6, 10, 8, 10));
        south.add(new JLabel(list.isEmpty() ? "No addresses found." : "Tick the addresses to send to."), BorderLayout.WEST);
        JPanel buttons = new JPanel(new FlowLayout(FlowLayout.RIGHT, 6, 0));
        JButton cancel = new JButton("Cancel");
        cancel.addActionListener(e -> finish(false));
        JButton okBtn = new JButton("OK");
        okBtn.addActionListener(e -> finish(true));
        buttons.add(cancel);
        buttons.add(okBtn);
        south.add(buttons, BorderLayout.EAST);

        getContentPane().setLayout(new BorderLayout());
        getContentPane().add(top, BorderLayout.NORTH);
        JScrollPane scroll = new JScrollPane(table);
        scroll.setBorder(BorderFactory.createEmptyBorder(0, 10, 0, 10));
        getContentPane().add(scroll, BorderLayout.CENTER);
        getContentPane().add(south, BorderLayout.SOUTH);
        getRootPane().setDefaultButton(okBtn);
        getRootPane().registerKeyboardAction(e -> finish(false),
            javax.swing.KeyStroke.getKeyStroke(KeyEvent.VK_ESCAPE, 0), javax.swing.JComponent.WHEN_IN_FOCUSED_WINDOW);
        setDefaultCloseOperation(DISPOSE_ON_CLOSE);
        setSize(new Dimension(680, 420));
        setLocationRelativeTo(owner);
    }

    private void finish(boolean accept) {
        ok = accept;
        dispose();
    }

    /**
     * Opens the list for one field. Returns the field's new addresses, or null when
     * cancelled.
     */
    static List<String> choose(Window owner, String field, List<EmailAddresses.Address> list, List<String> current) {
        AddressPicker p = new AddressPicker(owner, field, list, current);
        p.setVisible(true);
        return p.ok ? EmailAddresses.merge(list, p.ticked, current) : null;
    }

    private static Set<String> lower(List<String> l) {
        Set<String> s = new HashSet<>();
        for (String a : l) {
            s.add(a.toLowerCase(Locale.ROOT));
        }
        return s;
    }
}
