package com.fbi.plugins.reportbtn.docs;

import com.evnt.client.common.EVEManager;
import com.evnt.client.common.EVEManagerUtil;
import com.evnt.common.MethodConst;
import com.evnt.eve.event.EVEvent;
import com.evnt.util.KeyConst;

import java.util.HashMap;
import java.util.Map;

/**
 * The PoC's company-wide settings, kept as Fishbowl plugin properties of the plugin
 * "report_btn.docs" (the call FishbowlPlugin.savePluginProperties makes):
 *   doc.&lt;slot&gt;          the app record name that stands in for that module document
 *   mailprogram.&lt;userId&gt; "1" when that user sends through their own email program
 * They are read back with SQL each time, so a change on one PC shows on the others
 * at once (the client's own cache fills only at login).
 */
final class DocDefaults {

    static final String PLUGIN = "report_btn.docs";
    private static final String DOC = "doc.";
    private static final String MAIL_PROGRAM = "mailprogram.";
    private static final int MSG_EXCEPTION = 201;

    private DocDefaults() {
    }

    /** Every stored property (empty values dropped). */
    static Map<String, String> all() {
        Map<String, String> out = new HashMap<>();
        for (Map<String, String> r : Docs.rows("SELECT dataKey AS k, info AS v FROM pluginproperties WHERE plugin = "
                + Docs.lit(PLUGIN), "k", "v")) {
            String k = r.get("k"), v = r.get("v");
            if (!Docs.blank(k) && !Docs.blank(v)) {
                out.put(k, v.trim());
            }
        }
        return out;
    }

    /** slot name -> app name, for the slots that have one. */
    static Map<String, String> apps() {
        Map<String, String> out = new HashMap<>();
        for (Map.Entry<String, String> e : all().entrySet()) {
            if (e.getKey().startsWith(DOC)) {
                out.put(e.getKey().substring(DOC.length()), e.getValue());
            }
        }
        return out;
    }

    /** The app standing in for this document, or null (the Jasper default applies). */
    static String app(DocSlots.Slot slot) {
        String v = Docs.one("SELECT info AS v FROM pluginproperties WHERE plugin = " + Docs.lit(PLUGIN)
            + " AND dataKey = " + Docs.lit(DOC + slot.name), "v");
        return Docs.blank(v) ? null : v.trim();
    }

    /** Sets (or, with null, clears) the app for each slot given. Throws with a message ready to show. */
    static void setApps(Map<DocSlots.Slot, String> apps) throws Exception {
        Map<String, String> props = new HashMap<>();
        for (Map.Entry<DocSlots.Slot, String> e : apps.entrySet()) {
            props.put(DOC + e.getKey().name, e.getValue() == null ? "" : e.getValue());
        }
        save(props);
    }

    static boolean usesMailProgram(int userId) {
        String v = Docs.one("SELECT info AS v FROM pluginproperties WHERE plugin = " + Docs.lit(PLUGIN)
            + " AND dataKey = " + Docs.lit(MAIL_PROGRAM + userId), "v");
        return "1".equals(v == null ? null : v.trim());
    }

    static void setUsesMailProgram(int userId, boolean on) throws Exception {
        Map<String, String> props = new HashMap<>();
        props.put(MAIL_PROGRAM + userId, on ? "1" : "");
        save(props);
    }

    private static void save(Map<String, String> props) throws Exception {
        EVEManager eve = EVEManagerUtil.getEveManager();
        EVEvent rq = eve.createRequest(MethodConst.SAVE_PLUGIN_PROPERTIES);
        rq.add(KeyConst.NAME, PLUGIN);
        rq.addRawMap(KeyConst.PROPERTY_MAP, props);
        EVEvent reply = eve.sendAndWait(rq);
        if (reply == null || reply.getMessageType() == MSG_EXCEPTION) {
            String why = null;
            if (Docs.host != null && reply != null) {
                why = Docs.host.serverError(reply);
            }
            throw new Exception("Fishbowl didn't save the setting" + (Docs.blank(why) ? "." : ": " + why));
        }
    }
}
