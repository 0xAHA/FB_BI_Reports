package com.fbi.plugins.reportbtn.editor;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * The page of a Report Builder report, written from its spec. The same page as
 * tools/report-builder/gen-page.js writes: keep the two in step. The page holds no
 * SQL and no code from the user: fb-report compiles the spec when the report runs.
 *
 * Every piece of user text is escaped so neither the browser nor Fishbowl's text
 * substitution (directives, $CODE{..} setting tokens) can read it as anything but data.
 * Pure, so EditorSelfCheck holds it.
 */
final class BuilderPage {

    /** The definition block a builder page carries its spec in. */
    static final String SPEC_OPEN = "<script type=\"application/json\" id=\"fb-report-spec\">";
    static final String SPEC_CLOSE = "</script>";
    /** The most a spec may weigh. */
    static final int MAX_SPEC = 256 * 1024;

    private static final ObjectMapper JSON = new ObjectMapper().enable(SerializationFeature.INDENT_OUTPUT);
    private static final Pattern KEY = Pattern.compile("\\bkey:\\s*'((?:[^'\\\\]|\\\\.)*)'");

    private BuilderPage() {
    }

    /** What a page is written from. */
    static final class Def {
        String name;
        String key;
        String folder;
        String launch;
        String description;
        JsonNode spec;
        /** The publish request this page answers (the builder looks for it), or null. */
        String publishNonce;
    }

