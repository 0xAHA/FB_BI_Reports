package com.fbi.plugins.reportbtn.editor;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * A JSDoc comment (already stripped of its comment markers by JsIndex), split into
 * its summary, @param, @returns and @example parts for the insert panel and the
 * autocomplete popup. Text with no tags renders as before: plain lines.
 */
final class JsDoc {

    static final class Param {
        final String name;
        final String type;
        final String description;
        final boolean optional;
        final String defaultValue;

        Param(String name, String type, String description, boolean optional, String defaultValue) {
            this.name = name;
            this.type = type;
            this.description = description;
            this.optional = optional;
            this.defaultValue = defaultValue;
        }
    }

    /** "{type} [name=default] - text" or "{type} name text". */
    private static final Pattern PARAM = Pattern.compile(
        "^(?:\\{([^}]*)\\}\\s*)?(\\[[^\\]]*\\]|[A-Za-z_$][\\w$.\\[\\]]*)\\s*(?:-\\s*)?([\\s\\S]*)$");
    private static final Pattern RETURNS = Pattern.compile("^(?:\\{([^}]*)\\}\\s*)?(?:-\\s*)?([\\s\\S]*)$");
    private static final Pattern TAG = Pattern.compile("^@([A-Za-z]+)\\b\\s?(.*)$");

    final String summary;
    final List<Param> params = new ArrayList<>();
    String returnsType = "";
    String returns = "";
    boolean hasReturns;
    final List<String> examples = new ArrayList<>();
    /** Other tags, as "tag text" (async, deprecated, see, throws, ...). */
    final List<String> notes = new ArrayList<>();

    private JsDoc(String summary) {
        this.summary = summary;
    }

    /** True when the text uses JSDoc tags at all. */
    static boolean tagged(String doc) {
        return doc != null && Pattern.compile("(?m)^\\s*@[A-Za-z]+").matcher(doc).find();
    }

    static JsDoc parse(String doc) {
        String text = doc == null ? "" : doc.replace("\r", "");
        List<String> blocks = new ArrayList<>();   // "@tag rest" with continuation lines
        StringBuilder summary = new StringBuilder();
        StringBuilder cur = null;
        for (String line : text.split("\n", -1)) {
            String trimmed = line.trim();
            if (TAG.matcher(trimmed).matches()) {
                if (cur != null) {
                    blocks.add(cur.toString());
                }
                cur = new StringBuilder(trimmed);
            } else if (cur != null) {
                cur.append('\n').append(line);
            } else {
                summary.append(line).append('\n');
            }
        }
        if (cur != null) {
            blocks.add(cur.toString());
        }
        JsDoc d = new JsDoc(summary.toString().trim());
        for (String b : blocks) {
            Matcher t = TAG.matcher(b.split("\n", 2)[0]);
            if (!t.matches()) {
                continue;
            }
            String tag = t.group(1).toLowerCase(Locale.ROOT);
            String rest = t.group(2) + (b.contains("\n") ? "\n" + b.split("\n", 2)[1] : "");
            switch (tag) {
                case "param":
                case "arg":
                case "argument":
                    d.param(rest.trim());
                    break;
                case "returns":
                case "return":
                    Matcher r = RETURNS.matcher(rest.trim());
                    d.hasReturns = true;
                    if (r.matches()) {
                        d.returnsType = nz(r.group(1)).trim();
                        d.returns = oneLine(r.group(2));
                    }
                    break;
                case "example":
                    d.examples.add(dedent(rest));
                    break;
                default:
                    d.notes.add(tag + (rest.trim().isEmpty() ? "" : " " + oneLine(rest)));
                    break;
            }
        }
        return d;
    }

