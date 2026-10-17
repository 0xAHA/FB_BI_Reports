package com.fbi.plugins.reportbtn.editor;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * An app's two placements and its origin, each a meta tag in its page:
 * - fb-launch, the module association: module keys and menu-group keys, which decide
 *   which modules' Reports > Apps menus list the app (report_btn's AppCatalog).
 * - fb-folder, the folder: one name, where the app sits in the Apps panel and the
 *   App Library. No sub-folders.
 * - fb-origin: "system" for an app that ships with Fishbowl (locked in the editor;
 *   duplicate it to change it), "custom" (or no tag) for everything else.
 * The module tables are the App Library's (CATS, MODULE_GROUP) and
 * docs/launch-context.md section 3: keep them in step. Pure, so EditorSelfCheck holds it.
 */
final class AppGroups {

    /** A menu group, and optionally a module inside it (for module association). */
    static final class Place {
        final String group;
        final String module;   // null: the group key itself

        Place(String group, String module) {
            this.group = group;
            this.module = module;
        }

        @Override
        public boolean equals(Object o) {
            return o instanceof Place && ((Place) o).group.equals(group)
                && (module == null ? ((Place) o).module == null : module.equals(((Place) o).module));
        }

        @Override
        public int hashCode() {
            return group.hashCode() * 31 + (module == null ? 0 : module.hashCode());
        }

        @Override
        public String toString() {
            return group + (module == null ? "" : "/" + module);
        }
    }

    static final String NONE = "none";
    /** The module association: which modules' Reports > Apps menus list the app. */
    static final String LAUNCH = "fb-launch";
    /** The folder: where the app sits in the Apps panel and the Launcher's Folders view (one name). */
    static final String FOLDER = "fb-folder";
    /** The origin: system (ships with Fishbowl, locked) or custom (the default). */
    static final String ORIGIN = "fb-origin";
    static final String SYSTEM = "system";
    static final String CUSTOM = "custom";
    /** Where apps without an fb-folder tag are listed. */
    static final String UNFILED = "Unfiled";

    /** Menu group id -> label, in the client's menu order; NONE last. */
    static final Map<String, String> GROUPS = new LinkedHashMap<>();
    /** Module key -> menu group id. */
    static final Map<String, String> MODULE_GROUP = new LinkedHashMap<>();
    /** Module key -> the module's name in the client. */
    static final Map<String, String> MODULE_LABEL = new LinkedHashMap<>();

    static {
        String[][] groups = {{"sales", "Sales"}, {"purchasing", "Purchasing"}, {"materials", "Materials"},
            {"manufacturing", "Manufacturing"}, {"accounting", "Accounting"}, {"setup", "Setup"}, {"general", "General"},
            {"reporting", "Reporting"}, {"integrations", "Integrations"}, {NONE, "Not assigned"}};
        for (String[] g : groups) {
            GROUPS.put(g[0], g[1]);
        }
        String[][] modules = {
            {"SO", "sales", "Sales Order"}, {"PICK", "sales", "Picking"}, {"SHIP", "sales", "Shipping"},
            {"CUST", "sales", "Customer"}, {"RMA", "sales", "RMA"}, {"PRICING_RULE", "sales", "Pricing Rules"},
            {"PO", "purchasing", "Purchase Order"}, {"RECEIPT", "purchasing", "Receiving"}, {"VEND", "purchasing", "Vendor"},
            {"MO", "manufacturing", "Manufacture Order"}, {"WO", "manufacturing", "Work Order"},
            {"BOM", "manufacturing", "Bill of Materials"},
            {"PART", "materials", "Part"}, {"PROD", "materials", "Product"}, {"INVENTORY", "materials", "Inventory"},
            {"TO", "materials", "Transfer Order"}, {"CONSIGNMENT", "materials", "Consignment"},
            {"CLASS", "accounting", "Class"}, {"CURRENCY", "accounting", "Currency"}, {"TAX_RATE", "accounting", "Tax Rate"},
            {"CAR", "setup", "Carrier"}, {"LOC", "setup", "Location"}, {"LG", "setup", "Location Group"},
            {"USER", "setup", "User"}, {"USER_GROUP", "setup", "User Group"}, {"COMPANY", "setup", "Company"},
            {"PAYMENT_TERMS", "setup", "Payment Terms"}, {"UOM", "setup", "UOM"},
        };
        for (String[] m : modules) {
            MODULE_GROUP.put(m[0], m[1]);
            MODULE_LABEL.put(m[0], m[2]);
        }
    }

    private static final Pattern CONTENT = Pattern.compile(
        "\\bcontent\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)')", Pattern.CASE_INSENSITIVE);

    private AppGroups() {
    }

    // ---------------------------------------------------------------- reading
    /** The content of the first fb-launch tag in html (or a window of it); "" if none. */
    static String launchContent(String html) {
        String c = metaContent(html, LAUNCH);
        return c == null ? "" : c;
    }

