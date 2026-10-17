package com.fbi.plugins.reportbtn.editor;

import org.fife.ui.autocomplete.AutoCompletion;
import org.fife.ui.autocomplete.BasicCompletion;
import org.fife.ui.autocomplete.Completion;
import org.fife.ui.autocomplete.DefaultCompletionProvider;
import org.fife.ui.autocomplete.FunctionCompletion;
import org.fife.ui.autocomplete.ParameterizedCompletion;

import javax.swing.KeyStroke;
import javax.swing.text.JTextComponent;
import java.awt.event.InputEvent;
import java.awt.event.KeyEvent;
import java.util.ArrayList;
import java.util.List;

/**
 * Autocomplete for the Fishbowl bridge functions and the functions of the modules
 * the page includes: Ctrl+Space, or on its own after a dot. Completions are full
 * paths (FBLib.Common.formatMoney), so the dot counts as part of a word.
 */
final class Completions {

    /** Treats '.' as part of the word being completed. */
    private static final class DottedProvider extends DefaultCompletionProvider {
        @Override
        protected boolean isValidChar(char ch) {
            return super.isValidChar(ch) || ch == '.';
        }
    }

    private final DottedProvider provider = new DottedProvider();
    private final AutoCompletion auto;

    Completions(JTextComponent area) {
        provider.setAutoActivationRules(false, ".");
        auto = new AutoCompletion(provider);
        auto.setShowDescWindow(true);
        auto.setParameterAssistanceEnabled(true);
        auto.setAutoActivationEnabled(true);
        auto.setAutoActivationDelay(300);
        auto.setAutoCompleteSingleChoices(false);
        auto.setTriggerKey(KeyStroke.getKeyStroke(KeyEvent.VK_SPACE, InputEvent.CTRL_DOWN_MASK));
        auto.install(area);
        update(new ArrayList<>());
    }

    /** Replaces the completions with the bridge plus these modules' exports. */
    void update(List<JsIndex.Module> modules) {
        List<Completion> list = new ArrayList<>();
        for (Bridge.Fn f : Bridge.all()) {
            FunctionCompletion c = new FunctionCompletion(provider, f.name, "");
            c.setParams(params(f.params, null));
            c.setShortDescription("Fishbowl");
            c.setSummary(html(f.call(), f.doc, "Fishbowl bridge function"));
            list.add(c);
        }
        for (JsIndex.Module m : modules) {
            for (JsIndex.Symbol s : m.all()) {
                if (s.path == null) {
                    continue;
                }
                if (s.kind == JsIndex.Kind.FUNCTION) {
                    FunctionCompletion c = new FunctionCompletion(provider, s.path, "");
                    c.setParams(params(s.params, JsDoc.tagged(s.doc) ? JsDoc.parse(s.doc) : null));
                    c.setShortDescription(m.scriptName);
                    c.setSummary(html(s.signature(), s.doc, m.scriptName + (s.line > 0 ? ", line " + s.line : "")));
                    list.add(c);
                } else {
                    BasicCompletion c = new BasicCompletion(provider, s.path,
                        s.kind == JsIndex.Kind.NAMESPACE ? "namespace" : s.kind == JsIndex.Kind.GETTER ? "getter" : "value",
                        html(s.path, s.doc, m.scriptName));
                    list.add(c);
                }
            }
        }
        provider.clear();
        try {
            provider.addCompletions(firstOfEachName(list));
        } catch (RuntimeException e) {
            // Autocomplete is a help, not a reason the app can't open.
            provider.clear();
            System.out.println("[report_btn] Editor completions skipped: " + e);
        }
    }

    /**
     * One completion per name (case-insensitive), the first kept: the bridge, then the modules in
     * include order. The provider sorts its list, and a function and a plain completion of the same
     * name compare inconsistently ("Comparison method violates its general contract").
     */
    static List<Completion> firstOfEachName(List<Completion> list) {
        java.util.Set<String> seen = new java.util.HashSet<>();
        List<Completion> out = new ArrayList<>();
        for (Completion c : list) {
            String key = c.getInputText() == null ? "" : c.getInputText().toLowerCase(java.util.Locale.ROOT);
            if (seen.add(key)) {
                out.add(c);
            }
        }
        return out;
    }

    void dispose() {
        auto.uninstall();
    }

    /** The declared parameters, with type and description from the JSDoc where it names them. */
    private static List<ParameterizedCompletion.Parameter> params(String params, JsDoc doc) {
        List<ParameterizedCompletion.Parameter> out = new ArrayList<>();
        if (params != null && !params.trim().isEmpty()) {
            for (String p : params.split(",(?![^{\\[]*[}\\]])")) {
                String name = p.trim();
                String bare = name.replaceFirst("\\s*=.*$", "").replaceFirst("^\\.\\.\\.", "");
                JsDoc.Param d = doc == null ? null : doc.paramNamed(bare);
                ParameterizedCompletion.Parameter param = new ParameterizedCompletion.Parameter(
                    d == null || d.type.isEmpty() ? null : d.type, name);
                if (d != null && !d.description.isEmpty()) {
                    param.setDescription(d.description);
                }
                out.add(param);
            }
        }
        return out;
    }

    /** The title, the doc (JSDoc tags laid out; other text line by line) and where it comes from. */
    static String html(String title, String doc, String source) {
        String body = doc == null || doc.isEmpty() ? ""
            : "<br><br>" + (JsDoc.tagged(doc) ? JsDoc.parse(doc).html() : esc(doc).replace("\n", "<br>"));
        return "<b>" + esc(title) + "</b>" + body + "<br><br><i>" + esc(source) + "</i>";
    }

    static String esc(String s) {
        return s == null ? "" : s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;");
    }
}
