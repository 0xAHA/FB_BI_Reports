package com.fbi.plugins.reportbtn.editor;

import com.evnt.client.common.EVEManager;
import com.evnt.client.common.EVEManagerUtil;
import com.evnt.common.MethodConst;
import com.evnt.eve.event.EVEvent;
import com.evnt.util.KeyConst;
import com.fbi.fbdata.AuditRecord;
import com.fbi.fbdata.bi.BiReportAccessFpo;
import com.fbi.fbdata.bi.BiReportFpo;
import com.fbi.fbdata.bi.BiScriptFpo;
import com.fbi.plugins.reportbtn.WorkspaceHost;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * The server calls the editor makes: the same EVE methods the native BI Editor and
 * BI Report modules use, plus a few SELECTs. Blocking: call from a worker thread.
 */
final class ScriptService {

    /** A refusal or failure with a message ready to show. */
    static final class ServiceException extends Exception {
        ServiceException(String message) {
            super(message);
        }
    }

    /** A record the page can include (Script, Style, Template, Image). */
    static final class Includable {
        final int id;
        final String name;
        final int typeId;
        final String description;
        final boolean builtIn;
        /** dateLastModified as text: part of the index cache key. */
        final String modified;

        Includable(int id, String name, int typeId, String description, boolean builtIn, String modified) {
            this.id = id;
            this.name = name;
            this.typeId = typeId;
            this.description = description;
            this.builtIn = builtIn;
            this.modified = modified;
        }

        String typeName() {
            switch (typeId) {
                case 20: return "Script";
                case 30: return "Style";
                case 40: return "Template";
                case 50: return "Image";
                default: return "Page";
            }
        }
    }

    /** A report and its page, as BI_REPORT_LOAD returns them. */
    static final class ReportBundle {
        final BiReportFpo report;
        final BiScriptFpo script;
        final List<BiReportAccessFpo> access;

        ReportBundle(BiReportFpo report, BiScriptFpo script, List<BiReportAccessFpo> access) {
            this.report = report;
            this.script = script;
            this.access = access;
        }
    }

    /** One app, script, style or template, as the explorer lists it. */
    static final class Entry {
        final int id;
        final String name;
        final int typeId;
        final String description;
        final boolean active;
        final boolean published;
        final boolean builtIn;
        /** The fb-launch tag's content: the module association ("" when the page has none). */
        final String launchTag;
        /** The fb-folder tag's content: the folder ("" when the page has none: Unfiled). */
        final String folder;
        /** A system app (fb-origin system): ships with Fishbowl, locked in the editor. */
        final boolean system;
        final List<AccessPolicy.Report> reports;

        Entry(int id, String name, int typeId, String description, boolean active, boolean published, boolean builtIn,
              String launchTag, String folder, boolean system, List<AccessPolicy.Report> reports) {
            this.id = id;
            this.name = name;
            this.typeId = typeId;
            this.description = description;
            this.active = active;
            this.published = published;
            this.builtIn = builtIn;
            this.launchTag = launchTag;
            this.folder = folder;
            this.system = system;
            this.reports = reports;
        }

        boolean gadget() {
            return !reports.isEmpty() && reports.stream().allMatch(r -> r.widget);
        }

        String kind() {
            switch (typeId) {
                case 20: return "Script";
                case 30: return "Style";
                case 40: return "Template";
                default: return "App";
            }
        }
    }

    private final WorkspaceHost host;

    ScriptService(WorkspaceHost host) {
        this.host = host;
    }

    // ---------------------------------------------------------------- EVE
    BiScriptFpo getScript(int id) throws ServiceException {
        EVEvent rq = eve().createRequest(MethodConst.GET_BI_SCRIPT);
        rq.add(KeyConst.ID, id);
        EVEvent rs = send(rq, "load the script");
        BiScriptFpo s = (BiScriptFpo) rs.getRawObject(KeyConst.BI_SCRIPT, BiScriptFpo.class);
        if (s == null) {
            throw new ServiceException("The server returned no script for id " + id + ".");
        }
        return s;
    }