    /** The content of the first fb-folder tag; "" if none. */
    static String folderContent(String html) {
        String c = metaContent(html, FOLDER);
        return c == null ? "" : c.trim();
    }

    /** True when the page's first fb-origin tag says system. */
    static boolean isSystem(String html) {
        return SYSTEM.equalsIgnoreCase(metaContent(html, ORIGIN));
    }

    /** The content of the first meta tag with this name (either attribute order or quote style); null if none. */
    static String metaContent(String html, String name) {
        if (html == null) {
            return null;
        }
        Matcher m = meta(name).matcher(html);
        if (!m.find()) {
            return null;
        }
        Matcher c = CONTENT.matcher(m.group());
        return c.find() ? (c.group(1) != null ? c.group(1) : c.group(2)).trim() : "";
    }

    private static Pattern meta(String name) {
        return Pattern.compile("<meta\\b[^>]*\\bname\\s*=\\s*[\"']" + Pattern.quote(name) + "[\"'][^>]*>",
            Pattern.CASE_INSENSITIVE);
    }

    /** The module association as menu groups and modules; NONE when nothing matches. */
    static List<Place> places(String tagContent) {
        Set<Place> out = new LinkedHashSet<>();
        for (String raw : keys(tagContent)) {
            String k = raw.toUpperCase(Locale.ROOT);
            String group = MODULE_GROUP.get(k);
            if (group != null) {
                out.add(new Place(group, k));
            } else if (!k.equals("NONE") && GROUPS.containsKey(k.toLowerCase(Locale.ROOT))) {
                out.add(new Place(k.toLowerCase(Locale.ROOT), null));
            }
        }
        if (out.isEmpty()) {
            out.add(new Place(NONE, null));
        }
        List<Place> sorted = new ArrayList<>(out);
        List<String> order = new ArrayList<>(GROUPS.keySet());
        sorted.sort((a, b) -> order.indexOf(a.group) - order.indexOf(b.group));
        return sorted;
    }

    /** The keys of a tag's content, as written. */
    static List<String> keys(String content) {
        List<String> out = new ArrayList<>();
        for (String k : (content == null ? "" : content).split("[\\s,]+")) {
            if (!k.isEmpty()) {
                out.add(k);
            }
        }
        return out;
    }

    /** True for a module key or a menu-group key report_btn understands. */
    static boolean knownKey(String key) {
        String k = key == null ? "" : key.toUpperCase(Locale.ROOT);
        return MODULE_GROUP.containsKey(k) || (!k.equals("NONE") && GROUPS.containsKey(k.toLowerCase(Locale.ROOT)));
    }

    /** A key as people see it: "Sales Order" for SO, "All Sales modules" for SALES. */
    static String keyLabel(String key) {
        String u = key == null ? "" : key.toUpperCase(Locale.ROOT);
        if (MODULE_LABEL.containsKey(u)) {
            return MODULE_LABEL.get(u);
        }
        String g = u.toLowerCase(Locale.ROOT);
        return GROUPS.containsKey(g) && !NONE.equals(g) ? "All " + GROUPS.get(g) + " modules" : key;
    }

    /** "Sales Order, Picking" for "SO, PICK" (unknown keys as written); "" when none. */
    static String describe(String content) {
        List<String> out = new ArrayList<>();
        for (String k : keys(content)) {
            String u = k.toUpperCase(Locale.ROOT);
            out.add(MODULE_LABEL.containsKey(u) ? MODULE_LABEL.get(u)
                : GROUPS.containsKey(u.toLowerCase(Locale.ROOT)) && !u.equals("NONE")
                ? "all " + GROUPS.get(u.toLowerCase(Locale.ROOT)) + " modules" : k + " (not recognised)");
        }
        return String.join(", ", out);
    }

    /**
     * The tag content after a change: removeKey taken out (any case), addKey added at
     * the end unless it is there already; other keys, known or not, keep their order.
     * Either key may be null. Keys are joined with ", ".
     */
    static String retag(String content, String removeKey, String addKey) {
        List<String> keys = new ArrayList<>();
        for (String k : keys(content)) {
            if (removeKey == null || !k.equalsIgnoreCase(removeKey)) {
                keys.add(k);
            }
        }
        if (addKey != null && keys.stream().noneMatch(k -> k.equalsIgnoreCase(addKey))) {
            keys.add(addKey);
        }
        return String.join(", ", keys);
    }

    // ---------------------------------------------------------------- writing
    /** The page with its fb-launch tag set to content (see rewriteMeta). */
    static String rewrite(String html, String content) {
        return rewriteMeta(html, LAUNCH, content);
    }

    /** The page with its fb-origin tag set to origin (SYSTEM or CUSTOM). */
    static String setOrigin(String html, String origin) {
        return rewriteMeta(html, ORIGIN, origin);
    }

    /** The page with its fb-folder tag set to folder; a blank folder removes the tag (Unfiled). */
    static String setFolder(String html, String folder) {
        return rewriteMeta(html, FOLDER, folder == null || folder.trim().isEmpty() ? null : folder.trim());
    }

