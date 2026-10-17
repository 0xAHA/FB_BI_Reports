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

    /** A comma / semicolon separated list of addresses, blanks dropped. */
    public static List<String> split(String addresses) {
        List<String> out = new ArrayList<>();
        if (addresses != null) {
            for (String a : addresses.split("[,;]")) {
                if (!a.trim().isEmpty()) {
                    out.add(a.trim());
                }
            }
        }
        return out;
    }

    public static String join(List<String> addresses) {
        return String.join("; ", addresses);
    }
}