    ReportBundle loadReport(int reportId) throws ServiceException {
        EVEvent rq = eve().createRequest(MethodConst.BI_REPORT_LOAD);
        rq.add(KeyConst.ID, reportId);
        EVEvent rs = send(rq, "load the app");
        BiReportFpo report = (BiReportFpo) rs.getRawObject(KeyConst.BI_REPORT, BiReportFpo.class);
        BiScriptFpo script = rs.contains(KeyConst.BI_SCRIPT)
            ? (BiScriptFpo) rs.getRawObject(KeyConst.BI_SCRIPT, BiScriptFpo.class) : null;
        List<BiReportAccessFpo> access = rawList(rs, KeyConst.BI_REPORT_ACCESS, BiReportAccessFpo.class);
        if (report == null) {
            throw new ServiceException("The server returned no app for id " + reportId + ".");
        }
        return new ReportBundle(report, script, access);
    }

    /** SAVE_BI_SCRIPT. The access list is sent only when it has rows, as the native editor does. */
    BiScriptFpo save(BiScriptFpo fpo, List<BiReportAccessFpo> access) throws ServiceException {
        EVEvent rq = eve().createRequest(MethodConst.SAVE_BI_SCRIPT);
        rq.addRawObject(KeyConst.BI_SCRIPT, fpo);
        if (access != null && !access.isEmpty()) {
            rq.addRawList(KeyConst.BI_REPORT_ACCESS, access);
        }
        EVEvent rs = send(rq, "save");
        BiScriptFpo saved = (BiScriptFpo) rs.getRawObject(KeyConst.BI_SCRIPT, BiScriptFpo.class);
        if (saved == null) {
            throw new ServiceException("The server did not return the saved script.");
        }
        return saved;
    }

    /** The page with its includes expanded by the server (works on unsaved text). */
    String expand(BiScriptFpo fpo) throws ServiceException {
        EVEvent rq = eve().createRequest(MethodConst.REPLACE_INCLUDES_BI_SCRIPT);
        rq.addRawObject(KeyConst.BI_SCRIPT, fpo);
        EVEvent rs = send(rq, "prepare the preview");
        BiScriptFpo page = (BiScriptFpo) rs.getRawObject(KeyConst.BI_SCRIPT, BiScriptFpo.class);
        return page == null || page.getData() == null ? "" : page.getData();
    }

    /** Saved versions, oldest first. */
    List<AuditRecord> history(int scriptId) throws ServiceException {
        EVEvent rq = eve().createRequest(MethodConst.GET_BI_SCRIPT_HISTORY);
        rq.add(KeyConst.ID, scriptId);
        EVEvent rs = send(rq, "load the history");
        List<AuditRecord> list = rawList(rs, KeyConst.AUDIT_LIST, AuditRecord.class);
        list.sort((a, b) -> {
            if (a.getTimestamp() == null || b.getTimestamp() == null) {
                return 0;
            }
            return a.getTimestamp().compareTo(b.getTimestamp());
        });
        return list;
    }

    /** BI_REPORT_SAVE: the report as loaded (name, description and widget as the caller left them) with an access list. */
    void saveReport(BiReportFpo report, List<BiReportAccessFpo> access) throws ServiceException {
        EVEvent rq = eve().createRequest(MethodConst.BI_REPORT_SAVE);
        rq.addRawObject(KeyConst.BI_REPORT, report);
        rq.addRawList(KeyConst.BI_REPORT_ACCESS, access == null ? new ArrayList<>() : access);
        send(rq, "save the app");
    }

    /** DELETE_BI_SCRIPT: the server deletes the page's reports and their access first. */
    void delete(int id) throws ServiceException {
        EVEvent rq = eve().createRequest(MethodConst.DELETE_BI_SCRIPT);
        rq.add(KeyConst.ID, id);
        send(rq, "delete");
    }

    /** GET_BI_SCRIPT_EXPORT_DATA: the record and the records it includes, as the BI Editor's Download writes them. */
    List<BiScriptFpo> exportData(int id) throws ServiceException {
        EVEvent rq = eve().createRequest(MethodConst.GET_BI_SCRIPT_EXPORT_DATA);
        rq.add(KeyConst.ID, id);
        EVEvent rs = send(rq, "export");
        return rawList(rs, KeyConst.BI_SCRIPT_LIST, BiScriptFpo.class);
    }

