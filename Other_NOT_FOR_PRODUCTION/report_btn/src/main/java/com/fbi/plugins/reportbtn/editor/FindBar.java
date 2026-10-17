package com.fbi.plugins.reportbtn.editor;

import org.fife.ui.rsyntaxtextarea.RSyntaxTextArea;
import org.fife.ui.rtextarea.SearchContext;
import org.fife.ui.rtextarea.SearchEngine;
import org.fife.ui.rtextarea.SearchResult;

import javax.swing.AbstractAction;
import javax.swing.BorderFactory;
import javax.swing.JButton;
import javax.swing.JCheckBox;
import javax.swing.JComponent;
import javax.swing.JLabel;
import javax.swing.JOptionPane;
import javax.swing.JPanel;
import javax.swing.JTextField;
import javax.swing.KeyStroke;
import javax.swing.SwingUtilities;
import javax.swing.event.DocumentEvent;
import javax.swing.event.DocumentListener;
import javax.swing.text.BadLocationException;
import java.awt.GridBagConstraints;
import java.awt.GridBagLayout;
import java.awt.Insets;
import java.awt.event.ActionEvent;
import java.awt.event.KeyEvent;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.regex.PatternSyntaxException;

/**
 * Find and replace under the code, on RSTA's SearchEngine (the RSTAUI dialogs aren't
 * in the client). Typing marks every match, in the text and in the error strip
 * beside the scroll bar; the status says which match is selected ("3 of 12").
 */
final class FindBar extends JPanel {

    private final RSyntaxTextArea area;
    private final JTextField find = new JTextField(24);
    private final JTextField replace = new JTextField(24);
    private final JCheckBox matchCase = new JCheckBox("Match case");
    private final JCheckBox whole = new JCheckBox("Whole word");
    private final JCheckBox regex = new JCheckBox("Regex");
    private final JLabel status = new JLabel(" ");

    FindBar(RSyntaxTextArea area) {
        super(new GridBagLayout());
        this.area = area;
        setBorder(BorderFactory.createCompoundBorder(
            BorderFactory.createMatteBorder(1, 0, 0, 0, getBackground().darker()),
            BorderFactory.createEmptyBorder(3, 6, 3, 6)));
        JButton next = small("Next", "Next match (Enter, F3)", () -> find(true));
        JButton prev = small("Previous", "Previous match (Shift+Enter, Shift+F3)", () -> find(false));
        JButton all = small("Find all", "Mark every match, in the text and beside the scroll bar", this::findAll);
        JButton one = small("Replace", "Replace the selected match and find the next (Enter in Replace)", () -> replace(false));
        JButton every = small("Replace all", "Replace every match (Ctrl+Z undoes it)", () -> replace(true));
        JButton close = small("✕", "Close (Esc)", this::close);

        GridBagConstraints c = new GridBagConstraints();
        c.insets = new Insets(1, 2, 1, 2);
        c.anchor = GridBagConstraints.WEST;
        c.gridy = 0;
        add(new JLabel("Find"), c);
        c.fill = GridBagConstraints.HORIZONTAL;
        add(find, c);
        c.fill = GridBagConstraints.NONE;
        add(prev, c);
        add(next, c);
        add(all, c);
        add(matchCase, c);
        add(whole, c);
        add(regex, c);
        c.weightx = 1;
        add(status, c);
        c.weightx = 0;
        add(close, c);
        c.gridy = 1;
        c.gridx = 0;
        add(new JLabel("Replace"), c);
        c.gridx = 1;
        c.fill = GridBagConstraints.HORIZONTAL;
        add(replace, c);
        c.fill = GridBagConstraints.NONE;
        c.gridx = 2;
        add(one, c);
        c.gridx = 3;
        c.gridwidth = 2;
        add(every, c);

        find.addActionListener(e -> find(true));
        replace.addActionListener(e -> replace(false));
        find.getDocument().addDocumentListener(new DocumentListener() {
            public void insertUpdate(DocumentEvent e) { live(); }
            public void removeUpdate(DocumentEvent e) { live(); }
            public void changedUpdate(DocumentEvent e) { live(); }
        });
        for (JCheckBox b : new JCheckBox[] {matchCase, whole, regex}) {
            b.setFocusable(false);
            b.addActionListener(e -> live());
        }
        for (JTextField f : new JTextField[] {find, replace}) {
            key(f, KeyStroke.getKeyStroke(KeyEvent.VK_ESCAPE, 0), this::close);
        }
        key(find, KeyStroke.getKeyStroke(KeyEvent.VK_ENTER, KeyEvent.SHIFT_DOWN_MASK), () -> find(false));
        setVisible(false);
    }

    /** Shows the bar, seeded with the selection; focusReplace puts the caret in Replace (Ctrl+H). */
    void open(boolean focusReplace) {
        String sel = area.getSelectedText();
        if (sel != null && !sel.isEmpty() && !sel.contains("\n")) {
            find.setText(sel);
        }
        setVisible(true);
        revalidate();
        JTextField target = focusReplace && !find.getText().isEmpty() ? replace : find;
        target.requestFocusInWindow();
        target.selectAll();
        live();
    }

    void close() {
        setVisible(false);
        SearchEngine.markAll(area, new SearchContext());
        area.requestFocusInWindow();
    }