    static String render(Def d) throws java.io.IOException {
        JsonNode spec = d.spec;
        boolean charts = false;
        for (JsonNode s : spec.path("steps")) {
            charts |= "chart".equals(s.path("type").asText());
        }
        String title = spec.path("title").asText(d.name);
        String eol = "\n";
        StringBuilder b = new StringBuilder();
        b.append("<!DOCTYPE html>").append(eol).append("<html lang=\"en\">").append(eol).append("<head>").append(eol);
        b.append("    <meta charset=\"UTF-8\">").append(eol);
        if (d.launch != null && !d.launch.trim().isEmpty()) {
            b.append("    <meta name=\"fb-launch\" content=\"").append(attr(d.launch)).append("\">").append(eol);
        }
        b.append("    <meta name=\"fb-folder\" content=\"").append(attr(d.folder == null || d.folder.trim().isEmpty() ? "Custom" : d.folder)).append("\">").append(eol);
        b.append("    <meta name=\"fb-origin\" content=\"custom\">").append(eol);
        b.append("    <meta name=\"fb-builder\" content=\"1").append(d.publishNonce != null ? "; p=" + d.publishNonce.replaceAll("[^A-Za-z0-9_-]", "") : "").append("\">").append(eol);
        b.append("    <meta name=\"description\" content=\"").append(attr(d.description)).append("\">").append(eol);
        b.append("    <script>").append(eol);
        b.append("        // A Report Builder report: everything below comes from its definition (the JSON").append(eol);
        b.append("        // block in the body). fb-report compiles it against the fb-model catalog each run.").append(eol);
        b.append("        window.FB_REPORT = {").append(eol);
        b.append("            key:   ").append(js(d.key)).append(",").append(eol);
        b.append("            name:  ").append(js(d.name)).append(",").append(eol);
        b.append("            build: 'UNSTAMPED'     // @fb-build").append(eol);
        b.append("        };").append(eol);
        b.append("    </script>").append(eol);
        b.append("    <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">").append(eol);
        b.append("    <title>").append(attr(title)).append("</title>").append(eol);
        include(b, "Script", "fb-lib", eol);
        include(b, "Script", "fb-doc", eol);
        if (charts) {
            include(b, "Script", "fb-echarts", eol);
            include(b, "Script", "fb-chart", eol);
        }
        include(b, "Script", "fb-model", eol);
        include(b, "Script", "fb-report", eol);
        include(b, "Style", "fb-styles", eol);
        include(b, "Style", "fb-doc-fonts", eol);
        b.append("</head>").append(eol);
        b.append("<body class=\"rpt-page\">").append(eol);
        b.append("<div id=\"fbr\"></div>").append(eol);
        b.append(SPEC_OPEN).append(eol);
        b.append(embed(spec)).append(eol);
        b.append(SPEC_CLOSE).append(eol);
        b.append("<script>FBReport.boot();</script>").append(eol);
        b.append("</body>").append(eol).append("</html>").append(eol);
        return b.toString();
    }

    private static void include(StringBuilder b, String type, String name, String eol) {
        String tag = "Script".equals(type) ? "script" : "style";
        b.append("    <").append(tag).append(">").append(eol);
        b.append("        {% ").append(type).append(' ').append(name).append(" %}").append(eol);
        b.append("    </").append(tag).append(">").append(eol);
    }

    /** The spec as JSON that is safe inside a script element and against Fishbowl's text substitution. */
    static String embed(JsonNode spec) throws java.io.IOException {
        String s = JSON.writeValueAsString(spec).replace("\r\n", "\n");
        StringBuilder out = new StringBuilder(s.length() + 64);
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '<': out.append("\\u003c"); break;
                case '$': out.append("\\u0024"); break;
                case '%': out.append("\\u0025"); break;
                case ' ': out.append("\\u2028"); break;
                case ' ': out.append("\\u2029"); break;
                default:
                    if (c < 0x20 && c != '\n') {
                        out.append(String.format("\\u%04x", (int) c));
                    } else {
                        out.append(c);
                    }
            }
        }
        return out.toString();
    }

    /** The spec a builder page carries, or null when it has none. */
    static JsonNode extract(String page) throws java.io.IOException {
        if (page == null) {
            return null;
        }
        int a = page.indexOf(SPEC_OPEN);
        int z = a < 0 ? -1 : page.indexOf(SPEC_CLOSE, a + SPEC_OPEN.length());
        if (a < 0 || z < 0) {
            return null;
        }
        return JSON.readTree(page.substring(a + SPEC_OPEN.length(), z));
    }

    /** The storage key in a page's identity block, or null. */
    static String storageKey(String page) {
        Matcher m = KEY.matcher(page == null ? "" : page);
        return m.find() ? m.group(1) : null;
    }

    /** True for a page the builder wrote (and that nobody has detached from it). */
    static boolean isBuilderPage(String page) {
        String c = AppGroups.metaContent(page, "fb-builder");
        return c != null && c.trim().startsWith("1");
    }

    /** "" when the spec can be published, else why not. */
    static String problem(JsonNode spec, int bytes) {
        if (spec == null || !spec.isObject()) {
            return "The builder sent no report definition.";
        }
        if (bytes > MAX_SPEC) {
            return "The report definition is too large (" + (bytes / 1024) + " KB; the most is " + (MAX_SPEC / 1024) + " KB).";
        }
        if (!"fb-report-spec".equals(spec.path("kind").asText()) || !spec.path("v").canConvertToInt() || !spec.path("subject").isTextual()
            || !spec.path("steps").isArray()) {
            return "The builder sent something that isn't a report definition.";
        }
        return "";
    }

    private static String attr(String s) {
        // HTML-escaped; $ and % as entities so Fishbowl never sees a setting token or directive.
        return (s == null ? "" : s).replace("&", "&amp;").replace("\"", "&quot;").replace("<", "&lt;")
            .replace("$", "&#36;").replace("%", "&#37;");
    }

    private static String js(String s) {
        StringBuilder out = new StringBuilder("'");
        for (char c : (s == null ? "" : s).toCharArray()) {
            if (c == '\\' || c == '\'') {
                out.append('\\').append(c);
            } else if (c == '<') {
                out.append("\\x3c");
            } else if (c == '$') {
                out.append("\\x24");
            } else if (c == '%') {
                out.append("\\x25");
            } else if (c >= 0x20) {
                out.append(c);
            }
        }
        return out.append('\'').toString();
    }
}
