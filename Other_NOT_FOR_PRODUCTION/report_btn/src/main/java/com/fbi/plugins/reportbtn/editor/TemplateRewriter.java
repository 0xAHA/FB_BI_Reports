package com.fbi.plugins.reportbtn.editor;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Turns a template page into a new report's first draft: its identity block
 * (key, name, an unstamped build), <title>, module tag, description and banner;
 * and an app into a copy of itself (copyOf). Either result is a custom app, since
 * only Fishbowl ships system apps. Pure, so SelfCheck runs it over the real
 * Template/Core_Dashboard_Template.htm.
 */
final class TemplateRewriter {

    static final class Result {
        final String text;
        final List<String> applied = new ArrayList<>();
        final List<String> missed = new ArrayList<>();

        Result(String text) {
            this.text = text;
        }
    }

    private static final Pattern IDENTITY = Pattern.compile("(window\\.FB_REPORT\\s*=\\s*\\{)([\\s\\S]*?)(\\};)");
    // [^<]*: prose that merely mentions <title> (the template's own header comment) can't start a match.
    private static final Pattern TITLE = Pattern.compile("(<title>)([^<]*)(</title>)", Pattern.CASE_INSENSITIVE);
    private static final Pattern LAUNCH = Pattern.compile("(<meta name=\"fb-launch\" content=\")([^\"]*)(\">)");
    private static final Pattern DESC = Pattern.compile("(<meta name=\"description\" content=\")([^\"]*)(\">)");
    private static final Pattern CHARSET = Pattern.compile("^([ \\t]*)<meta charset[^>]*>[^\\r\\n]*$",
        Pattern.MULTILINE | Pattern.CASE_INSENSITIVE);
    private static final Pattern FILE_LINE = Pattern.compile("(?m)^(\\s*FILE:\\s*)(.*)$");

    private TemplateRewriter() {
    }

    static Result rewrite(String template, String name, String description, String launchTag) {
        String text = template;
        List<String> applied = new ArrayList<>(), missed = new ArrayList<>();

        String key = storageKey(name);
        String renamed = identity(text, name, key);
        if (renamed != null) {
            text = renamed;
            applied.add("identity (key " + key + ")");
        } else {
            missed.add("identity block");
        }

        String eol = text.contains("\r\n") ? "\r\n" : "\n";
        text = replaceOrInsert(text, LAUNCH, launchTag, "<meta name=\"fb-launch\" content=\"" + attr(launchTag) + "\">",
            eol, applied, missed, "module tag");
        text = replaceOrInsert(text, DESC, description, "<meta name=\"description\" content=\"" + attr(description) + "\">",
            eol, applied, missed, "description");

        Matcher m = TITLE.matcher(text);
        if (m.find()) {
            text = text.substring(0, m.start(2)) + html(name) + text.substring(m.end(2));
            applied.add("title");
        } else {
            missed.add("title");
        }
        m = FILE_LINE.matcher(text);
        if (m.find()) {
            text = text.substring(0, m.start(2)) + name + text.substring(m.end(2));
            applied.add("banner FILE line");
        }
        if (AppGroups.isSystem(text)) {
            text = AppGroups.setOrigin(text, AppGroups.CUSTOM);   // a system app used as a template
            applied.add("custom origin");
        }
        Result r = new Result(text);
        r.applied.addAll(applied);
        r.missed.addAll(missed);
        return r;
    }

    /**
     * A copy of an app under a new name: its identity block (that name, a storage key of
     * its own, an unstamped build), <title> and banner FILE line, and a custom origin.
     * Its folder, Apps menus and description stay.
     */
    static String copyOf(String page, String name) {
        String text = page == null ? "" : page;
        Matcher m = IDENTITY.matcher(text);
        if (m.find()) {
            Matcher k = KEY.matcher(m.group(2));
            String old = k.find() && k.group(2) != null ? k.group(2) : "";
            String key = storageKey(name);
            if (key.equals(old)) {
                key = key.substring(0, Math.min(key.length(), 27)) + "Copy";   // both names cut to the same 31 characters
            }
            text = identity(text, name, key);
        }
        m = TITLE.matcher(text);
        if (m.find()) {
            text = text.substring(0, m.start(2)) + html(name) + text.substring(m.end(2));
        }
        m = FILE_LINE.matcher(text);
        if (m.find()) {
            text = text.substring(0, m.start(2)) + name + text.substring(m.end(2));
        }
        return AppGroups.isSystem(text) ? AppGroups.setOrigin(text, AppGroups.CUSTOM) : text;
    }

    private static final Pattern KEY = Pattern.compile("\\bkey:\\s*(null|'((?:[^'\\\\]|\\\\.)*)')");

    /** The page with its identity block's key, name and build set; null when it has none. */
    private static String identity(String text, String name, String key) {
        Matcher m = IDENTITY.matcher(text);
        if (!m.find()) {
            return null;
        }
        String body = m.group(2);
        body = body.replaceFirst("(\\bkey:\\s*)(null|'(?:[^'\\\\]|\\\\.)*')", "$1'" + Matcher.quoteReplacement(key) + "'");
        body = body.replaceFirst("(\\bname:\\s*)(null|'(?:[^'\\\\]|\\\\.)*')",
            "$1'" + Matcher.quoteReplacement(name.replace("\\", "\\\\").replace("'", "\\'")) + "'");
        body = body.replaceFirst("(\\bbuild:\\s*)'[^']*'", "$1'UNSTAMPED'");
        return text.substring(0, m.start(2)) + body + text.substring(m.end(2));
    }

    private static String replaceOrInsert(String text, Pattern p, String value, String fresh, String eol,
                                          List<String> applied, List<String> missed, String what) {
        Matcher m = p.matcher(text);
        if (m.find()) {
            applied.add(what);
            return text.substring(0, m.start(2)) + attr(value) + text.substring(m.end(2));
        }
        Matcher c = CHARSET.matcher(text);
        if (c.find()) {
            applied.add(what + " (added)");
            return text.substring(0, c.end()) + eol + c.group(1) + fresh + text.substring(c.end());
        }
        missed.add(what);
        return text;
    }

    /** cdx.bi.<camelCaseName>, at most 31 characters (userproperties.userKey is varchar(41)). */
    static String storageKey(String name) {
        StringBuilder camel = new StringBuilder();
        boolean upper = false;
        for (char c : name.trim().toCharArray()) {
            if (Character.isLetterOrDigit(c) && c < 128) {
                camel.append(camel.length() == 0 ? Character.toLowerCase(c) : upper ? Character.toUpperCase(c) : c);
                upper = false;
            } else {
                upper = true;
            }
        }
        String key = "cdx.bi." + (camel.length() == 0 ? "report" : camel);
        return key.length() > 31 ? key.substring(0, 31) : key;
    }

    private static String attr(String s) {
        return s == null ? "" : s.replace("&", "&amp;").replace("\"", "&quot;").replace("<", "&lt;");
    }

    private static String html(String s) {
        return s == null ? "" : s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;");
    }

    /** True for a module tag of letters, digits, _ and separators (what fb-launch accepts). */
    static boolean validTag(String tag) {
        return tag != null && tag.toUpperCase(Locale.ROOT).matches("[A-Z][A-Z0-9_]*([ ,]+[A-Z][A-Z0-9_]*)*");
    }
}