    // ---------------------------------------------------------------- SQL
    /** Every app (page), script, style and template, with its reports and the window holding its fb-launch tag. */
    List<Entry> catalog() {
        java.util.Map<Integer, List<AccessPolicy.Report>> reports = new java.util.HashMap<>();
        for (Object row : query("SELECT id, biScriptId AS s, name, widget+0 AS w FROM bireport ORDER BY name")) {
            reports.computeIfAbsent(intOf(host.column(row, "s")), k -> new ArrayList<>())
                .add(new AccessPolicy.Report(intOf(host.column(row, "id")), nz(host.column(row, "name")),
                    intOf(host.column(row, "w")) == 1));
        }
        String at = "LOCATE('name=\"fb-launch\"', data)";
        String fo = "LOCATE('name=\"fb-folder\"', data)";
        String or = "LOCATE('name=\"fb-origin\"', data)";
        List<Entry> out = new ArrayList<>();
        for (Object row : query("SELECT id, name, typeId AS t, LEFT(COALESCE(description, ''), 300) AS d, active+0 AS a, "
            + "published+0 AS p, COALESCE(fbName <> '', 0) AS b, "
            + "CASE WHEN typeId = 10 AND " + at + " > 0 THEN SUBSTRING(data, GREATEST(1, " + at + " - 120), 360) "
            + "ELSE '' END AS tag, "
            + "CASE WHEN typeId = 10 AND " + fo + " > 0 THEN SUBSTRING(data, GREATEST(1, " + fo + " - 120), 360) "
            + "ELSE '' END AS fold, "
            + "CASE WHEN typeId = 10 AND " + or + " > 0 THEN SUBSTRING(data, GREATEST(1, " + or + " - 120), 360) "
            + "ELSE '' END AS orig FROM biscript WHERE typeId IN (10, 20, 30, 40) ORDER BY name")) {
            int id = intOf(host.column(row, "id"));
            String name = host.column(row, "name");
            if (id <= 0 || name == null) {
                continue;
            }
            List<AccessPolicy.Report> mine = reports.getOrDefault(id, new ArrayList<>());
            out.add(new Entry(id, name, intOf(host.column(row, "t")), nz(host.column(row, "d")),
                intOf(host.column(row, "a")) == 1, intOf(host.column(row, "p")) == 1, intOf(host.column(row, "b")) == 1,
                AppGroups.launchContent(host.column(row, "tag")), AppGroups.folderContent(host.column(row, "fold")),
                AppGroups.isSystem(host.column(row, "orig")), mine));
        }
        return out;
    }

    /** The folders of Fishbowl's own report tree under Company (Reporting > Reports), A-Z. */
    List<String> nativeFolders() {
        List<String> out = new ArrayList<>();
        for (Object row : query("SELECT c.name AS n FROM reporttree c JOIN reporttree p ON p.id = c.parentId "
            + "WHERE p.parentId IS NULL AND p.name = 'Company' ORDER BY c.name")) {
            String n = host.column(row, "n");
            if (n != null && !n.trim().isEmpty()) {
                out.add(n.trim());
            }
        }
        return out;
    }

    List<Includable> includables() {
        List<Includable> out = new ArrayList<>();
        for (Object row : query("SELECT id, name, typeId AS t, LEFT(COALESCE(description, ''), 300) AS d, "
            + "(fbName IS NOT NULL) AS b, CAST(dateLastModified AS CHAR) AS m FROM biscript "
            + "WHERE active+0 = 1 AND typeId IN (20, 30, 40, 50) ORDER BY typeId, name")) {
            int id = intOf(host.column(row, "id"));
            String name = host.column(row, "name");
            if (id > 0 && name != null) {
                out.add(new Includable(id, name, intOf(host.column(row, "t")), nz(host.column(row, "d")),
                    "1".equals(host.column(row, "b")), nz(host.column(row, "m"))));
            }
        }
        return out;
    }

    /** The reports that show this page. */
    List<AccessPolicy.Report> reportsFor(int scriptId) {
        List<AccessPolicy.Report> out = new ArrayList<>();
        if (scriptId <= 0) {
            return out;
        }
        for (Object row : query("SELECT id, name, widget+0 AS w FROM bireport WHERE biScriptId = " + scriptId + " ORDER BY name")) {
            out.add(new AccessPolicy.Report(intOf(host.column(row, "id")), nz(host.column(row, "name")),
                intOf(host.column(row, "w")) == 1));
        }
        return out;
    }

    /** Another record of this type already has the name (the server refuses duplicates too). */
    boolean nameTaken(String name, int typeId, int exceptId) {
        return !query("SELECT id FROM biscript WHERE name = " + sq(name) + " AND typeId = " + typeId
            + " AND id <> " + exceptId + " LIMIT 1").isEmpty();
    }

