package com.fbi.plugins.reportbtn.docs.mail;

import com.fbi.plugins.reportbtn.BrowserFit;
import com.fbi.util.FishbowlBrowser;

import javax.swing.BorderFactory;
import javax.swing.JButton;
import javax.swing.JCheckBoxMenuItem;
import javax.swing.JFileChooser;
import javax.swing.JFrame;
import javax.swing.JLabel;
import javax.swing.JOptionPane;
import javax.swing.JMenuItem;
import javax.swing.JPanel;
import javax.swing.JPopupMenu;
import javax.swing.JTextField;
import javax.swing.SwingUtilities;
import javax.swing.SwingWorker;
import javax.swing.Timer;
import javax.swing.UIManager;
import javax.swing.WindowConstants;
import java.awt.BorderLayout;
import java.awt.Color;
import java.awt.Component;
import java.awt.Cursor;
import java.awt.Desktop;
import java.awt.Dialog;
import java.awt.Dimension;
import java.awt.FlowLayout;
import java.awt.Frame;
import java.awt.GridBagConstraints;
import java.awt.GridBagLayout;
import java.awt.Insets;
import java.awt.Window;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

/**
 * The rich email window: To / Cc / Bcc / Subject, the attachments, and the body in
 * an HTML editor (Composer.htm in a JxBrowser view), so an HTML template shows as it
 * will arrive. Send goes through Fishbowl's own email settings (MailSender); "Open in
 * my email program" hands the email to the user's own email program instead
 * (OwnMailProgram), just this once or from now on (remembered for the user). The To, Cc and Bcc
 * labels are buttons that list the record's customer or vendor contacts and the
 * Fishbowl users.
 */
public final class EmailComposer extends JFrame {

    /** The user's "open in my email program" choice, kept by the caller. */
    public interface Prefs {
        boolean usesProgram();

        void setUsesProgram(boolean on) throws Exception;
    }

    /** The addresses the To / Cc / Bcc buttons offer (the record's contacts, then the Fishbowl users), read when first needed. */
    public interface AddressBook {
        List<EmailAddresses.Address> addresses();
    }

    private static final String SEPARATE = "<html>Separate several addresses with a semicolon ( ; ),<br>"
        + "e.g. anna@acme.com; ben@acme.com</html>";

    private final FishbowlBrowser browser;
    private final JTextField to = new JTextField(), cc = new JTextField(), bcc = new JTextField(), subject = new JTextField();
    private final JPanel chips = new JPanel(new FlowLayout(FlowLayout.LEFT, 4, 0));
    private final List<File> files = new ArrayList<>();
    private final JButton send = new JButton("Send");
    private final JButton program = new JButton("Open in my email program ▾");
    private final Prefs prefs;
    private final AddressBook book;
    private List<EmailAddresses.Address> addresses;
    private String pendingHtml;

