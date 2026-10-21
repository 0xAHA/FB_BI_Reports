package com.fbi.plugins.reportbtn;

import com.fbi.fbo.impl.dataexport.QueryRow;
import com.fbi.plugins.FishbowlPlugin;
import org.json.fbfork.JSONObject;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.Iterator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * The BI reports a module lists: those whose fb-launch meta tag names the module
 * (its key) or its menu group, limited to the reports the user may open.
 * The tag is the POC's visibility setting; a real implementation would keep
 * visibility elsewhere.
 *
 * Access follows bireportaccess, as the BI Reports module does: a report is
 * listed when one of the user's groups has a row for it; admin sees every
 * report. Same rule as Other_NOT_FOR_PRODUCTION/Report_Launcher.
 *
 * Two reads, because finding the tags means scanning every page (0.2-0.5 s for
 * 12 MB of pages on demodb) while the access list takes milliseconds:
 *   all()   the reports the user may open, re-read after 30 s, on the menu-open
 *           thread;
 *   tags    report id -> tag keys, the same for every user, re-read in the
 *           background at login and then every 60 s. A menu never waits for
 *           it: it shows the last result (a new tag shows on a later open).
 */
final class AppCatalog {

    static final class App {
        final int id;
        final String name;
        final String description;

        App(int id, String name, String description) {
            this.id = id;
            this.name = name;
            this.description = description;
        }
    }

    private static final long TTL_MS = 30_000;
    private static final long TAGS_TTL_MS = 60_000;

    // The tag, either attribute order or quote style, within the window the
    // query returns. Only the first name="fb-launch" in a page counts, so the
    // spec says to write it exactly once.
    private static final Pattern META = Pattern.compile(
        "<meta\\b[^>]*\\bname\\s*=\\s*[\"']fb-launch[\"'][^>]*>", Pattern.CASE_INSENSITIVE);
    private static final Pattern CONTENT = Pattern.compile(
        "\\bcontent\\s*=\\s*[\"']([^\"']*)[\"']", Pattern.CASE_INSENSITIVE);

    private static List<App> cache = Collections.emptyList();
    private static long cachedAt;
    private static String cachedUser;

    private static volatile Map<Integer, Set<String>> tags = Collections.emptyMap();
    private static volatile long tagsAt;
    private static final AtomicBoolean tagsLoading = new AtomicBoolean();

    private AppCatalog() {
    }

    /** The reports whose fb-launch tag names any of these keys (module key, menu group), by name. */
    static List<App> forModule(Set<String> keys) {
        List<App> out = new ArrayList<>();
        Map<Integer, Set<String>> byId = tags();
        for (App app : all()) {
            Set<String> tagged = byId.get(app.id);
            if (tagged != null && !Collections.disjoint(tagged, keys)) {
                out.add(app);
            }
        }
        return out;
    }

    /** The report with this id, if the user may open it; else null. */
    static App byId(int id) {
        for (App app : all()) {
            if (app.id == id) {
                return app;
            }
        }
        return null;
    }

    /** The report with this exact name (else the first match ignoring case), if the user may open it. */
    static App byName(String name) {
        if (name == null) {
            return null;
        }
        String wanted = name.trim();
        App loose = null;
        for (App app : all()) {   // all() is ordered by name; the first of equal names wins
            if (app.name.equals(wanted)) {
                return app;
            }
            if (loose == null && app.name.equalsIgnoreCase(wanted)) {
                loose = app;
            }
        }
        return loose;
    }

    /** Either plugin in this jar can run the queries; both exist after login. */
    private static FishbowlPlugin plugin() {
        FishbowlPlugin p = ReportAppsPlugin.current();
        return p != null ? p : ReportWorkspacePlugin.current();
    }

    /** Starts the background tag scan (called at login). */
    static void warm() {
        refreshTagsInBackground();
    }

    /**
     * Forgets both caches after a page, its module association or its access is
     * saved, and rescans the tags straight away. The next menu waits for that scan
     * (briefly), so a changed module association shows on the next module switch.
     */
    static void invalidate() {
        synchronized (AppCatalog.class) {
            cachedAt = 0;
            tagsAt = 0;
        }
        synchronized (SCAN) {
            tagsStale = true;
            if (tagsLoading.get()) {
                rescan = true;   // the running scan may predate the change
                return;
            }
        }
        refreshTagsInBackground();
    }

    private static Map<Integer, Set<String>> tags() {
        if (System.currentTimeMillis() - tagsAt > TAGS_TTL_MS) {
            refreshTagsInBackground();
        }
        synchronized (SCAN) {
            long until = System.currentTimeMillis() + 3000;
            while (tagsStale && tagsLoading.get() && System.currentTimeMillis() < until) {
                try {
                    SCAN.wait(100);
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    break;
                }
            }
        }
        return tags;
    }

    private static final Object SCAN = new Object();
    private static volatile boolean tagsStale;
    private static boolean rescan;

    private static void refreshTagsInBackground() {
        if (!tagsLoading.compareAndSet(false, true)) {
            return;   // a scan is already running
        }
        Thread scan = new Thread(() -> {
            boolean again;
            do {
                try {
                    tags = readTags();
                } catch (Exception e) {
                    ReportAppsPlugin.log("Reading the fb-launch tags failed", e);
                } finally {
                    tagsAt = System.currentTimeMillis();   // a failure also waits for the next interval
                }
                synchronized (SCAN) {
                    again = rescan;
                    rescan = false;
                    if (!again) {
                        tagsStale = false;
                        tagsLoading.set(false);
                        SCAN.notifyAll();
                    }
                }
            } while (again);
        }, "report_btn-tags");
        scan.setDaemon(true);
        scan.start();
    }

