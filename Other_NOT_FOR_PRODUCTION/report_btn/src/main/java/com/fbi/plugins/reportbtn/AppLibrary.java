package com.fbi.plugins.reportbtn;

import com.evnt.client.common.EVEManager;
import com.evnt.client.common.EVEManagerUtil;
import com.evnt.client.modules.ClientModuleImpl;
import com.evnt.common.MethodConst;
import com.evnt.eve.event.EVEvent;
import com.evnt.util.KeyConst;
import com.fbi.fbdata.bi.BiReportFpo;
import com.fbi.fbdata.bi.BiScriptFpo;
import com.fbi.sdk.constants.bi.BiScriptTypeConst;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashSet;

/**
 * The App Library (the Home tab), built into the plugin: build.sh copies its page
 * (Other_NOT_FOR_PRODUCTION/Report_Launcher/Report_Launcher.htm) into the jar, so
 * Home needs no record, import or access rows. Only the page is built in: its
 * includes (fb-lib, fb-styles) are the scripts saved in Fishbowl, expanded by the
 * server (REPLACE_INCLUDES_BI_SCRIPT) exactly as for any app, so they keep their
 * own deploy path. A change to the page itself needs a new jar.
 *
 * It loads with the sandbox report id: the page keeps its settings per user
 * (saveSettings) and company-wide (userproperties), never in report data.
 */
final class AppLibrary {

    /** The report id it is shown with (the native editor's preview id). */
    static final int ID = -1;
    private static final String PAGE = "/com/fbi/plugins/reportbtn/library/App_Library.htm";

    private AppLibrary() {
    }

    static boolean is(int id) {
        return id == ID;
    }

    /** The page as built into the jar, includes not yet expanded; null if it isn't there. */
    static String page() {
        try (InputStream in = AppLibrary.class.getResourceAsStream(PAGE)) {
            if (in == null) {
                return null;
            }
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[16384];
            for (int n; (n = in.read(buf)) > 0; ) {
                out.write(buf, 0, n);
            }
            String s = new String(out.toByteArray(), StandardCharsets.UTF_8);
            return !s.isEmpty() && s.charAt(0) == 0xFEFF ? s.substring(1) : s;   // a BOM
        } catch (IOException e) {
            ReportAppsPlugin.log("Apps (beta): reading the built-in App Library failed", e);
            return null;
        }
    }

    /** The page with its includes expanded by the server from the scripts saved in Fishbowl. */
    static ReportLoader.Loaded load(ClientModuleImpl module) throws ReportLoader.LoadException {
        String page = page();
        if (page == null) {
            throw new ReportLoader.LoadException("The App Library isn't in this build of the plugin.");
        }
        BiScriptFpo draft = new BiScriptFpo();   // unsaved: the server expands it without storing it
        draft.setType(BiScriptTypeConst.PAGE);
        draft.setName(ReportWorkspacePlugin.HOME_REPORT);
        draft.setActive(true);
        draft.setData(page);
        EVEManager eve = EVEManagerUtil.getEveManager();
        EVEvent rq = eve.createRequest(MethodConst.REPLACE_INCLUDES_BI_SCRIPT);
        rq.addRawObject(KeyConst.BI_SCRIPT, draft);
        EVEvent rs = eve.sendAndWait(rq);
        if (ReportLoader.failed(rs)) {
            throw new ReportLoader.LoadException("The App Library couldn't load: " + ReportLoader.message(module, rs));
        }
        BiScriptFpo expanded = (BiScriptFpo) rs.getRawObject(KeyConst.BI_SCRIPT, BiScriptFpo.class);
        String html = expanded == null || expanded.getData() == null ? page : expanded.getData();
        BiReportFpo report = new BiReportFpo();
        report.setId(ID);
        report.setName(ReportWorkspacePlugin.HOME_REPORT);
        return new ReportLoader.Loaded(report, html, new HashSet<>());
    }
}
