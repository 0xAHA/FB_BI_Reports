package com.fbi.plugins.reportbtn;

import com.evnt.client.common.EVEManager;
import com.evnt.client.common.EVEManagerUtil;
import com.evnt.common.MethodConst;
import com.evnt.eve.event.EVEvent;
import com.evnt.util.KeyConst;
import com.fbi.plugins.FishbowlPlugin;

import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * The Apps menus of system apps. An app's Apps menus are normally its fb-launch tag,
 * in its code; a system app's code is locked (it ships with Fishbowl, and an update
 * replaces it), so the company's choice for one is kept here instead and wins over
 * its tag: plugin properties of the plugin "report_btn.menus", one per app,
 * "app.&lt;record name, lower case&gt;" -> the tag content ("SO, PICK"), or "-" for no
 * Apps menu. No row: the app's own tag. Read with SQL each time (a change on one PC
 * shows on the others at the next catalog scan); written with the client's
 * SAVE_PLUGIN_PROPERTIES call, as FishbowlPlugin.savePluginProperties makes it.
 */
public final class MenuOverrides {

    static final String PLUGIN = "report_btn.menus";
    private static final String PREFIX = "app.";
    private static final String NONE = "-";
    private static final int MSG_EXCEPTION = 201;

    private MenuOverrides() {
    }

    /** Record name (lower case) -> its Apps menus content ("" = none). Empty when nothing is stored or it can't be read. */
    public static Map<String, String> read(FishbowlPlugin plugin) {
        Map<String, String> out = new HashMap<>();
        if (plugin == null) {
            return out;
        }
        try {
            List<?> rows = plugin.runQuery("SELECT dataKey AS k, info AS v FROM pluginproperties WHERE plugin = '" + PLUGIN + "'");
            if (rows != null) {
                for (Object row : rows) {
                    String k = AppCatalog.column(row, "k"), v = AppCatalog.column(row, "v");
                    if (k != null && k.startsWith(PREFIX) && v != null && !v.trim().isEmpty()) {
                        out.put(k.substring(PREFIX.length()), NONE.equals(v.trim()) ? "" : v.trim());
                    }
                }
            }
        } catch (RuntimeException | LinkageError e) {
            ReportAppsPlugin.log("Reading the system apps' Apps menus failed", e);
        }
        return out;
    }

    /** The stored Apps menus of the app with this record name, or null when it has none stored (its tag applies). */
    public static String of(Map<String, String> stored, String name) {
        return name == null ? null : stored.get(name.trim().toLowerCase(Locale.ROOT));
    }

    /** Stores an app's Apps menus (content as an fb-launch tag holds it; "" = none). Throws with a message. */
    public static void save(String name, String content) throws Exception {
        if (name == null || name.trim().isEmpty()) {
            throw new Exception("The app has no name.");
        }
        Map<String, String> props = new HashMap<>();
        String c = content == null ? "" : content.trim();
        props.put(PREFIX + name.trim().toLowerCase(Locale.ROOT), c.isEmpty() ? NONE : c);
        EVEManager eve = EVEManagerUtil.getEveManager();
        EVEvent rq = eve.createRequest(MethodConst.SAVE_PLUGIN_PROPERTIES);
        rq.add(KeyConst.NAME, PLUGIN);
        rq.addRawMap(KeyConst.PROPERTY_MAP, props);
        EVEvent reply = eve.sendAndWait(rq);
        if (reply == null || reply.getMessageType() == MSG_EXCEPTION) {
            throw new Exception("Fishbowl didn't save the Apps menus.");
        }
        AppCatalog.invalidate();
    }

    /** The keys of a content string, upper-cased (as AppCatalog matches them). */
    static Set<String> keys(String content) {
        Set<String> out = new LinkedHashSet<>();
        for (String part : (content == null ? "" : content).split("[,\\s]+")) {
            String code = part.trim().toUpperCase(Locale.ROOT);
            if (code.matches("[A-Z][A-Z0-9_]*")) {
                out.add(code);
            }
        }
        return out;
    }
}