    private EmailComposer(Window owner, EmailDraft d, String note, Prefs prefs, AddressBook book) {
        super(d.subject == null || d.subject.isEmpty() ? "Email" : d.subject);
        this.prefs = prefs;
        this.book = book;
        setModalExclusionType(Dialog.ModalExclusionType.APPLICATION_EXCLUDE);
        setDefaultCloseOperation(WindowConstants.DISPOSE_ON_CLOSE);
        if (owner instanceof Frame && ((Frame) owner).getIconImages() != null) {
            setIconImages(((Frame) owner).getIconImages());
        }
        to.setText(EmailDraft.join(d.to));
        cc.setText(EmailDraft.join(d.cc));
        bcc.setText(EmailDraft.join(d.bcc));
        subject.setText(d.subject);
        files.addAll(d.attachments);

        JPanel form = new JPanel(new GridBagLayout());
        form.setBorder(BorderFactory.createEmptyBorder(8, 10, 4, 10));
        MailSettings s = MailSettings.current();
        String from = MailSettings.blank(s.fromEmail) ? "(the address in your email settings)"
            : (MailSettings.blank(s.fromName) ? s.fromEmail : s.fromName + " <" + s.fromEmail + ">");
        row(form, 0, "From", new JLabel(from));
        row(form, 1, chooser("To", to), to);
        row(form, 2, chooser("Cc", cc), cc);
        row(form, 3, chooser("Bcc", bcc), bcc);
        row(form, 4, "Subject", subject);
        JPanel attach = new JPanel(new BorderLayout(6, 0));
        attach.add(chips, BorderLayout.CENTER);
        JButton add = new JButton("Attach…");
        add.addActionListener(e -> addFile());
        attach.add(add, BorderLayout.EAST);
        row(form, 5, "Attached", attach);
        if (note != null && !note.isEmpty()) {
            JLabel n = new JLabel(note);
            n.setForeground(UIManager.getColor("Label.disabledForeground"));
            row(form, 6, "", n);
        }
        renderChips();

        FishbowlBrowser.start();   // the client's shared engine; does nothing once it runs
        browser = new FishbowlBrowser();
        Component view = browser.getBrowserView();
        JPanel center = new JPanel(new BorderLayout());
        center.add(view, BorderLayout.CENTER);
        BrowserFit.attach(center);

        JPanel south = new JPanel(new BorderLayout());
        south.setBorder(BorderFactory.createEmptyBorder(6, 10, 8, 10));
        JPanel buttons = new JPanel(new FlowLayout(FlowLayout.RIGHT, 6, 0));
        JButton cancel = new JButton("Cancel");
        cancel.addActionListener(e -> dispose());
        send.setToolTipText("Send it now through Fishbowl's email settings");
        send.addActionListener(e -> send(false));
        program.setToolTipText("Hand this email to your own email program (Outlook, or your default email app) to send from there");
        program.addActionListener(e -> programMenu().show(program, 0, program.getHeight()));
        buttons.add(cancel);
        buttons.add(program);
        buttons.add(send);
        south.add(buttons, BorderLayout.EAST);

        getContentPane().setLayout(new BorderLayout());
        getContentPane().add(form, BorderLayout.NORTH);
        getContentPane().add(center, BorderLayout.CENTER);
        getContentPane().add(south, BorderLayout.SOUTH);
        addWindowListener(new java.awt.event.WindowAdapter() {
            @Override
            public void windowClosed(java.awt.event.WindowEvent e) {
                try {
                    browser.close();
                } catch (RuntimeException ignored) {
                    // closing anyway
                }
            }
        });
        setSize(owner != null && owner.getWidth() > 600 ? new Dimension(Math.min(1100, owner.getWidth() * 3 / 4),
            owner.getHeight() * 4 / 5) : new Dimension(1000, 780));
        setLocationRelativeTo(owner);

        pendingHtml = d.html;
        browser.loadHtml(page());
        BrowserFit.afterLoad(center);
        // The editor page defines window.Composer once it has loaded; then the body goes in.
        Timer t = new Timer(150, null);
        long until = System.currentTimeMillis() + 15000;
        t.addActionListener(e -> {
            Object ready = js("typeof window.Composer");
            if ("object".equals(String.valueOf(ready))) {
                js("Composer.load(" + jsString(pendingHtml) + ")");
                pendingHtml = null;
                t.stop();
            } else if (System.currentTimeMillis() > until) {
                t.stop();
                JOptionPane.showMessageDialog(this, "The email editor didn't start.", "Email", JOptionPane.ERROR_MESSAGE);
            }
        });
        t.start();
    }

    /** Opens the window over parent. */
    public static void open(Component parent, EmailDraft d, String note, Prefs prefs, AddressBook book) {
        Window owner = parent == null ? null : (parent instanceof Window ? (Window) parent : SwingUtilities.getWindowAncestor(parent));
        new EmailComposer(owner, d, note, prefs, book).setVisible(true);
    }