    // Only pages with the tag, and only a window around it, not the whole page.
    // The locator is the exact attribute the spec prescribes, so prose that
    // merely mentions fb-launch is passed over.
    private static Map<Integer, Set<String>> readTags() {
        FishbowlPlugin plugin = plugin();
        Map<Integer, Set<String>> out = new HashMap<>();
        if (plugin == null) {
            return out;
        }
        List<?> rows = plugin.runQuery("SELECT b.id AS id, "
            + "SUBSTRING(s.data, GREATEST(1, LOCATE('name=\"fb-launch\"', s.data) - 120), 360) AS tag "
            + "FROM bireport b JOIN biscript s ON s.id = b.biScriptId "
            + "WHERE s.active+0 = 1 AND s.published+0 = 1 AND s.data LIKE '%name=\"fb-launch\"%'");
        if (rows != null) {
            for (Object row : rows) {
                try {
                    int id = Integer.parseInt(String.valueOf(column(row, "id")).trim());
                    Set<String> modules = launchModules(column(row, "tag"));
                    if (!modules.isEmpty()) {
                        out.put(id, modules);
                    }
                } catch (NumberFormatException ignored) {
                    // skip the row
                }
            }
        }
        // A system app's Apps menus stored by the company (MenuOverrides) win over its tag.
        Map<String, String> stored = MenuOverrides.read(plugin);
        if (!stored.isEmpty()) {
            List<?> named = plugin.runQuery("SELECT b.id AS id, LOWER(s.name) AS n FROM bireport b JOIN biscript s ON s.id = b.biScriptId "
                + "WHERE s.active+0 = 1 AND s.published+0 = 1");
            if (named != null) {
                for (Object row : named) {
                    String content = stored.get(column(row, "n"));
                    if (content == null) {
                        continue;
                    }
                    try {
                        int id = Integer.parseInt(String.valueOf(column(row, "id")).trim());
                        Set<String> keys = MenuOverrides.keys(content);
                        if (keys.isEmpty()) {
                            out.remove(id);
                        } else {
                            out.put(id, keys);
                        }
                    } catch (NumberFormatException ignored) {
                        // skip the row
                    }
                }
            }
        }
        return out;
    }

    /** Every report the user may open, by name. Never null. */
    static synchronized List<App> all() {
        FishbowlPlugin plugin = plugin();
        if (plugin == null) {
            return Collections.emptyList();
        }
        String user = plugin.getUsername();
        long now = System.currentTimeMillis();
        if (user != null && user.equals(cachedUser) && now - cachedAt < TTL_MS) {
            return cache;
        }

        List<App> apps = new ArrayList<>();
        try {
            String sql = "SELECT b.id AS id, b.name AS name, LEFT(COALESCE(b.description, ''), 300) AS description "
                + "FROM bireport b JOIN biscript s ON s.id = b.biScriptId "
                + "WHERE s.active+0 = 1 AND s.published+0 = 1 "
                + ("admin".equalsIgnoreCase(user) ? "" :
                   "AND b.id IN (SELECT a.biReportId FROM bireportaccess a "
                   + "JOIN usergrouprel r ON r.groupId = a.userGroupId WHERE r.userId = " + plugin.getUserId() + ") ")
                + "ORDER BY b.name";
            List<?> rows = plugin.runQuery(sql);
            if (rows != null) {
                for (Object row : rows) {
                    App app = toApp(row);
                    if (app != null) {
                        apps.add(app);
                    }
                }
            }
        } catch (Exception e) {
            ReportAppsPlugin.log("Reading the report list failed", e);
        }
        cache = apps;
        cachedAt = now;
        cachedUser = user;
        return apps;
    }

    private static App toApp(Object row) {
        int id;
        try {
            id = Integer.parseInt(String.valueOf(column(row, "id")).trim());
        } catch (NumberFormatException e) {
            return null;
        }
        String name = column(row, "name");
        if (id <= 0 || name == null || name.trim().isEmpty()) {
            return null;
        }
        String description = column(row, "description");
        return new App(id, name.trim(), description == null ? "" : description.trim());
    }

    /** The keys in the first fb-launch tag of a page (or a piece of one), upper-cased. */
    static Set<String> launchModules(String html) {
        Set<String> codes = new LinkedHashSet<>();
        if (html == null) {
            return codes;
        }
        Matcher meta = META.matcher(html);
        if (!meta.find()) {
            return codes;
        }
        Matcher content = CONTENT.matcher(meta.group());
        if (!content.find()) {
            return codes;
        }
        for (String part : content.group(1).split("[,\\s]+")) {
            String code = part.trim().toUpperCase(Locale.ROOT);
            if (code.matches("[A-Z][A-Z0-9_]*")) {
                codes.add(code);
            }
        }
        return codes;
    }

    /** A query-result column, matched without regard to case. */
    static String column(Object row, String name) {
        if (!(row instanceof QueryRow)) {
            return null;
        }
        QueryRow queryRow = (QueryRow) row;
        Object value = null;
        try {
            value = queryRow.getObject(name);
        } catch (Exception ignored) {
            // fall through to the JSON view
        }
        if (value == null) {
            try {
                JSONObject json = queryRow.getJsonObject();
                for (Iterator<?> keys = json.keys(); keys.hasNext(); ) {
                    String key = String.valueOf(keys.next());
                    if (key.equalsIgnoreCase(name)) {
                        value = json.get(key);
                        break;
                    }
                }
            } catch (Exception ignored) {
                return null;
            }
        }
        return value == null || JSONObject.NULL.equals(value) ? null : String.valueOf(value);
    }
}
