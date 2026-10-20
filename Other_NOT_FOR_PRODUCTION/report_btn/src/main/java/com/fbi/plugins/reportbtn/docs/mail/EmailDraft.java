package com.fbi.plugins.reportbtn.docs.mail;

import java.io.File;
import java.util.ArrayList;
import java.util.List;

/** One email being written: who it goes to, what it says, and what it carries. */
public final class EmailDraft {

    public final List<String> to = new ArrayList<>();
    public final List<String> cc = new ArrayList<>();
    public final List<String> bcc = new ArrayList<>();
    public String subject = "";
    /** The body as a whole HTML document (a plain-text template is converted). */
    public String html = "";
    public final List<File> attachments = new ArrayList<>();

    /**
     * A comma / semicolon separated list of addresses, blanks dropped. A separator inside
     * a quoted name or between &lt; and &gt; doesn't split ("Smith, Jo" &lt;jo@x.com&gt;).
     */
    public static List<String> split(String addresses) {
        List<String> out = new ArrayList<>();
        if (addresses == null) {
            return out;
        }
        StringBuilder cur = new StringBuilder();
        boolean quoted = false, angled = false;
        for (int i = 0; i < addresses.length(); i++) {
            char c = addresses.charAt(i);
            if (c == '\\' && quoted && i + 1 < addresses.length()) {
                cur.append(c).append(addresses.charAt(++i));
                continue;
            }
            if (c == '"') {
                quoted = !quoted;
            } else if (!quoted && c == '<') {
                angled = true;
            } else if (!quoted && c == '>') {
                angled = false;
            } else if (!quoted && !angled && (c == ',' || c == ';')) {
                add(out, cur);
                continue;
            }
            cur.append(c);
        }
        add(out, cur);
        return out;
    }

    private static void add(List<String> out, StringBuilder cur) {
        String a = cur.toString().trim();
        if (!a.isEmpty()) {
            out.add(a);
        }
        cur.setLength(0);
    }

    public static String join(List<String> addresses) {
        return String.join("; ", addresses);
    }
}
