package com.fbi.plugins.sqlstudio;

import com.evnt.client.common.EVEManager;
import com.evnt.client.common.EVEManagerUtil;
import com.evnt.client.modules.ClientModuleImpl;
import com.evnt.common.AccessRights;
import com.evnt.common.MethodConst;
import com.evnt.eve.event.EVEvent;
import com.evnt.util.KeyConst;
import com.fbi.fbdata.general.DataExportFpo;
import com.teamdev.jxbrowser.js.JsAccessible;

import java.text.SimpleDateFormat;
import java.util.Date;

/**
 * The Data module's saved queries, for the page: window.sqlStudioHost.
 *
 * The same server calls the Data module makes (GET_DATA_EXPORT,
 * SAVE_DATA_EXPORT, DELETE_DATA_EXPORT), so a query saved here is one the
 * Data module lists, and the other way round. Saving needs Data-Edit and
 * deleting Data-Delete, the rights the Data module checks.
 *
 * Every argument and result is a string: JSON out, plain strings in. JavaScript
 * numbers arrive as doubles, and a JSON parser isn't something the client's
 * jars promise, so ids travel as text and the replies are built by hand.
 * Each call blocks the page while it runs, as the Data module's own buttons
 * block its window; they are one small request each.
 */
public final class DataQueryBridge {

    // EVE error (exception) message type: any other type is a reply.
    private static final int MSG_EXCEPTION = 201;

    private final ClientModuleImpl module;

    DataQueryBridge(ClientModuleImpl module) {
        this.module = module;
    }

    /** {"edit":bool,"delete":bool}: what this user may do to saved queries. */
    @JsAccessible
    public String rights() {
        return "{\"edit\":" + has(AccessRights.DATA_EDIT) + ",\"delete\":" + has(AccessRights.DATA_DELETE)
            + ",\"nameMax\":" + DataExportFpo.COL_LENGTH_NAME + ",\"descMax\":" + DataExportFpo.COL_LENGTH_DESC + "}";
    }

    /** {"ok":true,"query":{…}} for the saved query with this id, or {"ok":false,"error":"…"}. */
    @JsAccessible
    public String get(String id) {
        try {
            return ok(load(Integer.parseInt(id.trim())));
        } catch (Failure | RuntimeException e) {
            return error(e);
        }
    }

    /**
     * Saves a query: a new one when id is empty, else that one changed.
     * {"ok":true,"query":{…}} with the record as saved, or {"ok":false,"error":"…"}.
     */
    @JsAccessible
    public String save(String id, String name, String description, String sql) {
        try {
            if (!has(AccessRights.DATA_EDIT)) {
                throw new Failure("Saving queries needs the Data-Edit right.");
            }
            String n = name == null ? "" : name.trim();
            if (n.isEmpty()) {
                throw new Failure("Name is required.");
            }
            if (n.length() > DataExportFpo.COL_LENGTH_NAME) {
                throw new Failure("The name can be " + DataExportFpo.COL_LENGTH_NAME + " characters at most.");
            }
            String d = description == null ? "" : description.trim();
            if (d.length() > DataExportFpo.COL_LENGTH_DESC) {
                throw new Failure("The description can be " + DataExportFpo.COL_LENGTH_DESC + " characters at most.");
            }
            // An existing query is changed on the record the server holds, so
            // whatever else it carries survives the save.
            DataExportFpo fpo = id == null || id.trim().isEmpty() ? new DataExportFpo() : load(Integer.parseInt(id.trim()));
            fpo.setName(n);
            fpo.setDescription(d);
            fpo.setDataQuery(sql == null ? "" : sql);
            EVEvent rq = eve().createRequest(MethodConst.SAVE_DATA_EXPORT);
            rq.addRawObject(KeyConst.DATA_EXPORT, fpo);
            EVEvent rs = send(rq, "save");
            DataExportFpo saved = (DataExportFpo) rs.getRawObject(KeyConst.DATA_EXPORT, DataExportFpo.class);
            return ok(saved != null ? saved : fpo);
        } catch (Failure | RuntimeException e) {
            return error(e);
        }
    }

    /** Deletes a saved query: {"ok":true}, or {"ok":false,"error":"…"}. */
    @JsAccessible
    public String remove(String id) {
        try {
            if (!has(AccessRights.DATA_DELETE)) {
                throw new Failure("Deleting queries needs the Data-Delete right.");
            }
            EVEvent rq = eve().createRequest(MethodConst.DELETE_DATA_EXPORT);
            rq.add(KeyConst.ID, Integer.parseInt(id.trim()));
            send(rq, "delete");
            return "{\"ok\":true}";
        } catch (Failure | RuntimeException e) {
            return error(e);
        }
    }

    // ------------------------------------------------------------------------------

    private DataExportFpo load(int id) throws Failure {
        EVEvent rq = eve().createRequest(MethodConst.GET_DATA_EXPORT);
        rq.add(KeyConst.ID, id);
        EVEvent rs = send(rq, "load");
        DataExportFpo fpo = (DataExportFpo) rs.getRawObject(KeyConst.DATA_EXPORT, DataExportFpo.class);
        if (fpo == null) {
            throw new Failure("That saved query no longer exists.");
        }
        return fpo;
    }

    private static EVEManager eve() throws Failure {
        EVEManager eve = EVEManagerUtil.getEveManager();
        if (eve == null) {
            throw new Failure("Not connected to the Fishbowl server.");
        }
        return eve;
    }

    private EVEvent send(EVEvent rq, String what) throws Failure {
        EVEvent rs = eve().sendAndWait(rq);
        if (rs == null) {
            throw new Failure("No reply from the server to the " + what + ".");
        }
        if (rs.getMessageType() == MSG_EXCEPTION) {
            String text = null;
            try {
                text = module.retrieveErrorMessage(rs);
            } catch (Exception ignored) {
                // fall through to the generic message
            }
            throw new Failure(text != null && !text.trim().isEmpty() ? text : "The server refused the " + what + ".");
        }
        return rs;
    }

    private static boolean has(AccessRights right) {
        try {
            return right.hasAccess();
        } catch (RuntimeException e) {
            return false;
        }
    }

    private static String ok(DataExportFpo q) {
        return "{\"ok\":true,\"query\":{\"id\":" + q.getId()
            + ",\"name\":" + StudioPage.jsonString(nz(q.getName()))
            + ",\"description\":" + StudioPage.jsonString(nz(q.getDescription()))
            + ",\"sql\":" + StudioPage.jsonString(nz(q.getDataQuery()))
            + ",\"dateCreated\":" + StudioPage.jsonString(date(q.getDateCreated()))
            + ",\"dateLastModified\":" + StudioPage.jsonString(date(q.getDateLastModified()))
            + "}}";
    }

    private static String error(Exception e) {
        String m = e.getMessage();
        if (!(e instanceof Failure)) {
            SqlStudioPlugin.log("saved query call failed", e);
            m = "Something went wrong: " + (m == null ? e.getClass().getSimpleName() : m);
        }
        return "{\"ok\":false,\"error\":" + StudioPage.jsonString(m == null ? "" : m) + "}";
    }

    private static String nz(String s) {
        return s == null ? "" : s;
    }

    private static String date(Date d) {
        return d == null ? "" : new SimpleDateFormat("yyyy-MM-dd HH:mm:ss").format(d);
    }

    /** A failure with a message ready to show. */
    private static final class Failure extends Exception {
        private static final long serialVersionUID = 1L;

        Failure(String message) {
            super(message);
        }
    }
}
