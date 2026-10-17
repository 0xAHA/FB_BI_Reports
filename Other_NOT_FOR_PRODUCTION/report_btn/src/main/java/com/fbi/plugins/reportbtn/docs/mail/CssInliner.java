package com.fbi.plugins.reportbtn.docs.mail;

import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.jsoup.nodes.Element;
import org.jsoup.select.Elements;

import java.util.ArrayList;
import java.util.IdentityHashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Copies a document's style-sheet rules onto its elements' style attributes, so a
 * template keeps its look in mail programs that drop or ignore head styles (Gmail
 * on some devices, Outlook for Windows). The style blocks stay as well, for the
 * programs that read them.
 *
 * Rules apply in CSS order: lower specificity first, later rules over earlier ones,
 * !important over the rest, and an element's own style attribute last. Selectors
 * with pseudo-classes (:hover …) or a bare * are left to the style block, and so is
 * everything inside @media and other at-rules.
 */
public final class CssInliner {

    private static final Pattern RULE = Pattern.compile("([^{}]+)\\{([^{}]*)\\}");
    private static final Pattern IDS = Pattern.compile("#[\\w-]+");
    private static final Pattern CLASSES = Pattern.compile("\\.[\\w-]+|\\[[^\\]]*\\]");
    private static final Pattern TAGS = Pattern.compile("(?:^|[\\s>+~])([a-zA-Z][\\w-]*)");

    private static final class Decl {
        final String property, value;
        final boolean important;

        Decl(String property, String value, boolean important) {
            this.property = property;
            this.value = value;
            this.important = important;
        }
    }

    private static final class Rule {
        final String selector;
        final int specificity, order;
        final List<Decl> decls;

        Rule(String selector, int specificity, int order, List<Decl> decls) {
            this.selector = selector;
            this.specificity = specificity;
            this.order = order;
            this.decls = decls;
        }
    }

    private CssInliner() {
    }

    public static String inline(String html) {
        if (html == null || html.trim().isEmpty()) {
            return html == null ? "" : html;
        }
        Document doc = Jsoup.parse(html);
        doc.outputSettings().prettyPrint(false);
        List<Rule> rules = new ArrayList<>();
        int order = 0;
        for (Element style : doc.select("style")) {
            String css = withoutAtBlocks(style.data().replaceAll("(?s)/\\*.*?\\*/", ""));
            Matcher m = RULE.matcher(css);
            while (m.find()) {
                List<Decl> decls = declarations(m.group(2));
                if (decls.isEmpty()) {
                    continue;
                }
                for (String sel : m.group(1).split(",")) {
                    String s = sel.trim();
                    if (s.isEmpty() || s.contains(":") || s.contains("*") || s.startsWith("@")) {
                        continue;
                    }
                    rules.add(new Rule(s, specificity(s), order++, decls));
                }
            }
        }
        if (rules.isEmpty()) {
            return doc.outerHtml();
        }
        rules.sort((a, b) -> a.specificity != b.specificity ? Integer.compare(a.specificity, b.specificity)
            : Integer.compare(a.order, b.order));

        Map<Element, Map<String, Decl>> applied = new IdentityHashMap<>();
        for (Rule r : rules) {
            Elements targets;
            try {
                targets = doc.select(r.selector);
            } catch (RuntimeException e) {
                continue;   // a selector jsoup can't read stays in the style block only
            }
            for (Element el : targets) {
                if (inHead(el)) {
                    continue;
                }
                Map<String, Decl> props = applied.computeIfAbsent(el, k -> new LinkedHashMap<>());
                for (Decl d : r.decls) {
                    Decl had = props.get(d.property);
                    if (had != null && had.important && !d.important) {
                        continue;
                    }
                    props.remove(d.property);   // keep the winning value in the later position
                    props.put(d.property, d);
                }
            }
        }
        for (Map.Entry<Element, Map<String, Decl>> e : applied.entrySet()) {
            Element el = e.getKey();
            Map<String, Decl> props = e.getValue();
            for (Decl own : declarations(el.attr("style"))) {
                Decl had = props.get(own.property);
                if (had != null && had.important && !own.important) {
                    continue;
                }
                props.remove(own.property);
                props.put(own.property, own);
            }
            StringBuilder s = new StringBuilder();
            for (Decl d : props.values()) {
                if (s.length() > 0) {
                    s.append(' ');
                }
                s.append(d.property).append(": ").append(d.value).append(d.important ? " !important" : "").append(';');
            }
            el.attr("style", s.toString());
        }
        return doc.outerHtml();
    }

    /** (ids, classes and attributes, element names) packed into one number. */
    static int specificity(String selector) {
        return count(IDS, selector) * 10000 + count(CLASSES, selector) * 100 + count(TAGS, selector);
    }

    /** "a: b; c: url(x;y) !important" into declarations, split only outside quotes and brackets. */
    static List<Decl> declarations(String block) {
        List<Decl> out = new ArrayList<>();
        if (block == null) {
            return out;
        }
        int depth = 0, start = 0;
        char quote = 0;
        for (int i = 0; i <= block.length(); i++) {
            char c = i < block.length() ? block.charAt(i) : ';';
            if (quote != 0) {
                if (c == quote) {
                    quote = 0;
                }
            } else if (c == '"' || c == '\'') {
                quote = c;
            } else if (c == '(') {
                depth++;
            } else if (c == ')') {
                depth = Math.max(0, depth - 1);
            } else if (c == ';' && depth == 0) {
                String d = block.substring(start, Math.min(i, block.length())).trim();
                start = i + 1;
                int colon = d.indexOf(':');
                if (colon > 0) {
                    String prop = d.substring(0, colon).trim().toLowerCase();
                    String val = d.substring(colon + 1).trim();
                    boolean important = val.toLowerCase().endsWith("!important");
                    if (important) {
                        val = val.substring(0, val.length() - "!important".length()).trim();
                    }
                    if (!prop.isEmpty() && !val.isEmpty()) {
                        out.add(new Decl(prop, val, important));
                    }
                }
            }
        }
        return out;
    }

    /** The CSS with @media, @font-face and other block at-rules taken out (they stay in the style block). */
    static String withoutAtBlocks(String css) {
        StringBuilder out = new StringBuilder();
        int i = 0;
        while (i < css.length()) {
            int at = css.indexOf('@', i);
            if (at < 0) {
                out.append(css, i, css.length());
                break;
            }
            out.append(css, i, at);
            int brace = css.indexOf('{', at), semi = css.indexOf(';', at);
            if (semi >= 0 && (brace < 0 || semi < brace)) {
                i = semi + 1;   // @import …; and the like
                continue;
            }
            if (brace < 0) {
                break;
            }
            int depth = 0, j = brace;
            for (; j < css.length(); j++) {
                if (css.charAt(j) == '{') {
                    depth++;
                } else if (css.charAt(j) == '}' && --depth == 0) {
                    break;
                }
            }
            i = j + 1;
        }
        return out.toString();
    }

    private static boolean inHead(Element el) {
        for (Element p = el; p != null; p = p.parent()) {
            if ("head".equals(p.normalName())) {
                return true;
            }
        }
        return false;
    }

    private static int count(Pattern p, String s) {
        Matcher m = p.matcher(s);
        int n = 0;
        while (m.find()) {
            n++;
        }
        return n;
    }
}