    /** How many active pages include this record (a directive search, so a rough count). */
    int pagesUsing(String type, String recordName) {
        String needle = "{% " + type + " " + PageIncludes.includeName(recordName) + " %}";
        List<?> rows = query("SELECT COUNT(*) AS n FROM biscript WHERE typeId = 10 AND active+0 = 1 AND LOCATE("
            + sq(needle) + ", data) > 0");
        return rows.isEmpty() ? 0 : intOf(host.column(rows.get(0), "n"));
    }

    /** The user's group ids (for the access dialog's lock-out guard). */
    java.util.Set<Integer> myGroupIds(int userId) {
        java.util.Set<Integer> out = new java.util.HashSet<>();
        for (Object row : query("SELECT groupId AS g FROM usergrouprel WHERE userId = " + userId)) {
            out.add(intOf(host.column(row, "g")));
        }
        return out;
    }

    /** Pages and templates a new page can start from: "BI Template" first. */
    List<Includable> templates() {
        List<Includable> out = new ArrayList<>();
        for (Object row : query("SELECT id, name, typeId AS t, LEFT(COALESCE(description, ''), 300) AS d, "
            + "CAST(dateLastModified AS CHAR) AS m FROM biscript WHERE active+0 = 1 AND "
            + "(typeId = 40 OR (typeId = 10 AND name LIKE '%Template%')) "
            + "ORDER BY (name = 'BI Template') DESC, typeId DESC, name")) {
            int id = intOf(host.column(row, "id"));
            String name = host.column(row, "name");
            if (id > 0 && name != null) {
                out.add(new Includable(id, name, intOf(host.column(row, "t")), nz(host.column(row, "d")), false,
                    nz(host.column(row, "m"))));
            }
        }
        return out;
    }

    String userName(Integer userId) {
        if (userId == null) {
            return "";
        }
        List<?> rows = query("SELECT userName AS u FROM sysuser WHERE id = " + userId);
        return rows.isEmpty() ? "user " + userId : nz(host.column(rows.get(0), "u"));
    }

    /** The access level stored for a report and this user's groups, for when the client can't say. */
    String storedLevel(int reportId, int userId) {
        List<?> rows = query("SELECT a.accessLevel AS l FROM bireportaccess a JOIN usergrouprel r ON r.groupId = a.userGroupId "
            + "WHERE a.biReportId = " + reportId + " AND r.userId = " + userId);
        String best = null;
        for (Object row : rows) {
            String l = host.column(row, "l");
            if (l != null && l.toLowerCase().contains("edit")) {
                return l;
            }
            best = l != null ? l : best;
        }
        return best;
    }

    // ---------------------------------------------------------------- helpers
    private static EVEManager eve() {
        return EVEManagerUtil.getEveManager();
    }

    private EVEvent send(EVEvent rq, String what) throws ServiceException {
        EVEvent rs;
        try {
            rs = eve().sendAndWait(rq);
        } catch (RuntimeException e) {
            host.log("Page editor: could not " + what, e);
            throw new ServiceException("Could not " + what + ": " + e.getMessage());
        }
        String error = host.serverError(rs);
        if (error != null) {
            throw new ServiceException("Could not " + what + ": " + error);
        }
        return rs;
    }

    @SuppressWarnings("unchecked")
    private static <T> List<T> rawList(EVEvent rs, Object key, Class<T> type) {
        try {
            if (!rs.contains(key)) {
                return new ArrayList<>();
            }
            List<T> list = rs.getRawList(key, type);
            return list == null ? new ArrayList<>() : new ArrayList<>(list);
        } catch (RuntimeException e) {
            return new ArrayList<>();
        }
    }

    private List<?> query(String sql) {
        try {
            List<?> rows = host.query(sql);
            return rows == null ? Collections.emptyList() : rows;
        } catch (RuntimeException e) {
            host.log("Page editor: query failed: " + sql, e);
            return Collections.emptyList();
        }
    }

    static String sq(String s) {
        return "'" + (s == null ? "" : s.replace("\\", "\\\\").replace("'", "''")) + "'";
    }

    private static int intOf(String s) {
        try {
            return s == null ? 0 : (int) Double.parseDouble(s.trim());
        } catch (NumberFormatException e) {
            return 0;
        }
    }

    private static String nz(String s) {
        return s == null ? "" : s;
    }
}
