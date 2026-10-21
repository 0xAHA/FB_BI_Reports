package com.fbi.plugins.reportbtn;

import com.evnt.client.common.EVEManager;
import com.evnt.client.common.EVEManagerUtil;
import com.evnt.client.modules.ClientModuleImpl;
import com.evnt.common.MethodConst;
import com.evnt.eve.event.EVEvent;
import com.evnt.util.KeyConst;
import com.fbi.fbdata.QueryParameter;
import com.fbi.fbdata.bi.BiReportFpo;
import com.fbi.fbdata.bi.BiScriptFpo;
import com.fbi.fbdata.system.SimpleMap;

import java.util.HashSet;
import java.util.Map;
import java.util.Set;

/**
 * Loads a BI report the way the BI Reports module does (BiReportModuleClient.loadData):
 * BI_REPORT_LOAD, then REPLACE_INCLUDES_BI_SCRIPT (the server expands the Script /
 * Style directives, so the live shared records are used), then the report's saved
 * settings as QueryParameters. The caller hands the result to
 * BiBrowserPanel.loadHTML(html, report.getId(), report.getName(), false, params).
 * Shared by the Apps menu (AppLauncher) and the Apps (beta) module.
 */
final class ReportLoader {

    static final class Loaded {
        final BiReportFpo report;
        final String html;
        final Set<QueryParameter> params;

        Loaded(BiReportFpo report, String html, Set<QueryParameter> params) {
            this.report = report;
            this.html = html;
            this.params = params;
        }
    }

    /** A load the server refused or that has nothing to show; the message is ready to display. */
    static final class LoadException extends Exception {
        LoadException(String message) {
            super(message);
        }
    }

    // EVE error (exception) message type: ClientModuleImpl.handleException shows
    // an error only when getMessageType() == 201; any other type is a reply.
    private static final int MSG_EXCEPTION = 201;

    private ReportLoader() {
    }

    /**
     * @param reportId the bireport id
     * @param label    the report's name, for messages
     * @param module   the module whose retrieveErrorMessage reads server errors
     */
    static Loaded load(int reportId, String label, ClientModuleImpl module) throws LoadException {
        EVEManager eve = EVEManagerUtil.getEveManager();
        EVEvent loadRq = eve.createRequest(MethodConst.BI_REPORT_LOAD);
        loadRq.add(KeyConst.ID, reportId);
        EVEvent loaded = eve.sendAndWait(loadRq);
        if (failed(loaded)) {
            throw new LoadException("Could not load \"" + label + "\": " + message(module, loaded));
        }
        BiReportFpo report = (BiReportFpo) loaded.getRawObject(KeyConst.BI_REPORT, BiReportFpo.class);
        BiScriptFpo script = loaded.contains(KeyConst.BI_SCRIPT)
            ? (BiScriptFpo) loaded.getRawObject(KeyConst.BI_SCRIPT, BiScriptFpo.class) : null;
        if (report == null || script == null) {
            throw new LoadException("\"" + label + "\" has no page to show.");
        }

        EVEvent expandRq = eve.createRequest(MethodConst.REPLACE_INCLUDES_BI_SCRIPT);
        expandRq.addRawObject(KeyConst.BI_SCRIPT, script);
        EVEvent expanded = eve.sendAndWait(expandRq);
        if (failed(expanded)) {
            throw new LoadException("Could not prepare \"" + label + "\": " + message(module, expanded));
        }
        BiScriptFpo page = (BiScriptFpo) expanded.getRawObject(KeyConst.BI_SCRIPT, BiScriptFpo.class);
        String html = page != null ? page.getData() : null;
        if (html == null || html.trim().isEmpty()) {
            throw new LoadException("\"" + label + "\" has no page to show.");
        }
        return new Loaded(report, html, savedParams(report));
    }

    /** The report's saved setting values, as BiReportModuleClient.loadQueryParams builds them. */
    static Set<QueryParameter> savedParams(BiReportFpo report) {
        Set<QueryParameter> params = new HashSet<>();
        Map<?, ?> map = savedMap(report);
        if (map != null) {
            for (Map.Entry<?, ?> e : map.entrySet()) {
                QueryParameter p = new QueryParameter(String.valueOf(e.getKey()));
                p.setStorageValue(e.getValue() == null ? null : String.valueOf(e.getValue()));
                params.add(p);
            }
        }
        return params;
    }

    /**
     * BiReportFpo.getParams() (bireport.params), looked up at run time. Fishbowl is moving saved
     * settings from that one shared column to a row per user (ADV-6029); if the getter goes, the
     * app opens with its declared values instead of failing to open. Once that build is out, read
     * the user's own row here the way the BI Reports module does.
     */
    private static Map<?, ?> savedMap(BiReportFpo report) {
        try {
            Object saved = report.getClass().getMethod("getParams").invoke(report);
            if (saved instanceof SimpleMap) {
                return ((SimpleMap) saved).getMap();
            }
            if (saved instanceof Map) {
                return (Map<?, ?>) saved;
            }
        } catch (ReflectiveOperationException | RuntimeException | LinkageError ignored) {
            // no saved settings on this build
        }
        return null;
    }

    static boolean failed(EVEvent response) {
        return response == null || response.getMessageType() == MSG_EXCEPTION;
    }

    static String message(ClientModuleImpl module, EVEvent response) {
        if (response == null) {
            return "no response from the server";
        }
        try {
            String text = module.retrieveErrorMessage(response);
            if (text != null && !text.trim().isEmpty()) {
                return text;
            }
        } catch (Exception ignored) {
            // fall through
        }
        return "server message type " + response.getMessageType();
    }
}