    /**
     * The page with its first meta tag of this name set to content, keeping the tag's
     * quote style. Null content removes the tag (and its line, when it is alone on it).
     * A page without the tag gets one, indented like the line it follows: an fb-folder
     * tag after the fb-launch tag, an fb-origin tag after the fb-folder tag (else
     * fb-launch), else after the charset meta, else after head. With
     * no head either, the page is returned unchanged. The first tag is the one every
     * host reads, which is why each is written once.
     */
    static String rewriteMeta(String html, String name, String content) {
        if (html == null) {
            return null;
        }
        Matcher m = meta(name).matcher(html);
        if (m.find()) {
            if (content == null) {
                int start = m.start(), end = m.end();
                int lineStart = html.lastIndexOf('\n', start - 1) + 1;
                int lineEnd = html.indexOf('\n', end);
                lineEnd = lineEnd < 0 ? html.length() : lineEnd + 1;
                boolean alone = html.substring(lineStart, start).trim().isEmpty()
                    && html.substring(end, lineEnd).trim().isEmpty();
                return alone ? html.substring(0, lineStart) + html.substring(lineEnd) : html.substring(0, start) + html.substring(end);
            }
            String value = content.replace("\"", "").replace("'", "");
            String tag = m.group();
            Matcher c = CONTENT.matcher(tag);
            String updated;
            if (c.find()) {
                boolean single = c.group(1) == null;
                updated = tag.substring(0, c.start()) + "content=" + (single ? "'" + value + "'" : "\"" + value + "\"")
                    + tag.substring(c.end());
            } else {
                int end = tag.endsWith("/>") ? tag.length() - 2 : tag.length() - 1;
                updated = tag.substring(0, end).replaceAll("\\s+$", "") + " content=\"" + value + "\"" + tag.substring(end);
            }
            return html.substring(0, m.start()) + updated + html.substring(m.end());
        }
        if (content == null) {
            return html;
        }
        String value = content.replace("\"", "").replace("'", "");
        Matcher anchor = null;
        String[] after = ORIGIN.equals(name) ? new String[] {FOLDER, LAUNCH} : FOLDER.equals(name) ? new String[] {LAUNCH}
            : new String[0];
        for (int i = 0; i < after.length && anchor == null; i++) {
            Matcher a = meta(after[i]).matcher(html);
            if (a.find()) {
                anchor = a;
            }
        }
        String eol = html.contains("\r\n") ? "\r\n" : "\n";
        String tag = "<meta name=\"" + name + "\" content=\"" + value + "\">";
        boolean nested = false;
        if (anchor == null) {
            // Older and hand-made pages may lack any of these: charset meta, head, html, doctype.
            String[] fallbacks = {"<meta\\b[^>]*\\bcharset\\b[^>]*>", "<head\\b[^>]*>", "<html\\b[^>]*>", "<!DOCTYPE\\b[^>]*>"};
            for (int i = 0; i < fallbacks.length && anchor == null; i++) {
                Matcher a = Pattern.compile(fallbacks[i], Pattern.CASE_INSENSITIVE).matcher(html);
                if (a.find()) {
                    anchor = a;
                    nested = i == 1 || i == 2;   // inside head or html: one level deeper
                }
            }
            if (anchor == null) {
                return tag + eol + html;   // a bare fragment: first line (hosts read the first tag anywhere)
            }
        }
        int lineStart = html.lastIndexOf('\n', anchor.start()) + 1;
        String indent = html.substring(lineStart, anchor.start()).replaceAll("\\S.*", "");
        if (nested) {
            indent = indent + "    ";
        }
        return html.substring(0, anchor.end()) + eol + indent + tag + html.substring(anchor.end());
    }

    /** A folder name the panel accepts: one line, 1-64 characters, not a reserved name. "" when valid. */
    static String folderProblem(String name) {
        String n = name == null ? "" : name.trim();
        if (n.isEmpty()) {
            return "A folder needs a name.";
        }
        if (n.length() > 64) {
            return "A folder name can be at most 64 characters.";
        }
        if (n.contains("\"") || n.contains("'") || n.contains("<") || n.contains(">") || n.contains("\n")) {
            return "A folder name can't contain quotes, < or >.";
        }
        if (n.equalsIgnoreCase(UNFILED) || n.equalsIgnoreCase("Shared")) {
            return "\"" + n + "\" is reserved.";
        }
        return "";
    }

    /** Folder order: names starting with _ first (as Fishbowl's report tree sorts client folders), then A-Z. */
    static int compareFolders(String a, String b) {
        boolean ua = a.startsWith("_"), ub = b.startsWith("_");
        return ua != ub ? (ua ? -1 : 1) : a.compareToIgnoreCase(b);
    }

    static String groupLabel(String group) {
        String l = GROUPS.get(group);
        return l == null ? group : l;
    }

    static String moduleLabel(String key) {
        String l = MODULE_LABEL.get(key);
        return l == null ? key : l;
    }
}
