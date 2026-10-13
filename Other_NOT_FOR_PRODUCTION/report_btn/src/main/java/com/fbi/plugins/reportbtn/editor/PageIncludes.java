package com.fbi.plugins.reportbtn.editor;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * The include directives in a page, and its report-setting tokens. Fishbowl
 * replaces EVERY occurrence of a directive (comments, strings and prose included)
 * with the saved record, so each should appear once.
 */
final class PageIncludes {

    /** One directive: its type (Script, Style, Template, Image) and include name. */
    static final class Include {
        final String type;
        final String name;
        final int start;
        final int end;
        /** Inside a <script type="text/plain"> holder: an optional library kept inert. */
        final boolean holder;
        boolean duplicate;

        Include(String type, String name, int start, int end, boolean holder) {
            this.type = type;
            this.name = name;
            this.start = start;
            this.end = end;
            this.holder = holder;
        }

        String key() {
            return type.toLowerCase(Locale.ROOT) + ":" + name.toLowerCase(Locale.ROOT);
        }
    }

    // BiScriptTypeConst.getRegex(): \{% (types) \S* %} — the name has no spaces.
    private static final Pattern DIRECTIVE = Pattern.compile("\\{% (Template|Script|Style|Image) (\\S*) %\\}");
    private static final Pattern SCRIPT_OPEN = Pattern.compile("<script\\b[^>]*>", Pattern.CASE_INSENSITIVE);

    private PageIncludes() {
    }

    static List<Include> find(String page) {
        List<Include> out = new ArrayList<>();
        if (page == null) {
            return out;
        }
        Map<String, Integer> seen = new HashMap<>();
        Matcher m = DIRECTIVE.matcher(page);
        while (m.find()) {
            Include inc = new Include(m.group(1), m.group(2), m.start(), m.end(), inHolder(page, m.start()));
            Integer count = seen.merge(inc.key(), 1, Integer::sum);
            if (count > 1) {
                inc.duplicate = true;
                for (Include prev : out) {
                    if (prev.key().equals(inc.key())) {
                        prev.duplicate = true;
                    }
                }
            }
            out.add(inc);
        }
        return out;
    }

    /** True when an include of this type and name is already in the page. */
    static boolean contains(String page, String type, String includeName) {
        for (Include inc : find(page)) {
            if (inc.type.equalsIgnoreCase(type) && inc.name.equalsIgnoreCase(includeName)) {
                return true;
            }
        }
        return false;
    }

    /** The name a directive uses for a record: spaces become underscores (BiScriptSearch.getIncludeName). */
    static String includeName(String recordName) {
        return recordName == null ? "" : recordName.trim().replace(' ', '_');
    }

    private static boolean inHolder(String page, int at) {
        String before = page.substring(0, at);
        int open = -1;
        Matcher m = SCRIPT_OPEN.matcher(before);
        String tag = null;
        while (m.find()) {
            open = m.start();
            tag = m.group();
        }
        if (open < 0) {
            return false;
        }
        int close = before.toLowerCase(Locale.ROOT).lastIndexOf("</script");
        return close < open && tag.toLowerCase(Locale.ROOT).matches("(?s).*\\btype\\s*=\\s*[\"']text/plain[\"'].*");
    }

    /** Setting tokens ($SO{...}, $CHECK{...}) by their full text, with how often each appears. */
    static Map<String, Integer> settingTokens(String page, String tokenRegex) {
        Map<String, Integer> out = new java.util.LinkedHashMap<>();
        if (page == null || tokenRegex == null) {
            return out;
        }
        Matcher m = Pattern.compile(tokenRegex).matcher(page);
        while (m.find()) {
            out.merge(m.group(), 1, Integer::sum);
        }
        return out;
    }
}
