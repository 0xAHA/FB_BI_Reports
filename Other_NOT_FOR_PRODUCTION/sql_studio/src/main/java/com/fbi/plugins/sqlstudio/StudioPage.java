package com.fbi.plugins.sqlstudio;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * The SQL Studio page, as built into the jar (build.sh copies src/main/web).
 *
 * The page is written as separate files so a plain browser can open
 * studio.htm straight from the source folder while it is being worked on: its
 * script and stylesheet tags then load the neighbouring files. BiBrowserPanel
 * loads a string with no base URL, so here each such tag is replaced by the
 * file it names before the page is shown.
 */
final class StudioPage {

    /** The report id the page is shown with: the native editor's preview id. */
    static final int REPORT_ID = -1;

    private static final String DIR = "/com/fbi/plugins/sqlstudio/web/";
    private static final String PAGE = "studio.htm";
    private static final Pattern SCRIPT = Pattern.compile(
        "<script\\s+src=\"([A-Za-z0-9._-]+\\.js)\"\\s*>\\s*</script>", Pattern.CASE_INSENSITIVE);
    private static final Pattern STYLE = Pattern.compile(
        "<link\\s+rel=\"stylesheet\"\\s+href=\"([A-Za-z0-9._-]+\\.css)\"\\s*/?>", Pattern.CASE_INSENSITIVE);
    private static final Pattern HEAD = Pattern.compile("<head(\\s[^>]*)?>", Pattern.CASE_INSENSITIVE);

    /** A page or file missing from the jar; the message is ready to show. */
    static final class MissingException extends Exception {
        MissingException(String message) {
            super(message);
        }
    }

    private StudioPage() {
    }

    /** The page with its files inlined and window.FB_STUDIO set to the given JSON. */
    static String build(String contextJson) throws MissingException {
        String html = read(PAGE);
        html = inline(html, SCRIPT, "<script>", "</script>");
        html = inline(html, STYLE, "<style>", "</style>");
        return insertScript(html, "FB_STUDIO", contextJson);
    }

    static String version() {
        String v = StudioPage.class.getPackage() == null ? null : StudioPage.class.getPackage().getImplementationVersion();
        return v == null ? "dev" : v;
    }

    private static String inline(String html, Pattern tag, String open, String close) throws MissingException {
        Matcher m = tag.matcher(html);
        StringBuilder out = new StringBuilder(html.length() * 2);
        int last = 0;
        while (m.find()) {
            out.append(html, last, m.start());
            // A literal "</script>" inside the file would end the tag early.
            String body = read(m.group(1)).replace("</script", "<\\/script");
            out.append(open).append('\n').append(body).append('\n').append(close);
            last = m.end();
        }
        return out.append(html, last, html.length()).toString();
    }

    private static String read(String name) throws MissingException {
        try (InputStream in = StudioPage.class.getResourceAsStream(DIR + name)) {
            if (in == null) {
                throw new MissingException(name + " isn't in this build of SQL Studio.");
            }
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[16384];
            for (int n; (n = in.read(buf)) > 0; ) {
                out.write(buf, 0, n);
            }
            String s = new String(out.toByteArray(), StandardCharsets.UTF_8);
            return !s.isEmpty() && s.charAt(0) == 0xFEFF ? s.substring(1) : s;   // a BOM
        } catch (IOException e) {
            throw new MissingException("Reading " + name + " failed: " + e.getMessage());
        }
    }

    /**
     * Inserts window.&lt;name&gt; = &lt;json&gt; right after the first head tag outside a
     * comment (else at the top). The json must come from jsonString-escaped parts.
     */
    static String insertScript(String html, String name, String json) {
        String tag = "<script>window." + name + "=" + json + ";</script>";
        Matcher m = HEAD.matcher(html);
        while (m.find()) {
            if (html.lastIndexOf("<!--", m.start()) <= html.lastIndexOf("-->", m.start())) {
                return html.substring(0, m.end()) + tag + html.substring(m.end());
            }
        }
        return tag + html;
    }

    /**
     * A JSON string that is also safe inside a script tag in a Fishbowl page:
     * no "<" (cannot close the script) and no "$" (cannot form a setting token,
     * which BiBrowserPanel substitutes by global text replacement).
     */
    static String jsonString(String s) {
        StringBuilder out = new StringBuilder(s.length() + 2).append('"');
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c == '"' || c == '\\') {
                out.append('\\').append(c);
            } else if (c < 0x20 || c == '<' || c == '$' || c == (char) 0x2028 || c == (char) 0x2029) {
                out.append(String.format("\\u%04x", (int) c));
            } else {
                out.append(c);
            }
        }
        return out.append('"').toString();
    }
}