    void find(boolean forward) {
        if (find.getText().isEmpty()) {
            if (!isVisible()) {
                open(false);
            }
            return;
        }
        if (!isVisible()) {
            open(false);
        }
        SearchContext c = context();
        c.setSearchForward(forward);
        SearchResult r = SearchEngine.find(area, c);
        if (!r.wasFound()) {
            // Wrap round, as most editors do.
            int keep = area.getCaretPosition();
            area.setCaretPosition(forward ? 0 : area.getDocument().getLength());
            r = SearchEngine.find(area, c);
            if (!r.wasFound()) {
                area.setCaretPosition(keep);
            }
        }
        count(r.wasFound() ? null : "No matches");
    }

    private void findAll() {
        if (find.getText().isEmpty()) {
            find.requestFocusInWindow();
            return;
        }
        SearchResult r = SearchEngine.markAll(area, context());
        int n = r.getMarkedCount();
        status.setText(n == 0 ? "No matches" : n + " match" + (n == 1 ? "" : "es") + ", marked beside the scroll bar");
        if (n > 0 && (area.getSelectedText() == null || area.getSelectedText().isEmpty())) {
            find(true);
            status.setText(n + " match" + (n == 1 ? "" : "es") + ", marked beside the scroll bar");
        }
    }

    private void replace(boolean all) {
        if (find.getText().isEmpty()) {
            find.requestFocusInWindow();
            return;
        }
        SearchContext c = context();
        c.setReplaceWith(replace.getText());
        if (all) {
            SearchResult r = SearchEngine.replaceAll(area, c);
            mark();
            status.setText(r.getCount() == 0 ? "No matches" : r.getCount() + " replaced (Ctrl+Z undoes it)");
            return;
        }
        SearchResult r = SearchEngine.replace(area, c);
        if (!r.wasFound()) {
            int keep = area.getCaretPosition();
            area.setCaretPosition(0);
            r = SearchEngine.replace(area, c);
            if (!r.wasFound()) {
                area.setCaretPosition(keep);
            }
        }
        mark();
        count(r.wasFound() ? null : "No matches");
    }

    /** As the user types: mark everything and say how many. */
    private void live() {
        SwingUtilities.invokeLater(() -> {
            if (!isVisible()) {
                return;
            }
            mark();
            count(null);
        });
    }

    private void mark() {
        SearchEngine.markAll(area, find.getText().isEmpty() ? new SearchContext() : context());
    }

    /** "3 of 12" when the selection is a match, "12 matches" otherwise; override shows instead. */
    private void count(String override) {
        if (override != null) {
            status.setText(override);
            return;
        }
        if (find.getText().isEmpty()) {
            status.setText(" ");
            return;
        }
        List<int[]> hits;
        try {
            hits = matches(area.getText(), find.getText(), matchCase.isSelected(), whole.isSelected(), regex.isSelected());
        } catch (PatternSyntaxException e) {
            status.setText("Invalid regex");
            return;
        }
        if (hits.isEmpty()) {
            status.setText("No matches");
            return;
        }
        int s = area.getSelectionStart(), e = area.getSelectionEnd();
        for (int i = 0; i < hits.size(); i++) {
            if (hits.get(i)[0] == s && hits.get(i)[1] == e) {
                status.setText((i + 1) + " of " + hits.size());
                return;
            }
        }
        status.setText(hits.size() + " match" + (hits.size() == 1 ? "" : "es"));
    }

    /** Every match as [start, end]: the same rules as the SearchContext. Pure, for EditorSelfCheck. */
    static List<int[]> matches(String text, String what, boolean matchCase, boolean wholeWord, boolean isRegex) {
        List<int[]> out = new ArrayList<>();
        if (what == null || what.isEmpty() || text == null) {
            return out;
        }
        String p = isRegex ? what : Pattern.quote(what);
        if (wholeWord) {
            p = "(?<![\\w$])" + p + "(?![\\w$])";
        }
        Matcher m = Pattern.compile(p, matchCase ? 0 : Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CASE).matcher(text);
        while (m.find()) {
            if (m.end() == m.start()) {
                if (m.end() >= text.length()) {
                    break;
                }
                continue;   // an empty match finds nothing to select
            }
            out.add(new int[] {m.start(), m.end()});
        }
        return out;
    }

    private SearchContext context() {
        SearchContext c = new SearchContext(find.getText());
        c.setMatchCase(matchCase.isSelected());
        c.setRegularExpression(regex.isSelected());
        c.setWholeWord(whole.isSelected());
        c.setMarkAll(true);
        return c;
    }

    /** Ctrl+G: go to a line. */
    static void goToLine(RSyntaxTextArea area) {
        String s = JOptionPane.showInputDialog(area, "Line number (1-" + area.getLineCount() + "):", "Go to line",
            JOptionPane.PLAIN_MESSAGE);
        if (s == null) {
            return;
        }
        try {
            int line = Math.max(1, Math.min(area.getLineCount(), Integer.parseInt(s.trim())));
            area.setCaretPosition(area.getLineStartOffset(line - 1));
            area.requestFocusInWindow();
        } catch (NumberFormatException | BadLocationException ignored) {
            // not a line
        }
    }

    private static JButton small(String text, String tip, Runnable r) {
        JButton b = new JButton(text);
        b.setToolTipText(tip);
        b.setFocusable(false);
        b.setMargin(new Insets(1, 6, 1, 6));
        b.addActionListener(e -> r.run());
        return b;
    }

    private static void key(JComponent c, KeyStroke k, Runnable r) {
        String name = "fb." + k;
        c.getInputMap().put(k, name);
        c.getActionMap().put(name, new AbstractAction() {
            @Override
            public void actionPerformed(ActionEvent e) {
                r.run();
            }
        });
    }
}
