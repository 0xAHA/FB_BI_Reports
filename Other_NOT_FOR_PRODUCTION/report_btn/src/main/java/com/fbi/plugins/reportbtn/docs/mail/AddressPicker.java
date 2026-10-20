package com.fbi.plugins.reportbtn.docs.mail;

import com.evnt.client.dialogs.EmailAddressBookDialog;
import com.evnt.common.EmailClientConst;

import javax.swing.BorderFactory;
import javax.swing.JButton;
import javax.swing.JDialog;
import javax.swing.JPanel;
import javax.swing.JScrollPane;
import javax.swing.JTabbedPane;
import javax.swing.JTable;
import javax.swing.JTextField;
import javax.swing.ListSelectionModel;
import javax.swing.table.AbstractTableModel;
import javax.swing.table.TableRowSorter;
import java.awt.BorderLayout;
import java.awt.Dialog;
import java.awt.Dimension;
import java.awt.FlowLayout;
import java.awt.GridBagConstraints;
import java.awt.GridBagLayout;
import java.awt.Insets;
import java.awt.Window;
import java.awt.event.FocusAdapter;
import java.awt.event.FocusEvent;
import java.awt.event.KeyEvent;
import java.awt.event.MouseAdapter;
import java.awt.event.MouseEvent;
import java.util.ArrayList;
import java.util.List;

/**
 * The address book behind the email window's To, Cc and Bcc buttons: the client's own
 * Email Address Book (Customer or Vendor tab, Company tab; double-click a row to add it
 * to the To field, or to Cc / Bcc once one of those is clicked in), filled with the
 * record's addresses. Should that dialog not open (another client version), a copy of
 * it in the same layout opens instead.
 */
final class AddressPicker {

    private AddressPicker() {
    }

    /** The three fields after the address book, or null when cancelled. Field is "To", "Cc" or "Bcc". */
    static String[] choose(Window owner, String field, EmailAddresses.Book book, String to, String cc, String bcc,
                           java.util.function.BiConsumer<String, Throwable> log) {
        try {
            return stock(owner, field, book, to, cc, bcc);
        } catch (RuntimeException | LinkageError e) {
            log.accept("the client's address book didn't open; using the plugin's copy", e);
            return Copy.choose(owner, field, book, to, cc, bcc);
        }
    }

    @SuppressWarnings({"unchecked", "rawtypes"})
    private static String[] stock(Window owner, String field, EmailAddresses.Book book, String to, String cc, String bcc) {
        EmailAddressBookDialog d = new EmailAddressBookDialog(EmailAddressBookDialog.FieldConst.valueOf(field.toUpperCase(java.util.Locale.ROOT)));
        List rec = stock(book.record), co = stock(book.company);
        d.init(rec, co, stockType(book.mailType), to, cc, bcc);
        d.setModalityType(Dialog.ModalityType.APPLICATION_MODAL);   // so setVisible waits for OK / Cancel
        d.setLocationRelativeTo(owner);
        d.setVisible(true);
        return d.isOkPressed() ? new String[] {d.getToEmails(), d.getCcEmails(), d.getBccEmails()} : null;
    }

    private static List<EmailClientConst.EmailAddress> stock(List<EmailAddresses.Address> list) {
        List<EmailClientConst.EmailAddress> out = new ArrayList<>();
        for (EmailAddresses.Address a : list) {
            out.add(new EmailClientConst.EmailAddress(a.name.isEmpty() ? a.email : a.name, a.email));
        }
        return out;
    }

    /** The stock window's email type for the document's template type. */
    static int stockType(String mailType) {
        switch (mailType == null ? "" : mailType) {
            case "SO": return EmailClientConst.EMAIL_SO;
            case "PO": return EmailClientConst.EMAIL_PO;
            case "SHIP": return EmailClientConst.EMAIL_SHIP;
            default: return EmailClientConst.EMAIL_GENERIC;
        }
    }

    /** The plugin's copy of the Email Address Book, in the same layout. */
    static final class Copy extends JDialog {

        private final JTextField to = new JTextField(), cc = new JTextField(), bcc = new JTextField();
        private JTextField insert;
        private boolean ok;

