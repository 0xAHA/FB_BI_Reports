package com.fbi.plugins.reportbtn.editor;

import com.fbi.sdk.constants.bi.QueryParamTypeConst;

import java.util.Locale;

/** The text each insert puts at the caret. Pure, so SelfCheck can hold it to the native editor's output. */
final class Inserts {

    private Inserts() {
    }

    /** The include directive the native editor writes: "{% Script fb-lib %}". */
    static String directive(String type, String recordName) {
        return "{% " + type + " " + PageIncludes.includeName(recordName) + " %}";
    }

    /**
     * The directive, wrapped in its own script / style block when the caret isn't
     * already inside one, as every report in the repo writes it.
     */
    static String include(String type, String recordName, String textBeforeCaret, String eol) {
        String d = directive(type, recordName);
        if ("Script".equals(type) && !inside(textBeforeCaret, "script")) {
            return "<script>" + eol + d + eol + "</script>";
        }
        if ("Style".equals(type) && !inside(textBeforeCaret, "style")) {
            return "<style>" + eol + d + eol + "</style>";
        }
        return d;
    }

    /** True when the last <tag ...> before the caret has not been closed yet. */
    static boolean inside(String before, String tag) {
        if (before == null) {
            return false;
        }
        String lower = before.toLowerCase(Locale.ROOT);
        int open = Math.max(lower.lastIndexOf("<" + tag + ">"), lower.lastIndexOf("<" + tag + " "));
        int close = lower.lastIndexOf("</" + tag);
        return open >= 0 && open > close;
    }

    /** A report-setting token, exactly as the native Include Setting dialog builds it. */
    static String setting(QueryParamTypeConst type, String title, String defaultValue, String tab, boolean required) {
        return type.buildCode(title, defaultValue, tab, required);
    }

    /** CHECK, TEXT and RANGE settings can't be marked required (as in the native dialog). */
    static boolean canBeRequired(QueryParamTypeConst type) {
        return type != QueryParamTypeConst.CHECK_BOX && type != QueryParamTypeConst.STRING
            && type != QueryParamTypeConst.DATE_RANGE;
    }

    /** A token kept out of the page's code: Fishbowl still substitutes it, and the page reads the element's text. */
    static String settingHolder(String token, String title, String eol) {
        String slug = title == null ? "setting" : title.trim().toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9]+", "-")
            .replaceAll("^-+|-+$", "");
        return "<script type=\"text/plain\" id=\"set-" + (slug.isEmpty() ? "setting" : slug) + "\">" + token + "</script>";
    }

    /** What inserting a module symbol writes: a call for a function, else the path. */
    static String call(JsIndex.Symbol s) {
        return s.kind == JsIndex.Kind.FUNCTION ? s.path + "(" + s.params + ")" : s.path;
    }
}
