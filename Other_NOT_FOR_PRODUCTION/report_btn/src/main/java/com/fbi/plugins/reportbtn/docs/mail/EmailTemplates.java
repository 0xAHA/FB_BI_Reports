package com.fbi.plugins.reportbtn.docs.mail;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;

/**
 * The client's email templates: a text file whose "SUBJECT:" line is the subject
 * and whose other lines are the body. A body with an html tag is HTML; any other
 * body is plain text, which becomes a simple HTML document here so it can be
 * edited and sent the same way. The path comes from the email settings
 * (SalesOrderEmail, PurchaseOrderEmail, ShipEmail, GenericEmail), else the stock
 * template that ships in the client's email-templates folder.
 */
public final class EmailTemplates {

    public static final class Template {
        public final String subject;
        public final String body;
        public final boolean html;
        /** Where it came from, for the composer's note ("" when there was none). */
        public final String source;

        Template(String subject, String body, boolean html, String source) {
            this.subject = subject;
            this.body = body;
            this.html = html;
            this.source = source;
        }
    }

    private static final String[] STOCK = {"SO", "SO_Template.txt", "PO", "PO_Template.txt", "SHIP", "Ship_Template.txt"};

    private EmailTemplates() {
    }

    /** Parses a template's text (a BOM and CRLF line ends are fine). */
    public static Template parse(String text, String source) {
        String t = text == null ? "" : text;
        if (!t.isEmpty() && t.charAt(0) == 0xFEFF) {
            t = t.substring(1);
        }
        String subject = "";
        StringBuilder body = new StringBuilder();
        for (String line : t.split("\r\n|\r|\n", -1)) {
            if (line.startsWith("SUBJECT:")) {
                subject = line.substring("SUBJECT:".length()).trim();
            } else {
                if (body.length() > 0) {
                    body.append('\n');
                }
                body.append(line);
            }
        }
        String b = body.toString().replaceAll("\\s+$", "");
        return new Template(subject, b, b.toLowerCase().contains("<html"), source);
    }

    /** The template for a kind of email (SO, PO, SHIP, GENERIC); an empty one when none can be read. */
    public static Template load(String kind) {
        String path = MailSettings.templatePath(kind);
        File f = path.isEmpty() ? null : new File(path);
        if (f == null || !f.isFile()) {
            f = stock(kind);
        }
        if (f != null && f.isFile()) {
            try {
                return parse(new String(Files.readAllBytes(f.toPath()), StandardCharsets.UTF_8), f.getAbsolutePath());
            } catch (Exception ignored) {
                // fall through to an empty template
            }
        }
        return new Template("", "", false, "");
    }

    private static File stock(String kind) {
        for (int i = 0; i + 1 < STOCK.length; i += 2) {
            if (STOCK[i].equals(kind)) {
                // The client runs from client/bin; the templates are in client/email-templates.
                File dir = new File(System.getProperty("user.dir", "."));
                File f = new File(dir.getParentFile() != null ? dir.getParentFile() : dir, "email-templates/" + STOCK[i + 1]);
                return f.isFile() ? f : null;
            }
        }
        return null;
    }

    /** The template's body as an HTML document: HTML as it is, plain text escaped with its line breaks kept. */
    public static String htmlBody(Template t) {
        if (t.html) {
            return t.body;
        }
        return "<!DOCTYPE html><html><head><meta charset=\"UTF-8\"></head>"
            + "<body style=\"font-family:Arial,sans-serif;font-size:14px\">"
            + escape(t.body).replace("\n", "<br>") + "</body></html>";
    }

    /** A footer written with HTML tags (the stock one is "<br><br><br>-----<br>This email was sent…"). */
    private static final java.util.regex.Pattern FOOTER_TAG = java.util.regex.Pattern.compile(
        "(?i)</?(br|p|div|span|a|b|i|u|strong|em|font|img|hr|table|tr|td|ul|ol|li|center|small|h[1-6])\\b[^>]*>");
    private static final java.util.regex.Pattern URL = java.util.regex.Pattern.compile("(?i)\\b(https?://[^\\s<>\"']+|www\\.[^\\s<>\"']+)");

    /**
     * The email footer (Settings › Email), when one is set, before the closing body or
     * html tag, as the stock window adds it. A footer written with HTML tags goes in as
     * HTML; a plain one is escaped, with its line breaks kept and its web addresses linked.
     */
    public static String withFooter(String html, String footer) {
        if (footer == null || footer.trim().isEmpty()) {
            return html;
        }
        String f = footerHtml(footer);
        String lower = html.toLowerCase();
        int at = lower.lastIndexOf("</body>");
        if (at < 0) {
            at = lower.lastIndexOf("</html>");
        }
        return at < 0 ? html + f : html.substring(0, at) + f + html.substring(at);
    }

    static String footerHtml(String footer) {
        String text = footer.replace("\r\n", "\n").replace('\r', '\n');
        if (!FOOTER_TAG.matcher(text).find()) {
            return "<br>" + linkify(escape(text)).replace("\n", "<br>");
        }
        if (text.toLowerCase().contains("<a ")) {
            return text;   // its own links: as written
        }
        // Link the addresses in the text between the tags.
        StringBuilder out = new StringBuilder();
        java.util.regex.Matcher tag = java.util.regex.Pattern.compile("<[^>]*>").matcher(text);
        int at = 0;
        while (tag.find()) {
            out.append(linkify(text.substring(at, tag.start()))).append(tag.group());
            at = tag.end();
        }
        return out.append(linkify(text.substring(at))).toString();
    }

    /** Web addresses in a piece of HTML text as links (a trailing full stop or comma stays outside). */
    private static String linkify(String s) {
        java.util.regex.Matcher m = URL.matcher(s);
        StringBuffer out = new StringBuffer();
        while (m.find()) {
            String u = m.group(1).replaceAll("[.,;:)]+$", "");
            String tail = m.group(1).substring(u.length());
            String href = u.toLowerCase().startsWith("www.") ? "https://" + u : u;
            m.appendReplacement(out, java.util.regex.Matcher.quoteReplacement("<a href=\"" + href + "\">" + u + "</a>" + tail));
        }
        m.appendTail(out);
        return out.toString();
    }

    static String escape(String s) {
        return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;");
    }
}