        private Copy(Window owner, String field, EmailAddresses.Book book, String toText, String ccText, String bccText) {
            super(owner, "Email Address Book", ModalityType.APPLICATION_MODAL);
            to.setText(toText);
            cc.setText(ccText);
            bcc.setText(bccText);
            insert = "Cc".equalsIgnoreCase(field) ? cc : "Bcc".equalsIgnoreCase(field) ? bcc : to;

            JTabbedPane tabs = new JTabbedPane();
            JTable record = table(book.record), company = table(book.company);
            tabs.addTab(book.recordTab, new JScrollPane(record));
            tabs.addTab("Company", new JScrollPane(company));
            if (book.record.isEmpty() && !book.company.isEmpty()) {
                tabs.setSelectedIndex(1);
            }

            JPanel fields = new JPanel(new GridBagLayout());
            fields.setBorder(BorderFactory.createEmptyBorder(8, 0, 0, 0));
            row(fields, 0, "To ->", to, tabs);
            row(fields, 1, "Cc ->", cc, tabs);
            row(fields, 2, "Bcc ->", bcc, tabs);

            JPanel buttons = new JPanel(new FlowLayout(FlowLayout.RIGHT, 6, 0));
            buttons.setBorder(BorderFactory.createEmptyBorder(10, 0, 0, 0));
            JButton okBtn = new JButton("OK"), cancel = new JButton("Cancel");
            okBtn.setPreferredSize(new Dimension(80, okBtn.getPreferredSize().height));
            cancel.setPreferredSize(okBtn.getPreferredSize());
            okBtn.addActionListener(e -> finish(true));
            cancel.addActionListener(e -> finish(false));
            buttons.add(okBtn);
            buttons.add(cancel);

            JPanel south = new JPanel(new BorderLayout());
            south.add(fields, BorderLayout.CENTER);
            south.add(buttons, BorderLayout.SOUTH);
            JPanel content = new JPanel(new BorderLayout());
            content.setBorder(BorderFactory.createEmptyBorder(10, 12, 10, 12));
            content.add(tabs, BorderLayout.CENTER);
            content.add(south, BorderLayout.SOUTH);
            setContentPane(content);
            getRootPane().registerKeyboardAction(e -> finish(false),
                javax.swing.KeyStroke.getKeyStroke(KeyEvent.VK_ESCAPE, 0), javax.swing.JComponent.WHEN_IN_FOCUSED_WINDOW);
            setDefaultCloseOperation(DISPOSE_ON_CLOSE);
            setSize(new Dimension(450, 510));
            setLocationRelativeTo(owner);
        }

        static String[] choose(Window owner, String field, EmailAddresses.Book book, String to, String cc, String bcc) {
            Copy c = new Copy(owner, field, book, to, cc, bcc);
            c.setVisible(true);
            return c.ok ? new String[] {c.to.getText(), c.cc.getText(), c.bcc.getText()} : null;
        }

        /** A Name / Email list; double-click adds the row to the field last clicked in (To at first). */
        private JTable table(List<EmailAddresses.Address> list) {
            AbstractTableModel model = new AbstractTableModel() {
                @Override
                public int getRowCount() {
                    return list.size();
                }

                @Override
                public int getColumnCount() {
                    return 2;
                }

                @Override
                public String getColumnName(int c) {
                    return c == 0 ? "Name" : "Email";
                }

                @Override
                public Object getValueAt(int r, int c) {
                    EmailAddresses.Address a = list.get(r);
                    return c == 0 ? a.name : a.email;
                }
            };
            JTable t = new JTable(model);
            t.setSelectionMode(ListSelectionModel.MULTIPLE_INTERVAL_SELECTION);
            t.setRowSorter(new TableRowSorter<>(model));
            t.setFillsViewportHeight(true);
            t.putClientProperty("list", list);
            t.addMouseListener(new MouseAdapter() {
                @Override
                public void mouseClicked(MouseEvent e) {
                    int view = t.rowAtPoint(e.getPoint());
                    if (e.getClickCount() == 2 && view >= 0) {
                        insert.setText(EmailAddresses.append(insert.getText(), list.get(t.convertRowIndexToModel(view))));
                    }
                }
            });
            return t;
        }

        /** "To ->" adds the selected rows of the open tab to its field, as the stock buttons do. */
        @SuppressWarnings("unchecked")
        private void row(JPanel p, int y, String label, JTextField field, JTabbedPane tabs) {
            field.addFocusListener(new FocusAdapter() {
                @Override
                public void focusGained(FocusEvent e) {
                    insert = field;
                }
            });
            JButton b = new JButton(label);
            b.setMargin(new Insets(2, 6, 2, 6));
            b.addActionListener(e -> {
                insert = field;
                JTable t = (JTable) ((JScrollPane) tabs.getSelectedComponent()).getViewport().getView();
                List<EmailAddresses.Address> list = (List<EmailAddresses.Address>) t.getClientProperty("list");
                for (int view : t.getSelectedRows()) {
                    field.setText(EmailAddresses.append(field.getText(), list.get(t.convertRowIndexToModel(view))));
                }
            });
            GridBagConstraints l = new GridBagConstraints();
            l.gridx = 0;
            l.gridy = y;
            l.fill = GridBagConstraints.HORIZONTAL;
            l.insets = new Insets(2, 0, 2, 6);
            p.add(b, l);
            GridBagConstraints f = new GridBagConstraints();
            f.gridx = 1;
            f.gridy = y;
            f.weightx = 1;
            f.fill = GridBagConstraints.HORIZONTAL;
            f.insets = new Insets(2, 0, 2, 0);
            p.add(field, f);
        }

        private void finish(boolean accept) {
            ok = accept;
            dispose();
        }
    }
}