    /** "Just this once", and "Always" (remembered for the user; unticked, it stops). */
    private JPopupMenu programMenu() {
        JPopupMenu m = new JPopupMenu();
        JMenuItem once = new JMenuItem("Just this once");
        once.setToolTipText("Open this email in your email program; next time this window opens as usual");
        once.addActionListener(e -> send(true));
        m.add(once);
        if (prefs != null) {
            boolean always = prefs.usesProgram();
            JCheckBoxMenuItem remember = new JCheckBoxMenuItem("Always (skip this window from now on)", always);
            remember.setToolTipText("<html>Remembered for you: emails go straight to your email program.<br>"
                + "Change it back here, or under Apps (beta) › Documents.</html>");
            remember.addActionListener(e -> {
                if (!setAlways(!always)) {
                    return;
                }
                if (!always) {
                    send(true);
                }
            });
            m.add(remember);
        }
        return m;
    }

    private boolean setAlways(boolean on) {
        try {
            prefs.setUsesProgram(on);
            return true;
        } catch (Exception e) {
            JOptionPane.showMessageDialog(this, "Your choice wasn't saved: " + e.getMessage(), "Email", JOptionPane.WARNING_MESSAGE);
            return false;
        }
    }

    /** The field's label as a button that opens the address list; the field gets the how-to-type tooltip. */
    private JButton chooser(String label, JTextField field) {
        field.setToolTipText(SEPARATE);
        JButton b = new JButton(label);
        b.setMargin(new Insets(2, 8, 2, 8));
        b.setToolTipText("Pick " + label + " addresses from the customer's or vendor's contacts, or from the Fishbowl users");
        b.addActionListener(e -> {
            List<String> next = AddressPicker.choose(this, label, addresses(), EmailDraft.split(field.getText()));
            if (next != null) {
                field.setText(EmailDraft.join(next));
            }
        });
        return b;
    }

    private List<EmailAddresses.Address> addresses() {
        if (addresses == null) {
            setCursor(Cursor.getPredefinedCursor(Cursor.WAIT_CURSOR));
            try {
                addresses = book == null ? new ArrayList<>() : book.addresses();
            } catch (RuntimeException e) {
                JOptionPane.showMessageDialog(this, "The addresses couldn't be read: " + e.getMessage(), "Email", JOptionPane.WARNING_MESSAGE);
                return new ArrayList<>();
            } finally {
                setCursor(Cursor.getDefaultCursor());
            }
        }
        return addresses;
    }

    private void send(boolean viaProgram) {
        String html = pendingHtml != null ? pendingHtml : String.valueOf(js("Composer.html()"));
        if ("null".equals(html)) {
            JOptionPane.showMessageDialog(this, "The email editor hasn't finished loading.", "Email", JOptionPane.WARNING_MESSAGE);
            return;
        }
        EmailDraft d = new EmailDraft();
        d.to.addAll(EmailDraft.split(to.getText()));
        d.cc.addAll(EmailDraft.split(cc.getText()));
        d.bcc.addAll(EmailDraft.split(bcc.getText()));
        d.subject = subject.getText().trim();
        d.html = html;
        d.attachments.addAll(files);
        if (!viaProgram && d.to.isEmpty() && d.cc.isEmpty() && d.bcc.isEmpty()) {
            JOptionPane.showMessageDialog(this, "Add at least one recipient.", "Email", JOptionPane.WARNING_MESSAGE);
            return;
        }
        send.setEnabled(false);
        program.setEnabled(false);
        new SwingWorker<String, Void>() {
            @Override
            protected String doInBackground() throws Exception {
                if (viaProgram) {
                    return OwnMailProgram.open(d);
                }
                MailSender.send(d);
                return "Sent to " + String.join(", ", recipients(d)) + ".";
            }

            @Override
            protected void done() {
                send.setEnabled(true);
                program.setEnabled(true);
                try {
                    String said = get();
                    dispose();
                    JOptionPane.showMessageDialog(getOwner(), said, "Email", JOptionPane.INFORMATION_MESSAGE);
                } catch (java.util.concurrent.ExecutionException e) {
                    Throwable c = e.getCause() != null ? e.getCause() : e;
                    JOptionPane.showMessageDialog(EmailComposer.this, (viaProgram ? "The email program didn't take it: " : "The email wasn't sent: ")
                        + c.getMessage(), "Email", JOptionPane.ERROR_MESSAGE);
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                }
            }
        }.execute();
    }