    private void param(String rest) {
        Matcher m = PARAM.matcher(rest);
        if (!m.matches()) {
            return;
        }
        String name = m.group(2);
        boolean optional = false;
        String def = "";
        if (name.startsWith("[") && name.endsWith("]")) {
            optional = true;
            name = name.substring(1, name.length() - 1).trim();
            int eq = name.indexOf('=');
            if (eq >= 0) {
                def = name.substring(eq + 1).trim();
                name = name.substring(0, eq).trim();
            }
        }
        String type = nz(m.group(1)).trim();
        if (type.startsWith("=") || type.endsWith("=")) {
            optional = true;   // Closure style {number=}
            type = type.replace("=", "");
        }
        params.add(new Param(name, type, oneLine(m.group(3)), optional, def));
    }

    /** The documented parameter for name (top level only), or null. */
    Param paramNamed(String name) {
        for (Param p : params) {
            if (p.name.equals(name)) {
                return p;
            }
        }
        return null;
    }

    /** The summary's first sentence: for a one-line hint. */
    String firstSentence() {
        String s = oneLine(summary);
        Matcher m = Pattern.compile("^(.*?[.!?])(\\s|$)").matcher(s);
        return m.find() ? m.group(1) : s;
    }

    String html() {
        StringBuilder b = new StringBuilder();
        if (!summary.isEmpty()) {
            b.append(paragraphs(summary));
        }
        if (!params.isEmpty()) {
            b.append("<br><br><b>Parameters</b>");
            for (Param p : params) {
                boolean nested = p.name.contains(".");
                b.append("<br>").append(nested ? "&nbsp;&nbsp;&nbsp;&nbsp;" : "")
                    .append("<code>").append(Completions.esc(p.name)).append("</code>");
                if (!p.type.isEmpty()) {
                    b.append(" <font color='#7a7a7a'>").append(Completions.esc(p.type)).append("</font>");
                }
                if (p.optional) {
                    b.append(" <i>optional").append(p.defaultValue.isEmpty() ? "" : ", default "
                        + Completions.esc(p.defaultValue)).append("</i>");
                }
                if (!p.description.isEmpty()) {
                    b.append(" &mdash; ").append(Completions.esc(p.description));
                }
            }
        }
        if (hasReturns) {
            b.append("<br><br><b>Returns</b> ");
            if (!returnsType.isEmpty()) {
                b.append("<font color='#7a7a7a'>").append(Completions.esc(returnsType)).append("</font> ");
            }
            b.append(Completions.esc(returns));
        }
        for (String n : notes) {
            b.append("<br><br><i>@").append(Completions.esc(n)).append("</i>");
        }
        for (String e : examples) {
            b.append("<br><br><b>Example</b><pre style='margin:2px 0'>").append(Completions.esc(e)).append("</pre>");
        }
        return b.toString();
    }

    /** Blank lines split paragraphs; other line breaks are soft. */
    private static String paragraphs(String text) {
        StringBuilder b = new StringBuilder();
        for (String p : text.trim().split("\n\\s*\n")) {
            if (b.length() > 0) {
                b.append("<br><br>");
            }
            b.append(Completions.esc(oneLine(p)));
        }
        return b.toString();
    }

    private static String oneLine(String s) {
        return s == null ? "" : s.trim().replaceAll("\\s*\n\\s*", " ");
    }

    /** An example's lines, with their common indentation removed. */
    private static String dedent(String s) {
        String[] lines = s.replace("\t", "    ").split("\n", -1);
        int min = Integer.MAX_VALUE;
        for (String l : lines) {
            if (!l.trim().isEmpty()) {
                int i = 0;
                while (i < l.length() && l.charAt(i) == ' ') {
                    i++;
                }
                min = Math.min(min, i);
            }
        }
        StringBuilder b = new StringBuilder();
        for (String l : lines) {
            b.append(l.trim().isEmpty() ? "" : l.substring(Math.min(min, l.length()))).append('\n');
        }
        return b.toString().replaceAll("^\n+|\\s+$", "");
    }

    private static String nz(String s) {
        return s == null ? "" : s;
    }
}