    private static List<String> recipients(EmailDraft d) {
        List<String> all = new ArrayList<>(d.to);
        all.addAll(d.cc);
        all.addAll(d.bcc);
        return all;
    }

    private void addFile() {
        JFileChooser fc = new JFileChooser();
        fc.setMultiSelectionEnabled(true);
        if (fc.showOpenDialog(this) == JFileChooser.APPROVE_OPTION) {
            for (File f : fc.getSelectedFiles()) {
                if (!files.contains(f)) {
                    files.add(f);
                }
            }
            renderChips();
        }
    }

    private void renderChips() {
        chips.removeAll();
        if (files.isEmpty()) {
            chips.add(new JLabel("Nothing attached"));
        }
        for (File f : files) {
            JPanel chip = new JPanel(new FlowLayout(FlowLayout.LEFT, 0, 0));
            chip.setBorder(BorderFactory.createLineBorder(new Color(0xC6D0D4)));
            JButton open = new JButton(f.getName());
            open.setBorderPainted(false);
            open.setContentAreaFilled(false);
            open.setToolTipText("Open " + f.getName());
            open.addActionListener(e -> {
                try {
                    Desktop.getDesktop().open(f);
                } catch (Exception ex) {
                    JOptionPane.showMessageDialog(this, "It couldn't be opened: " + ex.getMessage(), "Email", JOptionPane.WARNING_MESSAGE);
                }
            });
            JButton remove = new JButton("×");
            remove.setBorderPainted(false);
            remove.setContentAreaFilled(false);
            remove.setToolTipText("Don't attach " + f.getName());
            remove.addActionListener(e -> {
                files.remove(f);
                renderChips();
            });
            chip.add(open);
            chip.add(remove);
            chips.add(chip);
        }
        chips.revalidate();
        chips.repaint();
    }

    private Object js(String code) {
        try {
            return browser.executeJs(code);
        } catch (RuntimeException e) {
            return null;
        }
    }

    private static void row(JPanel p, int y, String label, Component field) {
        row(p, y, new JLabel(label), field);
    }

    private static void row(JPanel p, int y, Component label, Component field) {
        GridBagConstraints l = new GridBagConstraints();
        l.gridx = 0;
        l.gridy = y;
        l.anchor = GridBagConstraints.WEST;
        l.fill = label instanceof JButton ? GridBagConstraints.HORIZONTAL : GridBagConstraints.NONE;
        l.insets = new Insets(2, 0, 2, 8);
        p.add(label, l);
        GridBagConstraints f = new GridBagConstraints();
        f.gridx = 1;
        f.gridy = y;
        f.weightx = 1;
        f.fill = GridBagConstraints.HORIZONTAL;
        f.insets = new Insets(2, 0, 2, 0);
        p.add(field, f);
    }

    private static String page() {
        try (InputStream in = EmailComposer.class.getResourceAsStream("Composer.htm")) {
            if (in == null) {
                return "<!DOCTYPE html><p>The email editor page is missing from the plugin.</p>";
            }
            ByteArrayOutputStream b = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            for (int n; (n = in.read(buf)) > 0; ) {
                b.write(buf, 0, n);
            }
            return b.toString(StandardCharsets.UTF_8.name());
        } catch (Exception e) {
            return "<!DOCTYPE html><p>The email editor page couldn't be read.</p>";
        }
    }

    /** A JavaScript string literal (also safe inside a script tag). */
    static String jsString(String s) {
        if (s == null) {
            return "null";
        }
        StringBuilder out = new StringBuilder(s.length() + 2).append('"');
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"': out.append("\\\""); break;
                case '\\': out.append("\\\\"); break;
                case '<': out.append("\\x3c"); break;
                case '\n': out.append("\\n"); break;
                case '\r': out.append("\\r"); break;
                case '\t': out.append("\\t"); break;
                default:
                    if (c < 0x20) {
                        out.append(String.format("\\x%02x", (int) c));
                    } else if (c == 0x2028 || c == 0x2029) {
                        out.append('\\').append('u').append(Integer.toHexString(c));   // line separators end a JS string
                    } else {
                        out.append(c);
                    }
            }
        }
        return out.append('"').toString();
    }
}
